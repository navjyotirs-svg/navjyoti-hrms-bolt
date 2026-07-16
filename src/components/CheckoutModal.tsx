import { useEffect, useRef, useState, useCallback } from 'react'
import {
  validateEvidenceFile,
  uploadAttendanceEvidence,
  checkOut,
} from '@/lib/attendance'
import '@/styles/attendance.css'

interface Props {
  userId: string
  onClose: () => void
  onSuccess: (result: { final_status: string; elapsed_minutes: number }) => void
}

type Step = 'intro' | 'camera' | 'captured' | 'location' | 'uploading' | 'done'

export function CheckoutModal({ userId, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('intro')
  const [error, setError] = useState<string | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null)
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
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
    } catch (err) {
      const e = err as DOMException
      if (e.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow Camera access from browser Site Settings.')
      } else if (e.name === 'NotFoundError') {
        setError('No camera device found. Please connect a camera.')
      } else if (e.name === 'NotReadableError') {
        setError('Camera is in use by another application. Please close it and try again.')
      } else if (e.name === 'SecurityError') {
        setError('Camera access blocked by browser security policy.')
      } else {
        setError(`Camera error: ${e.message}`)
      }
    }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      setPhotoBlob(blob)
      setPhotoUrl(URL.createObjectURL(blob))
      stopCamera()
      setStep('captured')
    }, 'image/jpeg', 0.85)
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

  async function handleCheckout() {
    if (!photoBlob || !coords) return
    setError(null)
    setStep('uploading')

    try {
      const mimeType = 'image/jpeg'
      const validationError = validateEvidenceFile(new File([photoBlob], 'checkout.jpg', { type: mimeType }))
      if (validationError) {
        setError(validationError)
        setStep('captured')
        return
      }

      const storagePath = await uploadAttendanceEvidence(userId, photoBlob, mimeType)
      const result = await checkOut({
        evidence_storage_path: storagePath,
        evidence_mime_type: mimeType,
        evidence_file_size: photoBlob.size,
        latitude: coords.lat,
        longitude: coords.lng,
        location_accuracy: coords.accuracy,
      })

      setStep('done')
      setTimeout(() => {
        onSuccess(result)
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
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Check Out
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

          {step === 'intro' && (
            <div className="checkout-intro">
              <p className="checkout-warning">
                Photo and location are mandatory for checkout.
                Your photo and GPS coordinates will be securely uploaded as evidence.
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
              <button className="btn btn-capture" onClick={capturePhoto}>Capture Photo</button>
            </div>
          )}

          {step === 'captured' && (
            <div className="checkout-captured">
              {photoUrl && (
                <div className="checkout-photo-preview">
                  <img src={photoUrl} alt="Checkout photo" />
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
              {coords && (
                <button className="btn" onClick={handleCheckout} style={{ marginTop: '12px', width: '100%' }}>
                  Confirm Checkout
                </button>
              )}
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
              <p>Uploading evidence and checking out…</p>
            </div>
          )}

          {step === 'done' && (
            <div className="checkout-done">
              <div className="checkout-done-icon">✓</div>
              <p>Checked out successfully!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
