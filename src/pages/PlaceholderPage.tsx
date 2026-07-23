export function NotFoundPage() {
  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Page Not Found</h2>
      <p style={{ color: 'var(--slate)', fontSize: '13.5px' }}>
        The requested page does not exist.
      </p>
    </div>
  )
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <div style={{ fontSize: '28px', marginBottom: '8px', color: 'var(--slate)' }}>&#9672;</div>
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>{title}</h2>
      <p style={{ color: 'var(--slate)', fontSize: '13.5px' }}>
        This module will be implemented in a future phase.
      </p>
    </div>
  )
}
