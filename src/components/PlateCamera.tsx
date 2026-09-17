import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, X } from 'lucide-react'
import { Button, Modal } from './ui'
import {
  getOcrEngine,
  logOcrAttempt,
  preprocessForOcr,
  type OcrProgress,
} from '@/services/ocr'
import { toArabicError } from '@/lib/errors'

interface PlateCameraProps {
  open: boolean
  onClose: () => void
  /**
   * تُستدعى بالرقم المقروء (قد يكون فارغاً).
   * الشاشة المستدعية هي التي تعرضه للتأكيد — لا يُعتمد تلقائياً أبداً.
   */
  onDetected: (plate: string, meta: { confidence: number; raw: string }) => void
}

type Phase = 'idle' | 'starting' | 'live' | 'processing' | 'error'

export function PlateCamera({ open, onClose, onDetected }: PlateCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<OcrProgress | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setPhase('starting')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('هذا المتصفح لا يدعم الكاميرا. استخدم الإدخال اليدوي')
      setPhase('error')
      return
    }

    if (!window.isSecureContext) {
      setError('الكاميرا تحتاج اتصالاً آمناً (HTTPS). استخدم الإدخال اليدوي')
      setPhase('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('live')
    } catch (err) {
      const name = (err as { name?: string })?.name ?? ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('لم يتم السماح باستخدام الكاميرا. فعّل الإذن من إعدادات المتصفح')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('لا توجد كاميرا متاحة على هذا الجهاز')
      } else if (name === 'NotReadableError') {
        setError('الكاميرا مستخدمة من تطبيق آخر')
      } else {
        setError(toArabicError(err))
      }
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (open) {
      void startCamera()
    } else {
      stopCamera()
      setPhase('idle')
      setError(null)
      setProgress(null)
    }
    return () => stopCamera()
  }, [open, startCamera, stopCamera])

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) {
      setError('الكاميرا لم تجهز بعد. انتظر لحظة ثم أعد المحاولة')
      return
    }

    setPhase('processing')
    setError(null)
    setProgress({ progress: 0.02, label: 'جارٍ تجهيز الصورة…' })

    try {
      const canvas = preprocessForOcr(video, video.videoWidth, video.videoHeight)
      const engine = getOcrEngine()

      const result = await engine.recognize(canvas, (p) => setProgress(p))

      void logOcrAttempt({
        detected: result.plate || result.rawText.slice(0, 64),
        corrected: '',
        confidence: result.confidence,
        engine: result.engine,
      })

      stopCamera()
      onDetected(result.plate, {
        confidence: result.confidence,
        raw: result.rawText,
      })
    } catch (err) {
      setError(toArabicError(err))
      setPhase('live')
      setProgress(null)
    }
  }, [onDetected, stopCamera])

  const processing = phase === 'processing'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تصوير لوحة السيارة"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} icon={<X className="h-4 w-4" />}>
            إلغاء
          </Button>
          {phase === 'error' ? (
            <Button
              variant="secondary"
              onClick={() => void startCamera()}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              إعادة تشغيل الكاميرا
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => void capture()}
              loading={processing}
              disabled={phase !== 'live'}
              icon={!processing ? <Camera className="h-5 w-5" /> : undefined}
            >
              {processing ? 'جارٍ القراءة…' : 'التقاط الصورة'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-xl bg-slate-900 aspect-video">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {/* إطار توجيه اللوحة */}
          {phase === 'live' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[32%] w-[86%] rounded-lg border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
            </div>
          )}

          {(phase === 'starting' || processing) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/70 text-white">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <p className="text-sm font-medium">
                {phase === 'starting'
                  ? 'جارٍ تشغيل الكاميرا…'
                  : (progress?.label ?? 'جارٍ القراءة…')}
              </p>
              {processing && progress && (
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/25">
                  <div
                    className="h-full rounded-full bg-white transition-all"
                    style={{ width: `${Math.round(progress.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-6 text-brand-800">
          وجّه الكاميرا بحيث تكون اللوحة داخل الإطار المتقطّع وبإضاءة جيدة.
          <br />
          <strong>الرقم المقروء سيُعرض عليك للتأكيد قبل التسجيل</strong> — يمكنك
          دائماً تعديله أو إدخاله يدوياً.
        </p>

        {error && (
          <p
            className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
            role="alert"
          >
            {error}
          </p>
        )}

        {phase === 'processing' && (
          <p className="text-center text-xs text-slate-500">
            أول قراءة قد تستغرق وقتاً أطول لتحميل محرك القراءة (مرة واحدة فقط).
          </p>
        )}
      </div>
    </Modal>
  )
}
