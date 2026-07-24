import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import { NotificationBell } from '@/components/NotificationBell'
import { CheckoutModal } from '@/components/CheckoutModal'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import { supabase } from '@/lib/supabase'
import { checkIn, fetchTodayAttendance, formatTimeRemaining } from '@/lib/attendance'
import '@/styles/shell.css'

interface TopbarProps {
  title: string
  soundEnabled: boolean
}

export function Topbar({ title, soundEnabled }: TopbarProps) {
  const { profile, permissions } = useAuth()
  const [todayRec, setTodayRec] = useState<{ check_in_at: string; required_checkout_at: string; final_status: string } | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState('00:00:00')

  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')

  const loadAttendance = useCallback(async () => {
    if (!profile?.id || !canCheckIn) return
    try {
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('user_id', profile.id)
        .maybeSingle()
      const empId = (emp as { id: string } | null)?.id
      if (!empId) return
      const rec = await fetchTodayAttendance(empId)
      setTodayRec(rec ? {
        check_in_at: rec.check_in_at,
        required_checkout_at: rec.required_checkout_at,
        final_status: rec.final_status,
      } : null)
    } catch {
      // silent fail — topbar widget is best-effort
    }
  }, [profile?.id, canCheckIn])

  useEffect(() => {
    loadAttendance()
  }, [loadAttendance])

  useEffect(() => {
    if (todayRec?.final_status === 'PENDING_CHECKOUT' && todayRec.required_checkout_at) {
      const update = () => setRemaining(formatTimeRemaining(todayRec.required_checkout_at))
      update()
      const timer = setInterval(update, 1000)
      return () => clearInterval(timer)
    }
  }, [todayRec])

  async function handleCheckIn() {
    setError(null)
    setCheckingIn(true)
    try {
      await checkIn()
      await loadAttendance()
    } catch (e) {
      setError((e as Error).message)
    }
    setCheckingIn(false)
  }

  function handleCheckoutSuccess(_result: { final_status: string }) {
    setShowCheckout(false)
    loadAttendance()
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-mobile-logo">
          <NavjyotiLogo width={95} maxHeight={32} clickable />
        </div>
        <h1 className="topbar-title">{title}</h1>
      </div>
      <div className="topbar-right">
        {canCheckIn && (
          <div className="topbar-attendance">
            {error && <span className="topbar-attendance-error" title={error}>!</span>}
            {!todayRec && (
              <button className="topbar-checkin-btn" onClick={handleCheckIn} disabled={checkingIn}>
                {checkingIn ? '…' : 'Check In'}
              </button>
            )}
            {todayRec && todayRec.final_status === 'PENDING_CHECKOUT' && canCheckOut && (
              <>
                <span className="topbar-timer mono">{remaining}</span>
                <button className="topbar-checkout-btn" onClick={() => setShowCheckout(true)}>
                  Check Out
                </button>
              </>
            )}
            {todayRec && todayRec.final_status !== 'PENDING_CHECKOUT' && (
              <span className="topbar-attendance-done">
                {todayRec.final_status === 'PRESENT' ? 'Present' : todayRec.final_status === 'HALF_DAY' ? 'Half Day' : 'Done'}
              </span>
            )}
          </div>
        )}
        {profile?.id && <NotificationBell userId={profile.id} soundEnabled={soundEnabled} />}
        <div className="topbar-user">
          <span className="topbar-user-name">{profile?.full_name ?? profile?.email}</span>
          <span className="topbar-user-role">
            {profile?.role ? ROLE_LABELS[profile.role] : ''}
          </span>
        </div>
        {showCheckout && (
          <CheckoutModal
            userId={profile!.id}
            onClose={() => setShowCheckout(false)}
            onSuccess={handleCheckoutSuccess}
          />
        )}
      </div>
    </header>
  )
}
