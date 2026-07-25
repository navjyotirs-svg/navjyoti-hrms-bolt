import { useRealtime, type RealtimeConnectionState } from '@/components/AppRealtimeProvider'

const STATE_CONFIG: Record<RealtimeConnectionState, { color: string; label: string }> = {
  connected: { color: '#0E6E63', label: 'Live updates connected' },
  connecting: { color: '#C17817', label: 'Connecting live updates…' },
  reconnecting: { color: '#C17817', label: 'Reconnecting live updates…' },
  unavailable: { color: '#B3413A', label: 'Live updates could not connect. Some information may require refresh.' },
  offline: { color: '#B3413A', label: 'You appear to be offline' },
  error: { color: '#B3413A', label: 'Live updates could not connect. Some information may require refresh.' },
}

export function RealtimeIndicator() {
  const { connectionState, reconnect, diagnostics } = useRealtime()
  const config = STATE_CONFIG[connectionState] ?? STATE_CONFIG.unavailable
  const isDev = import.meta.env.DEV
  const showRetry = connectionState === 'error' || connectionState === 'unavailable' || connectionState === 'offline'

  const tooltip = isDev
    ? `${config.label}\nStatus: ${diagnostics.status ?? 'none'}\nChannels: ${diagnostics.activeChannelCount}\nReconnect attempts: ${diagnostics.reconnectAttempts}\nLast event: ${diagnostics.lastEventTimestamp ?? 'none'}${diagnostics.errorCode ? `\nError: ${diagnostics.errorCode}` : ''}`
    : config.label

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        color: 'var(--slate)',
        cursor: showRetry ? 'pointer' : 'default',
      }}
      title={tooltip}
      onClick={showRetry ? () => reconnect() : undefined}
      role={showRetry ? 'button' : undefined}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'inline-block',
          flexShrink: 0,
          animation: connectionState === 'connecting' || connectionState === 'reconnecting'
            ? 'rt-pulse 1.5s ease-in-out infinite'
            : 'none',
        }}
      />
      {isDev ? config.label : ''}
      {showRetry && isDev && (
        <span
          style={{
            fontSize: '10px',
            color: 'var(--primary-600, #1D4ED8)',
            textDecoration: 'underline',
            marginLeft: '2px',
          }}
        >
          Retry
        </span>
      )}
    </span>
  )
}
