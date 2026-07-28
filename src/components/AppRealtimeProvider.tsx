import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { getQueriesForTable, type QueryKey } from '@/lib/queryClient'

export type RealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unavailable'
  | 'offline'
  | 'error'

interface RealtimeDiagnostics {
  channelName: string | null
  status: string | null
  errorCode: string | null
  reconnectAttempts: number
  activeChannelCount: number
  lastEventTimestamp: string | null
}

interface RealtimeContextValue {
  connectionState: RealtimeConnectionState
  reconnect: () => void
  diagnostics: RealtimeDiagnostics
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

const SUBSCRIBED_TABLES = [
  'employees',
  'user_profiles',
  'user_organization_memberships',
  'employee_status_history',
  'attendance_records',
  'attendance_corrections',
  'leave_requests',
  'leave_balances',
  'leave_ledger',
  'calendar_events',
  'holiday_calendar_dates',
  'tasks',
  'task_assignments',
  'task_status_history',
  'task_submissions',
  'task_comments',
  'tickets',
  'ticket_comments',
  'ticket_history',
  'daily_reports',
  'daily_report_history',
  'daily_report_comments',
  'notifications',
  'announcements',
  'management_follow_ups',
  'projects',
  'project_history',
  'recurring_task_templates',
  'voice_notes',
  'voice_note_recipients',
]

const REFETCH_INTERVAL_MS = 30_000
const CRITICAL_TABLES: QueryKey[] = ['notifications', 'attendance-today', 'my-attendance']
const RECONNECT_BASE_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000

function getOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function AppRealtimeProvider({ children }: { children: ReactNode }) {
  const { session, profile, permissions } = useAuth()
  const queryClient = useQueryClient()
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('disconnected' as RealtimeConnectionState)
  const channelRef = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map())
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const lastSyncRef = useRef<Date>(new Date())
  const lastEventRef = useRef<string | null>(null)
  const lastErrorRef = useRef<string | null>(null)
  const lastStatusRef = useRef<string | null>(null)
  const isMountedRef = useRef(true)
  const isSettingUpRef = useRef(false)

  const invalidateTable = useCallback((table: string) => {
    const queries = getQueriesForTable(table)
    for (const q of queries) {
      queryClient.invalidateQueries({ queryKey: [q] })
    }
    lastEventRef.current = new Date().toISOString()
  }, [queryClient])

  const teardownChannels = useCallback(() => {
    for (const [, channel] of channelRef.current) {
      try {
        supabase.removeChannel(channel)
      } catch {
        // channel may already be removed
      }
    }
    channelRef.current.clear()
  }, [])

  const setupSubscription = useCallback(() => {
    if (!session?.user || !profile?.organization_id) return
    if (isSettingUpRef.current) return
    isSettingUpRef.current = true

    teardownChannels()

    if (!getOnline()) {
      setConnectionState('offline')
      isSettingUpRef.current = false
      return
    }

    setConnectionState('connecting')

    let subscribedCount = 0
    const totalTables = SUBSCRIBED_TABLES.length

    for (const table of SUBSCRIBED_TABLES) {
      const channelName = `rt:${table}`

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => {
            invalidateTable(table)
          }
        )
        .subscribe((status, error) => {
          if (!isMountedRef.current) return

          lastStatusRef.current = status

          if (status === 'SUBSCRIBED') {
            subscribedCount++
            lastErrorRef.current = null
            if (subscribedCount >= totalTables) {
              setConnectionState('connected')
              lastSyncRef.current = new Date()
              reconnectAttemptsRef.current = 0
            }
          } else if (status === 'CHANNEL_ERROR') {
            lastErrorRef.current = error?.message || 'Channel error'
            setConnectionState('error')
          } else if (status === 'TIMED_OUT') {
            lastErrorRef.current = error?.message || 'Subscription timed out'
            setConnectionState('error')
          } else if (status === 'CLOSED') {
            if (isMountedRef.current && session?.user) {
              setConnectionState('reconnecting')
            }
          }
        })

      channelRef.current.set(channelName, channel)
    }

    isSettingUpRef.current = false
  }, [session?.user, profile?.organization_id, invalidateTable, teardownChannels])

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    reconnectAttemptsRef.current++
    teardownChannels()
    setupSubscription()
  }, [setupSubscription, teardownChannels])

  // Start subscription after auth + profile loaded
  useEffect(() => {
    isMountedRef.current = true

    if (session?.user && profile?.organization_id && permissions.length > 0) {
      reconnectAttemptsRef.current = 0
      setupSubscription()
    } else {
      teardownChannels()
      setConnectionState('disconnected' as RealtimeConnectionState)
    }

    return () => {
      isMountedRef.current = false
      teardownChannels()
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, profile?.organization_id, permissions.length])

  // Auto-reconnect on disconnect/error
  useEffect(() => {
    if (connectionState === 'error' || connectionState === 'reconnecting' || connectionState === 'unavailable') {
      if (session?.user && !reconnectTimerRef.current && isMountedRef.current) {
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
          MAX_RECONNECT_DELAY_MS
        )
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          if (isMountedRef.current) {
            reconnect()
          }
        }, delay)
      }
    } else {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
  }, [connectionState, session?.user, reconnect])

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      if (session?.user && isMountedRef.current) {
        reconnectAttemptsRef.current = 0
        reconnect()
      }
    }
    const handleOffline = () => {
      if (isMountedRef.current) {
        setConnectionState('offline')
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [session?.user, reconnect])

  // Fallback periodic refetch for critical data
  useEffect(() => {
    if (!session?.user) return

    const interval = setInterval(() => {
      for (const q of CRITICAL_TABLES) {
        queryClient.invalidateQueries({ queryKey: [q] })
      }
    }, REFETCH_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [session?.user, queryClient])

  // Refetch on reconnect
  useEffect(() => {
    if (connectionState === 'connected') {
      const now = new Date()
      const elapsed = now.getTime() - lastSyncRef.current.getTime()
      if (elapsed > 10_000) {
        for (const q of CRITICAL_TABLES) {
          queryClient.invalidateQueries({ queryKey: [q] })
        }
        lastSyncRef.current = now
      }
    }
  }, [connectionState, queryClient])

  // Refetch on window focus
  useEffect(() => {
    if (!session?.user) return
    const handleFocus = () => {
      for (const q of CRITICAL_TABLES) {
        queryClient.invalidateQueries({ queryKey: [q] })
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [session?.user, queryClient])

  const diagnostics: RealtimeDiagnostics = {
    channelName: channelRef.current.size > 0 ? `rt:* (${channelRef.current.size} channels)` : null,
    status: lastStatusRef.current,
    errorCode: lastErrorRef.current,
    reconnectAttempts: reconnectAttemptsRef.current,
    activeChannelCount: channelRef.current.size,
    lastEventTimestamp: lastEventRef.current,
  }

  return (
    <RealtimeContext.Provider value={{ connectionState, reconnect, diagnostics }}>
      {children}
    </RealtimeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtime must be used within AppRealtimeProvider')
  return ctx
}

export default AppRealtimeProvider
