import { useEffect, type ReactNode } from 'react'

interface DrillDownDrawerProps {
  open: boolean
  title: string
  onClose: () => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  count?: number | null
  children: ReactNode
  footer?: ReactNode
}

export function DrillDownDrawer({
  open, title, onClose, loading, error, onRetry, count, children, footer,
}: DrillDownDrawerProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drilldown-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="drilldown-panel"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="drilldown-header">
          <div className="drilldown-header-left">
            <h3 className="drilldown-title">{title}</h3>
            {count !== null && count !== undefined && (
              <span className="drilldown-count">{count} record{count !== 1 ? 's' : ''}</span>
            )}
          </div>
          <button
            className="btn btn-sm btn-secondary"
            onClick={onClose}
            aria-label="Close drill-down panel"
            type="button"
          >
            Close
          </button>
        </div>

        {error && (
          <div className="drilldown-error">
            <div className="form-error">{error}</div>
            {onRetry && (
              <button className="btn btn-sm" onClick={onRetry} type="button" style={{ marginTop: '8px' }}>
                Retry
              </button>
            )}
          </div>
        )}

        <div className="drilldown-body">
          {loading ? (
            <div className="drilldown-loading">Loading records…</div>
          ) : (
            children
          )}
        </div>

        {footer && <div className="drilldown-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function DrillDownEmpty({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-text">{message}</div>
    </div>
  )
}

export function DrillDownTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; mono?: boolean }[]
  rows: Record<string, ReactNode>[]
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: '24px', color: 'var(--slate)' }}>
                No records found.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.mono ? 'mono' : ''}>{row[c.key]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
