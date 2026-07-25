import { useRealtime, type RealtimeConnectionState } from '@/components/RealtimeProvider'

const STATE_CONFIG: Record<RealtimeConnectionState, { color: string; label: string }> = {
  connected: { color: '#0E6E63', label: 'Live updates connected' },
  connecting: { color: '#C17817', label: 'Connecting…' },
  reconnecting: { color: '#C17817', label: 'Reconnecting…' },
  disconnected: { color: '#B3413A', label: 'Live updates unavailable' },
  error: { color: '#B3413A', label: 'Live updates unavailable' },
}

export function RealtimeIndicator() {
  const { connectionState } = useRealtime()
  const config = STATE_CONFIG[connectionState]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        color: 'var(--slate)',
        cursor: 'default',
      }}
      title={config.label}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {import.meta.env.DEV ? config.label : ''}
    </span>
  )
}
