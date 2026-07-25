import { useEffect, useState, type ReactNode } from 'react'
import '@/styles/skeleton.css'

function useDelayedLoading(loading: boolean, delayMs = 150): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!loading) { setShow(false); return }
    const t = setTimeout(() => setShow(true), delayMs)
    return () => clearTimeout(t)
  }, [loading, delayMs])
  return show
}

function SkeletonBase({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skl ${className}`} style={style} aria-hidden="true" />
}

export function Skeleton({ width, height, radius, className = '', style }: {
  width?: string; height?: string; radius?: string; className?: string; style?: React.CSSProperties
}) {
  return <SkeletonBase className={className} style={{ width, height, borderRadius: radius, ...style }} />
}

export function TextSkeleton({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`skl-text-group ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBase key={i} className="skl-text" style={{ width: i === lines - 1 ? '70%' : '100%' }} />
      ))}
    </div>
  )
}

export function HeadingSkeleton({ className = '' }: { className?: string }) {
  return <SkeletonBase className={`skl-heading ${className}`} />
}

export function AvatarSkeleton({ size = '40px', className = '' }: { size?: string; className?: string }) {
  return <SkeletonBase className={`skl-avatar ${className}`} style={{ width: size, height: size }} />
}

export function ButtonSkeleton({ width = '120px', className = '' }: { width?: string; className?: string }) {
  return <SkeletonBase className={`skl-button ${className}`} style={{ width }} />
}

export function InputSkeleton({ className = '' }: { className?: string }) {
  return <SkeletonBase className={`skl-input ${className}`} />
}

export function SelectSkeleton({ className = '' }: { className?: string }) {
  return <SkeletonBase className={`skl-input ${className}`} />
}

export function CardSkeleton({ className = '', children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={`skl-card ${className}`} aria-hidden="true">
      {children ?? (
        <>
          <SkeletonBase className="skl-card-title" />
          <SkeletonBase className="skl-card-line" />
          <SkeletonBase className="skl-card-line" style={{ width: '60%' }} />
        </>
      )}
    </div>
  )
}

export function MetricCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-metric-card ${className}`} aria-hidden="true">
      <SkeletonBase className="skl-metric-label" />
      <SkeletonBase className="skl-metric-value" />
      <SkeletonBase className="skl-metric-sub" style={{ width: '50%' }} />
    </div>
  )
}

export function ListSkeleton({ rows = 5, className = '', avatar = false }: { rows?: number; className?: string; avatar?: boolean }) {
  return (
    <div className={`skl-list ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skl-list-row">
          {avatar && <SkeletonBase className="skl-avatar" style={{ width: '36px', height: '36px' }} />}
          <div className="skl-list-content">
            <SkeletonBase className="skl-list-title" />
            <SkeletonBase className="skl-list-sub" style={{ width: '60%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 5, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`skl-table ${className}`} aria-hidden="true">
      <div className="skl-table-head">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBase key={i} className="skl-table-th" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skl-table-row">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBase key={c} className="skl-table-td" style={{ width: c === 0 ? '40%' : c === cols - 1 ? '80px' : undefined }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function FormSkeleton({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`skl-form ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skl-form-field">
          <SkeletonBase className="skl-form-label" style={{ width: '30%' }} />
          <SkeletonBase className="skl-input" />
        </div>
      ))}
      <SkeletonBase className="skl-button" style={{ width: '140px' }} />
    </div>
  )
}

export function DetailPageSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-detail-page ${className}`} aria-hidden="true">
      <div className="skl-detail-header">
        <SkeletonBase className="skl-heading" style={{ width: '250px' }} />
        <div className="skl-detail-meta">
          <SkeletonBase className="skl-badge" />
          <SkeletonBase className="skl-badge" />
          <SkeletonBase className="skl-badge" />
        </div>
      </div>
      <div className="skl-detail-grid">
        <SkeletonBase className="skl-card" style={{ minHeight: '200px' }} />
        <SkeletonBase className="skl-card" style={{ minHeight: '200px' }} />
      </div>
      <SkeletonBase className="skl-card" style={{ minHeight: '150px' }} />
    </div>
  )
}

export function DashboardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-dashboard ${className}`} aria-hidden="true">
      <SkeletonBase className="skl-heading" style={{ width: '200px' }} />
      <div className="skl-metric-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="skl-dashboard-cols">
        <SkeletonBase className="skl-card" style={{ minHeight: '180px' }} />
        <SkeletonBase className="skl-card" style={{ minHeight: '180px' }} />
      </div>
    </div>
  )
}

export function CalendarSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-calendar ${className}`} aria-hidden="true">
      <div className="skl-cal-header">
        <SkeletonBase className="skl-heading" style={{ width: '180px' }} />
        <SkeletonBase className="skl-button" style={{ width: '100px' }} />
      </div>
      <div className="skl-cal-grid">
        {Array.from({ length: 35 }).map((_, i) => (
          <SkeletonBase key={i} className="skl-cal-cell" />
        ))}
      </div>
    </div>
  )
}

export function TimelineSkeleton({ items = 6, className = '' }: { items?: number; className?: string }) {
  return (
    <div className={`skl-timeline ${className}`} aria-hidden="true">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="skl-timeline-item">
          <SkeletonBase className="skl-timeline-dot" />
          <div className="skl-timeline-content">
            <SkeletonBase className="skl-list-title" style={{ width: '50%' }} />
            <SkeletonBase className="skl-list-sub" style={{ width: '30%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NotificationSkeleton({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`skl-notifications ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skl-notif-row">
          <SkeletonBase className="skl-avatar" style={{ width: '32px', height: '32px' }} />
          <div className="skl-notif-content">
            <SkeletonBase className="skl-list-title" style={{ width: '60%' }} />
            <SkeletonBase className="skl-list-sub" style={{ width: '90%' }} />
            <SkeletonBase className="skl-list-sub" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ModalSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-modal ${className}`} aria-hidden="true">
      <SkeletonBase className="skl-heading" style={{ width: '180px' }} />
      <FormSkeleton rows={3} />
    </div>
  )
}

export function ProfileSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-profile ${className}`} aria-hidden="true">
      <div className="skl-profile-header">
        <SkeletonBase className="skl-avatar" style={{ width: '72px', height: '72px' }} />
        <div className="skl-profile-info">
          <SkeletonBase className="skl-heading" style={{ width: '200px' }} />
          <SkeletonBase className="skl-list-sub" style={{ width: '120px' }} />
        </div>
      </div>
      <div className="skl-profile-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBase key={i} className="skl-card" style={{ minHeight: '120px' }} />
        ))}
      </div>
    </div>
  )
}

export function AttendanceSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-attendance ${className}`} aria-hidden="true">
      <div className="skl-metric-grid">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <SkeletonBase className="skl-card" style={{ minHeight: '100px' }} />
      <TableSkeleton rows={6} cols={5} />
    </div>
  )
}

export function TaskSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-tasks ${className}`} aria-hidden="true">
      <div className="skl-metric-grid">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <ListSkeleton rows={5} avatar />
    </div>
  )
}

export function TicketSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-tickets ${className}`} aria-hidden="true">
      <ListSkeleton rows={5} avatar />
    </div>
  )
}

export function DailyReportSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skl-daily-report ${className}`} aria-hidden="true">
      <SkeletonBase className="skl-heading" style={{ width: '200px' }} />
      <FormSkeleton rows={8} />
      <SkeletonBase className="skl-card" style={{ minHeight: '100px' }} />
    </div>
  )
}

export function PageSkeleton({ children, loading, delayMs = 150 }: { children: ReactNode; loading: boolean; delayMs?: number }) {
  const show = useDelayedLoading(loading, delayMs)
  if (!show) return null
  return <>{children}</>
}

export { useDelayedLoading }
