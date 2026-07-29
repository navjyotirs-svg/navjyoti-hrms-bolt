import { useEffect, useState, useCallback } from 'react'

export interface SliderImage {
  url: string
  caption: string
  fileName: string
  uploadedAt: string
}

interface PhotoSliderProps {
  images: SliderImage[]
  initialIndex?: number
  onClose: () => void
}

export function PhotoSlider({ images, initialIndex = 0, onClose }: PhotoSliderProps) {
  const [index, setIndex] = useState(initialIndex)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const goNext = useCallback(() => {
    setIndex((prev) => (prev + 1) % images.length)
  }, [images.length])

  const goPrev = useCallback(() => {
    setIndex((prev) => (prev - 1 + images.length) % images.length)
  }, [images.length])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Escape') { if (isFullscreen) setIsFullscreen(false); else onClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev, onClose, isFullscreen])

  useEffect(() => {
    let startX = 0
    let startY = 0
    function onTouchStart(e: TouchEvent) { startX = e.touches[0].clientX; startY = e.touches[0].clientY }
    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goNext()
        else goPrev()
      }
    }
    const el = document.querySelector('.photo-slider-main') as HTMLElement | null
    el?.addEventListener('touchstart', onTouchStart, { passive: true })
    el?.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el?.removeEventListener('touchstart', onTouchStart)
      el?.removeEventListener('touchend', onTouchEnd)
    }
  }, [goNext, goPrev])

  if (images.length === 0) return null
  const current = images[index]

  const containerStyle: React.CSSProperties = isFullscreen
    ? { position: 'fixed', inset: 0, background: '#000', zIndex: 10000, display: 'flex', flexDirection: 'column' }
    : { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', flexDirection: 'column', padding: 'var(--space-4)' }

  return (
    <div style={containerStyle} onClick={(e) => { if (e.target === e.currentTarget && !isFullscreen) onClose() }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-3)', color: 'white', flexShrink: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600 }}>
          {index + 1} / {images.length}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}>
            {isFullscreen ? '⤢' : '⤡'}
          </button>
          <button onClick={onClose} title="Close"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Main image */}
      <div className="photo-slider-main" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 0 }}>
        {images.length > 1 && (
          <button onClick={goPrev} title="Previous"
            style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ‹
          </button>
        )}
        <img src={current.url} alt={current.caption || current.fileName}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: isFullscreen ? 0 : '8px' }} />
        {images.length > 1 && (
          <button onClick={goNext} title="Next"
            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ›
          </button>
        )}
      </div>

      {/* Caption / info */}
      <div style={{ padding: 'var(--space-2) var(--space-3)', color: 'rgba(255,255,255,0.8)', textAlign: 'center', flexShrink: 0, maxWidth: '600px', margin: '0 auto' }}>
        {current.caption && <div style={{ fontSize: '13px', marginBottom: '2px' }}>{current.caption}</div>}
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
          {current.fileName}
          {current.uploadedAt && ` · ${new Date(current.uploadedAt).toLocaleString('en-IN')}`}
        </div>
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', padding: 'var(--space-2)', overflowX: 'auto', flexShrink: 0 }}>
          {images.map((img, i) => (
            <button key={i} onClick={() => setIndex(i)}
              style={{
                width: '48px', height: '48px', borderRadius: '4px', overflow: 'hidden',
                border: i === index ? '2px solid var(--teal)' : '2px solid transparent',
                cursor: 'pointer', flexShrink: 0, padding: 0, background: 'none',
              }}>
              <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
