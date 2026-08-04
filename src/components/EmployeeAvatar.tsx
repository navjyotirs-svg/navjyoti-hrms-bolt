import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AvatarSize = 'small' | 'medium' | 'large'

const SIZE_PX: Record<AvatarSize, number> = {
  small: 32,
  medium: 44,
  large: 64,
}

const SIZE_CLS: Record<AvatarSize, string> = {
  small: 'emp-avatar-sm',
  medium: 'emp-avatar-md',
  large: 'emp-avatar-lg',
}

const PALETTE = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#06b6d4'],
  ['#10b981', '#14b8a6'],
  ['#f97316', '#eab308'],
  ['#ec4899', '#f43f5e'],
  ['#3b82f6', '#6366f1'],
  ['#8b5cf6', '#a855f7'],
  ['#14b8a6', '#0d9488'],
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface Props {
  employeeId?: string
  fullName?: string
  photoPath?: string | null
  size?: AvatarSize
  showStatus?: boolean
  online?: boolean
  className?: string
}

export function EmployeeAvatar({
  employeeId,
  fullName = '',
  photoPath,
  size = 'medium',
  showStatus = false,
  online = false,
  className = '',
}: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!photoPath) { setImgUrl(null); return }
    setLoading(true)
    ;(async () => {
      try {
        const { data } = await supabase.storage
          .from('employee-photos')
          .createSignedUrl(photoPath, 300)
        if (!cancelled) {
          setImgUrl(data?.signedUrl ?? null)
          setImgError(false)
        }
      } catch {
        if (!cancelled) setImgError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [photoPath])

  const idKey = employeeId || fullName || 'unknown'
  const [c1, c2] = PALETTE[hashStr(idKey) % PALETTE.length]
  const sz = SIZE_PX[size]
  const cls = SIZE_CLS[size]

  return (
    <span
      className={`emp-avatar ${cls} ${className}`}
      style={{ width: sz, height: sz }}
      role="img"
      aria-label={fullName || 'Employee avatar'}
    >
      {loading && <span className="emp-avatar-skeleton" />}
      {!loading && imgUrl && !imgError && (
        <img
          src={imgUrl}
          alt={fullName || 'Employee'}
          onError={() => setImgError(true)}
          style={{ width: sz, height: sz }}
        />
      )}
      {!loading && (!imgUrl || imgError) && (
        <span
          className="emp-avatar-initials"
          style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
        >
          {initials(fullName)}
        </span>
      )}
      {showStatus && (
        <span className={`emp-avatar-status ${online ? 'online' : 'offline'}`} />
      )}
    </span>
  )
}
