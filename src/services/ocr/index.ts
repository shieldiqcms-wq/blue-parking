import { supabase } from '@/lib/supabase'
import { tesseractEngine } from './tesseractEngine'
import type { OcrEngine } from './types'

export type { OcrEngine, OcrProgress, OcrResult } from './types'

/**
 * المحرك النشط. لتبديل المحرك لاحقاً يكفي تغيير هذا السطر
 * أو استدعاء setOcrEngine() من مكان واحد.
 */
let activeEngine: OcrEngine = tesseractEngine

export function getOcrEngine(): OcrEngine {
  return activeEngine
}

export function setOcrEngine(engine: OcrEngine): void {
  activeEngine = engine
}

/**
 * يحسب عتبة Otsu — القيمة التي تفصل الأسود عن الأبيض بأفضل شكل
 * لهذه الصورة تحديداً، بدل عتبة ثابتة تفشل مع تغيّر الإضاءة.
 */
function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let maxVariance = 0
  let threshold = 128

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue

    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground

    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) ** 2

    if (variance > maxVariance) {
      maxVariance = variance
      threshold = t
    }
  }

  return threshold
}

/**
 * تحسين الصورة قبل القراءة.
 *
 * الخطوات: قصّ منطقة الإطار، تكبير، تدرّج رمادي، ثم تحويل إلى أبيض وأسود
 * بعتبة Otsu. الأخير هو الأهم: محرك القراءة يعمل على صور ثنائية اللون
 * بدقة أعلى بكثير من صور متدرّجة، والعتبة المحسوبة تتأقلم مع إضاءة
 * الموقف بدل أن تفشل في الظل أو تحت الشمس.
 *
 * `cropRight` يقصّ الجزء الأيمن فقط من الإطار — لوحات الأردن تحمل مربعاً
 * ثابتاً فيه «الأردن / JORDAN»، وتجاهله يقلّل الضجيج في القراءة.
 */
export function preprocessForOcr(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  options: { cropRight?: boolean } = {},
): HTMLCanvasElement {
  // منطقة الالتقاط: الشريط الأوسط حيث يوجّه المشغّل اللوحة
  let cropW = Math.round(sourceWidth * 0.86)
  const cropH = Math.round(sourceHeight * 0.32)
  let cropX = Math.round((sourceWidth - cropW) / 2)
  const cropY = Math.round((sourceHeight - cropH) / 2)

  if (options.cropRight) {
    // نتجاهل الثلث الأيسر حيث يقع مربع «الأردن / JORDAN»
    const trimmed = Math.round(cropW * 0.66)
    cropX = cropX + (cropW - trimmed)
    cropW = trimmed
  }

  const scale = Math.min(4, Math.max(1, 1400 / Math.max(1, cropW)))
  const outW = Math.round(cropW * scale)
  const outH = Math.round(cropH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, outW, outH)

  try {
    const image = ctx.getImageData(0, 0, outW, outH)
    const px = image.data
    const pixelCount = px.length / 4

    // 1) تدرّج رمادي + بناء المدرّج التكراري
    const histogram = new Array<number>(256).fill(0)
    for (let i = 0; i < px.length; i += 4) {
      const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
      px[i] = gray
      px[i + 1] = gray
      px[i + 2] = gray
      histogram[gray]++
    }

    // 2) عتبة محسوبة من الصورة نفسها
    const threshold = otsuThreshold(histogram, pixelCount)

    // 3) تحويل إلى أبيض وأسود
    for (let i = 0; i < px.length; i += 4) {
      const value = px[i] > threshold ? 255 : 0
      px[i] = value
      px[i + 1] = value
      px[i + 2] = value
    }

    ctx.putImageData(image, 0, 0)
  } catch {
    // بعض المتصفحات تمنع getImageData — نكتفي بالصورة كما هي
  }

  return canvas
}

/** حفظ محاولة القراءة للمراجعة لاحقاً — الفشل هنا لا يوقف العملية */
export async function logOcrAttempt(params: {
  detected: string
  corrected: string
  confidence: number
  engine: string
  sessionId?: string | null
}): Promise<void> {
  try {
    await supabase.rpc('log_ocr_capture', {
      p_detected_plate: params.detected || null,
      p_corrected_plate: params.corrected || null,
      p_confidence: params.confidence,
      p_engine: params.engine,
      p_session_id: params.sessionId ?? null,
    })
  } catch {
    // تسجيل اختياري — لا نعطّل تسجيل الدخول بسببه
  }
}
