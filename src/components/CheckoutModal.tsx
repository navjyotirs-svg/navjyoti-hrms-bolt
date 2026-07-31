import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  validateEvidenceFile,
  blobToBase64,
  checkOut,
  isEdgeFunctionError,
} from '@/lib/attendance'
import { fetchMyReport, getKolkataDate } from '@/lib/dailyReports'
import '@/styles/attendance.css'

interface Props {
  userId: string
  onClose: () => void
  onSuccess: (result: { final_status: string; elapsed_minutes: number }) => void
}

type Step = 'intro' | 'camera' | 'captured' | 'location' | 'uploading' | 'done'
type UploadStage = 'idle' | 'processing' | 'uploading' | 'verifying' | 'completing' | 'done'

export function CheckoutModal({ userId: _userId, onClose, onSuccess }: Props) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('intro')
  const [error, setError] = useState<string | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle')
  const [correlationId, setCorrelationId] = useState<string | null>(null)
  const [reportStatus, setReportStatus] = useState<'loading' | 'submitted' | 'not_submitted'>('loading')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop())
      setCameraStream(null)
    }
  }, [cameraStream])

  useEffect(() => {
    let cancelled = false
    async function checkReport() {
      try {
        const today = getKolkataDate()
        const report = await fetchMyReport(today)
        if (cancelled) return
        if (report && (report.status === 'SUBMITTED' || report.status === 'APPROVED')) {
          setReportStatus('submitted')
        } else {
          setReportStatus('not_submitted')
        }
      } catch {
        if (!cancelled) setReportStatus('not_submitted')
      }
    }
    checkReport()
    return () => { cancelled = true }
  }, [])

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

  async function handleCheckout() {
    if (!photoBlob || !coords || isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    setStep('uploading')
    setUploadStage('processing')

    try {
      const mimeType = 'image/jpeg'
      const validationError = validateEvidenceFile(new File([photoBlob], 'checkout.jpg', { type: mimeType }))
      if (validationError) {
        setError(validationError)
        setStep('captured')
        setUploadStage('idle')
        setIsSubmitting(false)
        return
      }

      setUploadStage('uploading')
      const photoBase64 = await blobToBase64(photoBlob)
      setUploadStage('verifying')
      const result = await checkOut({
        photo_base64: photoBase64,
        evidence_mime_type: mimeType,
        latitude: coords.lat,
        longitude: coords.lng,
        location_accuracy: coords.accuracy,
      })

      setUploadStage('completing')
      setStep('done')
      setUploadStage('done')
      setTimeout(() => {
        onSuccess(result as { final_status: string; elapsed_minutes: number })
      }, 1500)
    } catch (err) {
      const e = err as Error
      if (isEdgeFunctionError(e)) {
        setError(e.message)
        setCorrelationId(e.correlationId)
      } else {
        setError(e.message || 'Checkout failed. Please try again.')
      }
      setStep('captured')
      setUploadStage('idle')
      setIsSubmitting(false)
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
              {reportStatus === 'loading' && (
                <p className="checkout-warning">Checking daily report status…</p>
              )}
              {reportStatus === 'not_submitted' && (
                <>
                  <p className="checkout-warning" style={{ color: 'var(--error)' }}>
                    You must submit your daily report before checking out.
                    Please complete and submit today's report first.
                  </p>
                  <button
                    className="btn"
                    onClick={() => navigate('/my-reports')}
                    style={{ width: '100%' }}
                  >
                    Go to Daily Report
                  </button>
                </>
              )}
              {reportStatus === 'submitted' && (
                <>
                  <p className="checkout-warning">
                    Photo and location are mandatory for checkout.
                    Your photo and GPS coordinates will be securely uploaded as evidence.
                  </p>
                  <button className="btn btn-checkout-enable" onClick={handleEnableCameraAndLocation}>
                    Enable Camera and Location
                  </button>
                </>
              )}
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
                    <span className="checkout-check">✓ Location captured{coords.accuracy ? ` (Accuracy: ${Math.round(coords.accuracy)} metres)` : ''}</span>
                  ) : (
                    <button className="btn btn-sm" onClick={captureLocation}>Get Location</button>
                  )}
                </div>
              </div>
              {coords && (
                <button className="btn" onClick={handleCheckout} disabled={isSubmitting} style={{ marginTop: '12px', width: '100%' }}>
                  {isSubmitting ? 'Completing checkout…' : 'Confirm Checkout'}
                </button>
              )}
              {error && isSubmitting === false && (
                <>
                  <button className="btn btn-sm" onClick={handleCheckout} style={{ marginTop: '8px', width: '100%' }}>
                    Retry Checkout
                  </button>
                  {correlationId && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '4px', textAlign: 'center' }}>
                      Reference: {correlationId.slice(0, 8)}
                    </p>
                  )}
                </>
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
              <p>
                {uploadStage === 'processing' && 'Processing photo…'}
                {uploadStage === 'uploading' && 'Uploading evidence…'}
                {uploadStage === 'verifying' && 'Verifying attendance…'}
                {uploadStage === 'completing' && 'Completing Check-Out…'}
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="checkout-done">
              <div className="checkout-done-icon">✓</div>
              <p>Check-Out completed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
