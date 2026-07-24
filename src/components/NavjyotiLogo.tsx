import { Link } from 'react-router-dom'
import logoUrl from '@/assets/branding/navjyoti_logo_transparent.png'

interface NavjyotiLogoProps {
  width?: number
  maxHeight?: number
  variant?: 'full' | 'mark'
  className?: string
  clickable?: boolean
  alt?: string
}

export function NavjyotiLogo({
  width = 195,
  maxHeight = 75,
  variant = 'full',
  className = '',
  clickable = false,
  alt = 'Navjyoti – Transforming Lives & Careers',
}: NavjyotiLogoProps) {
  if (variant === 'mark') {
    const mark = (
      <span
        className={`navjyoti-mark ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontFamily: 'var(--font-heading)',
          fontSize: '18px',
          color: '#fff',
          letterSpacing: '-0.5px',
          userSelect: 'none',
        }}
      >
        NJ
      </span>
    )
    return clickable ? (
      <Link to="/" aria-label="Go to Dashboard" style={{ textDecoration: 'none' }}>{mark}</Link>
    ) : mark
  }

  const img = (
    <img
      src={logoUrl}
      alt={alt}
      style={{
        width: `${width}px`,
        height: 'auto',
        maxHeight: `${maxHeight}px`,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )

  if (clickable) {
    return (
      <Link
        to="/"
        aria-label="Go to Dashboard"
        className={className}
        style={{ display: 'inline-block', textDecoration: 'none' }}
      >
        {img}
      </Link>
    )
  }

  return <div className={className} style={{ display: 'inline-block' }}>{img}</div>
}
