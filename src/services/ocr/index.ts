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
 * تحسين الصورة قبل القراءة: قصّ الوسط، تكبير، تدرّج رمادي، ورفع التباين.
 * يزيد بشكل ملحوظ من فرصة قراءة اللوحة بشكل صحيح.
 */
export function preprocessForOcr(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  // منطقة الالتقاط: الشريط الأوسط حيث يوجّه المشغّل اللوحة
  const cropW = Math.round(sourceWidth * 0.86)
  const cropH = Math.round(sourceHeight * 0.32)
  const cropX = Math.round((sourceWidth - cropW) / 2)
  const cropY = Math.round((sourceHeight - cropH) / 2)

  const scale = Math.min(3, Math.max(1, 1000 / Math.max(1, cropW)))
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

    // 1) تدرّج رمادي + حساب المتوسط
    let sum = 0
    for (let i = 0; i < px.length; i += 4) {
      const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
      px[i] = gray
      px[i + 1] = gray
      px[i + 2] = gray
      sum += gray
    }
    const mean = sum / (px.length / 4)

    // 2) رفع التباين حول المتوسط
    const contrast = 1.6
    for (let i = 0; i < px.length; i += 4) {
      const adjusted = Math.max(
        0,
        Math.min(255, (px[i] - mean) * contrast + mean),
      )
      px[i] = adjusted
      px[i + 1] = adjusted
      px[i + 2] = adjusted
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
