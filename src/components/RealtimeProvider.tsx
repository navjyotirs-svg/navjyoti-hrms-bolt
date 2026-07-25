import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { getQueriesForTable, type QueryKey } from '@/lib/queryClient'

export type RealtimeConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

interface RealtimeContextValue {
  connectionState: RealtimeConnectionState
  reconnect: () => void
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
]

const REFETCH_INTERVAL_MS = 30_000
const CRITICAL_TABLES: QueryKey[] = ['notifications', 'attendance-today', 'my-attendance']

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session, profile, permissions } = useAuth()
  const queryClient = useQueryClient()
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('disconnected')
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncRef = useRef<Date>(new Date())

  const invalidateTable = useCallback((table: string) => {
    const queries = getQueriesForTable(table)
    for (const q of queries) {
      queryClient.invalidateQueries({ queryKey: [q] })
    }
  }, [queryClient])

  const setupSubscription = useCallback(() => {
    if (!session?.user || !profile?.organization_id) return
    if (channelRef.current) return

    setConnectionState('connecting')

    const channel = supabase
      .channel('app-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: '*' },
        (payload) => {
          const table = (payload as { table: string }).table
          if (SUBSCRIBED_TABLES.includes(table)) {
            invalidateTable(table)
          }
        }
      )
      .on('system', { event: 'connected' }, () => {
        setConnectionState('connected')
        lastSyncRef.current = new Date()
      })
      .on('system', { event: 'reconnecting' }, () => {
        setConnectionState('reconnecting')
      })
      .on('system', { event: 'closed' }, () => {
        setConnectionState('disconnected')
      })
      .on('system', { event: 'error' }, () => {
        setConnectionState('error')
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('connected')
          lastSyncRef.current = new Date()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionState('error')
        } else if (status === 'CLOSED') {
          setConnectionState('disconnected')
        }
      })

    channelRef.current = channel
  }, [session?.user, profile?.organization_id, invalidateTable])

  const reconnect = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setupSubscription()
  }, [setupSubscription])

  // Start subscription after auth + profile loaded
  useEffect(() => {
    if (session?.user && profile?.organization_id && permissions.length > 0) {
      setupSubscription()
    }

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
    }
  }, [session?.user?.id, profile?.organization_id, permissions.length, setupSubscription])

  // Auto-reconnect on disconnect
  useEffect(() => {
    if (connectionState === 'disconnected' || connectionState === 'error') {
      if (session?.user && !reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          reconnect()
        }, 5_000)
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

  return (
    <RealtimeContext.Provider value={{ connectionState, reconnect }}>
      {children}
    </RealtimeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider')
  return ctx
}


