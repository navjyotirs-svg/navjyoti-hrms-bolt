import { useEffect, useRef, useState, useCallback } from 'react'
import {
  validateEvidenceFile,
  blobToBase64,
  checkIn,
} from '@/lib/attendance'
import '@/styles/attendance.css'

interface Props {
  userId: string
  onClose: () => void
  onSuccess: (result: {
    record_id: string
    check_in_at: string
    required_checkout_at: string
    recurring_tasks_generated?: number
  }) => void
}

type Step = 'intro' | 'camera' | 'captured' | 'location' | 'uploading' | 'done'

const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.85

export function CheckInModal({ userId: _userId, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('intro')
  const [error, setError] = useState<string | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null)
  const [canSwitchCamera, setCanSwitchCamera] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop())
      setCameraStream(null)
    }
  }, [cameraStream])

  useEffect(() => {
    return () => {
      stopCamera()
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [stopCamera, photoUrl])

  // Detect whether the device has multiple cameras (so we can offer a switch button)
  useEffect(() => {
    let cancelled = false
    async function detect() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const cams = devices.filter((d) => d.kind === 'videoinput')
        setCanSwitchCamera(cams.length > 1)
      } catch {
        // ignore — switch button simply won't be shown
      }
    }
    detect()
    return () => { cancelled = true }
  }, [])

  async function startCamera(mode: 'user' | 'environment') {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API not available in this browser.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      })
      setCameraStream(stream)
      setStep('camera')
      // Attach stream to video element
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }, 100)
      return true
    } catch (err) {
      const e = err as DOMException
      if (e.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow Camera access from browser Site Settings.')
      } else if (e.name === 'NotFoundError') {
        setError('No camera device found. Please connect a camera.')
      } else if (e.name === 'NotReadableError') {
        setError('Camera is in use by another application. Please close it and try again.')
      } else if (e.name === 'OverconstrainedError') {
        setError('Requested camera facing mode is not available on this device.')
      } else if (e.name === 'SecurityError') {
        setError('Camera access blocked by browser security policy.')
      } else {
        setError(`Camera error: ${e.message}`)
      }
      return false
    }
  }

  async function handleEnableCameraAndLocation() {
    setError(null)

    if (!window.isSecureContext) {
      setError('Camera and location require a secure context (HTTPS or localhost). Please access via HTTPS.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API not available in this browser.')
      return
    }
    if (!navigator.geolocation) {
      setError('Geolocation API not available in this browser.')
      return
    }

    await startCamera(facingMode)
  }

  async function handleSwitchCamera() {
    const next: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    stopCamera()
    await startCamera(next)
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const sourceWidth = video.videoWidth || 640
    const sourceHeight = video.videoHeight || 480

    // Downscale to max 1920px on the longest edge, preserving aspect ratio
    let targetWidth = sourceWidth
    let targetHeight = sourceHeight
    if (Math.max(sourceWidth, sourceHeight) > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(sourceWidth, sourceHeight)
      targetWidth = Math.round(sourceWidth * scale)
      targetHeight = Math.round(sourceHeight * scale)
    }

    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mirror the preview for front-facing camera so the captured image matches what the user sees
    if (facingMode === 'user') {
      ctx.translate(targetWidth, 0)
      ctx.scale(-1, 1)
    }

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
    // Reset transform before exporting
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setPhotoBlob(blob)
        setPhotoUrl(URL.createObjectURL(blob))
        stopCamera()
        setStep('captured')
      },
      'image/jpeg',
      JPEG_QUALITY
    )
  }

  function handleRetake() {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoBlob(null)
    setPhotoUrl(null)
    setError(null)
    startCamera(facingMode)
  }

  async function captureLocation() {
    setError(null)
    setStep('location')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setStep('captured')
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError('Location permission denied. Please allow Location access from browser Site Settings.')
        } else if (err.code === err.TIMEOUT) {
          setError('Location request timed out. Please try again.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError('Location unavailable. Please check your GPS or network connection.')
        } else {
          setError(`Location error: ${err.message}`)
        }
        setStep('captured')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  // Correct image orientation using createImageBitmap when available, then re-compress via canvas.
  async function normalizePhoto(blob: Blob): Promise<Blob> {
    try {
      if (typeof createImageBitmap === 'function') {
        // imageOrientation: 'from-image' honors EXIF orientation metadata
        const bitmap = await createImageBitmap(blob, {
          imageOrientation: 'from-image' as ImageOrientation,
        })

        let targetWidth = bitmap.width
        let targetHeight = bitmap.height
        if (Math.max(targetWidth, targetHeight) > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(targetWidth, targetHeight)
          targetWidth = Math.round(targetWidth * scale)
          targetHeight = Math.round(targetHeight * scale)
        }

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return blob
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
        bitmap.close?.()

        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to compress image'))),
            'image/jpeg',
            JPEG_QUALITY
          )
        })
      }
    } catch {
      // Fall through to original blob if orientation correction fails
    }
    return blob
  }

  async function handleCheckIn() {
    if (!photoBlob || !coords) return
    setError(null)
    setStep('uploading')

    try {
      const mimeType = 'image/jpeg'
      const normalized = await normalizePhoto(photoBlob)
      const validationError = validateEvidenceFile(
        new File([normalized], 'checkin.jpg', { type: mimeType })
      )
      if (validationError) {
        setError(validationError)
        setStep('captured')
        return
      }

      const photoBase64 = await blobToBase64(normalized)
      const result = await checkIn({
        photo_base64: photoBase64,
        evidence_mime_type: mimeType,
        latitude: coords.lat,
        longitude: coords.lng,
        location_accuracy: coords.accuracy,
      })

      setStep('done')
      setTimeout(() => {
        onSuccess(result as {
          record_id: string
          check_in_at: string
          required_checkout_at: string
          recurring_tasks_generated?: number
        })
      }, 1500)
    } catch (err) {
      const e = err as Error
      setError(e.message)
      setStep('captured')
    }
  }

  function handleClose() {
    stopCamera()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal checkin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Check In
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

          {step === 'intro' && (
            <div className="checkout-intro">
              <p className="checkout-warning">
                Photo and location are mandatory for check-in.
                A live photo and your GPS coordinates will be securely uploaded as evidence.
              </p>
              <button className="btn btn-checkout-enable" onClick={handleEnableCameraAndLocation}>
                Enable Camera and Location
              </button>
            </div>
          )}

          {step === 'camera' && (
            <div className="checkout-camera">
              <video ref={videoRef} autoPlay playsInline muted className="checkout-video" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div className="checkout-camera-actions">
                {canSwitchCamera && (
                  <button className="btn btn-sm btn-secondary" onClick={handleSwitchCamera}>
                    Switch Camera
                  </button>
                )}
                <button className="btn btn-capture" onClick={capturePhoto}>Capture Photo</button>
              </div>
            </div>
          )}

          {step === 'captured' && (
            <div className="checkout-captured">
              {photoUrl && (
                <div className="checkout-photo-preview">
                  <img src={photoUrl} alt="Check-in photo" />
                </div>
              )}
              <div className="checkout-status-list">
                <div className="checkout-status-row">
                  <span>Photo captured</span>
                  <span className="checkout-check">✓</span>
                </div>
                <div className="checkout-status-row">
                  <span>Location</span>
                  {coords ? (
                    <span className="checkout-check">✓ {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
                  ) : (
                    <button className="btn btn-sm" onClick={captureLocation}>Get Location</button>
                  )}
                </div>
              </div>
              <div className="checkout-captured-actions">
                <button className="btn btn-secondary" onClick={handleRetake}>
                  Retake Photo
                </button>
                {coords && (
                  <button className="btn" onClick={handleCheckIn}>
                    Confirm Check-In
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'location' && (
            <div className="checkout-loading">
              <div className="spinner" />
              <p>Acquiring location…</p>
            </div>
          )}

          {step === 'uploading' && (
            <div className="checkout-loading">
              <div className="spinner" />
              <p>Uploading evidence and checking in…</p>
            </div>
          )}

          {step === 'done' && (
            <div className="checkout-done">
              <div className="checkout-done-icon">✓</div>
              <p>Checked in successfully!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
