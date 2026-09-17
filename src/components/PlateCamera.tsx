import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, RefreshCw, X } from 'lucide-react'
import { Button, Modal } from './ui'
import { cx } from '@/lib/cx'
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
      const engine = getOcrEngine()

      // نجرّب الإطار كاملاً، ثم الجزء الأيمن وحده (بلا مربع «الأردن»).
      // مربع الدولة ثابت على كل لوحة أردنية وحروفه تشوّش القراءة، لكن
      // قصّه ليس مضموناً لأن موضع اللوحة داخل الإطار يختلف — لذلك
      // نُجرّب الحالتين ونأخذ الأعلى ثقة.
      const variants: Array<{ cropRight: boolean }> = [
        { cropRight: false },
        { cropRight: true },
      ]

      let best: Awaited<ReturnType<typeof engine.recognize>> | null = null

      for (const variant of variants) {
        const canvas = preprocessForOcr(
          video,
          video.videoWidth,
          video.videoHeight,
          variant,
        )

        const result = await engine.recognize(canvas, (p) => setProgress(p))

        if (!best || result.confidence > best.confidence) best = result

        // قراءة مقنعة — لا داعي للمحاولة الثانية
        if (result.plate && result.confidence >= 0.7) break
      }

      const result = best ?? {
        plate: '',
        rawText: '',
        confidence: 0,
        engine: 'tesseract.js',
      }

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

  /** قراءة لوحة من صورة مختارة من الجهاز */
  const readFromFile = useCallback(
    async (file: File) => {
      setPhase('processing')
      setError(null)
      setProgress({ progress: 0.02, label: 'جارٍ تجهيز الصورة…' })

      const url = URL.createObjectURL(file)

      try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('تعذّر فتح الصورة'))
          img.src = url
        })

        const engine = getOcrEngine()
        let best: Awaited<ReturnType<typeof engine.recognize>> | null = null

        for (const variant of [{ cropRight: false }, { cropRight: true }]) {
          const canvas = preprocessForOcr(
            img,
            img.naturalWidth,
            img.naturalHeight,
            variant,
          )
          const result = await engine.recognize(canvas, (p) => setProgress(p))
          if (!best || result.confidence > best.confidence) best = result
          if (result.plate && result.confidence >= 0.7) break
        }

        const result = best ?? {
          plate: '',
          rawText: '',
          confidence: 0,
          engine: 'tesseract.js',
        }

        void logOcrAttempt({
          detected: result.plate || result.rawText.slice(0, 64),
          corrected: '',
          confidence: result.confidence,
          engine: `${result.engine} (ملف)`,
        })

        stopCamera()
        onDetected(result.plate, {
          confidence: result.confidence,
          raw: result.rawText,
        })
      } catch (err) {
        setError(toArabicError(err))
        setPhase(streamRef.current ? 'live' : 'error')
        setProgress(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    [onDetected, stopCamera],
  )

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

        <div className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-6 text-brand-800">
          <p className="font-semibold">للحصول على أفضل قراءة:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            <li>املأ الإطار المتقطّع بالأرقام فقط قدر الإمكان</li>
            <li>اقترب حتى تصبح الأرقام كبيرة وواضحة</li>
            <li>تجنّب الظل المباشر وانعكاس الشمس على اللوحة</li>
            <li>أمسك الجهاز مستوياً — الميلان يصعّب القراءة</li>
          </ul>
          <p className="mt-2">
            <strong>الرقم المقروء سيُعرض عليك للتأكيد قبل التسجيل</strong> —
            يمكنك دائماً تعديله أو إدخاله يدوياً.
          </p>
        </div>

        {/* اختيار صورة جاهزة — بديل عند تعذّر الكاميرا أو لصورة أوضح */}
        <label
          className={cx(
            'flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50',
            processing && 'pointer-events-none opacity-50',
          )}
        >
          <ImageIcon className="h-4 w-4" aria-hidden />
          اختيار صورة من الجهاز
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={processing}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void readFromFile(file)
            }}
          />
        </label>

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
