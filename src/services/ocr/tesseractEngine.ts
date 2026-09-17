import { parseJordanianPlate } from './plateParser'
import type { OcrEngine, OcrProgress, OcrResult } from './types'

/**
 * محرك قراءة مجاني يعمل بالكامل داخل المتصفح (tesseract.js).
 * لا يرسل الصورة إلى أي خادم خارجي ولا يحتاج أي API مدفوع.
 *
 * ملاحظة واقعية: دقة القراءة على لوحات السيارات متفاوتة —
 * لذلك التطبيق يُلزم المشغّل بتأكيد الرقم قبل التسجيل.
 */

type TesseractWorker = {
  recognize: (image: Blob | HTMLCanvasElement) => Promise<{
    data: { text: string; confidence: number }
  }>
  setParameters: (params: Record<string, string>) => Promise<unknown>
  terminate: () => Promise<unknown>
}

const ENGINE_NAME = 'tesseract.js'

/**
 * أوضاع تقسيم الصفحة التي نجرّبها بالترتيب.
 *
 * اللوحة الأردنية شكلان: سطران (رمز فوق ورقم تحت) وسطر واحد. لا يوجد وضع
 * واحد يقرأ الشكلين، لذلك نجرّب أكثر من وضع ونأخذ أفضل نتيجة.
 *
 *  6  = كتلة نص موحّدة  → الأنسب للوحة ذات السطرين
 *  7  = سطر واحد        → الأنسب للوحة ذات السطر الواحد
 *  11 = نص متفرّق       → احتياطي عند ضعف الإضاءة
 */
const PAGE_SEG_MODES = ['6', '7', '11'] as const

let workerPromise: Promise<TesseractWorker> | null = null

async function getWorker(
  onProgress?: (p: OcrProgress) => void,
): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise

  workerPromise = (async () => {
    onProgress?.({ progress: 0.05, label: 'جارٍ تحميل محرك القراءة…' })

    const { createWorker } = await import('tesseract.js')

    const worker = (await createWorker('eng', 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (!onProgress) return
        const progress = typeof m.progress === 'number' ? m.progress : 0
        const label =
          m.status === 'loading tesseract core'
            ? 'جارٍ تحميل محرك القراءة…'
            : m.status === 'loading language traineddata' ||
                m.status === 'downloading'
              ? 'جارٍ تحميل بيانات اللغة…'
              : m.status === 'initializing api' ||
                  m.status === 'initializing tesseract'
                ? 'جارٍ تجهيز المحرك…'
                : 'جارٍ قراءة اللوحة…'
        onProgress({ progress: Math.max(0.05, progress), label })
      },
    })) as unknown as TesseractWorker

    return worker
  })()

  try {
    return await workerPromise
  } catch (error) {
    workerPromise = null
    throw error
  }
}

interface Attempt {
  rawText: string
  plate: string
  /** ثقة مركّبة: ثقة المحرك × ثقة بنية اللوحة */
  score: number
  engineConfidence: number
}

export const tesseractEngine: OcrEngine = {
  name: ENGINE_NAME,

  async warmup(onProgress) {
    await getWorker(onProgress)
    onProgress?.({ progress: 1, label: 'المحرك جاهز' })
  },

  async recognize(image, onProgress): Promise<OcrResult> {
    const worker = await getWorker(onProgress)

    const attempts: Attempt[] = []

    for (let i = 0; i < PAGE_SEG_MODES.length; i++) {
      const mode = PAGE_SEG_MODES[i]

      onProgress?.({
        progress: 0.5 + (i / PAGE_SEG_MODES.length) * 0.45,
        label: `جارٍ قراءة اللوحة… (محاولة ${i + 1} من ${PAGE_SEG_MODES.length})`,
      })

      await worker.setParameters({
        // لوحات السيارات في الأردن رقمية بالكامل
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: mode,
        preserve_interword_spaces: '1',
      })

      const { data } = await worker.recognize(image)
      const rawText = (data.text ?? '').trim()
      const engineConfidence = Math.max(
        0,
        Math.min(1, (data.confidence ?? 0) / 100),
      )

      const { plate, structureConfidence } = parseJordanianPlate(rawText)

      attempts.push({
        rawText,
        plate,
        engineConfidence,
        score: plate ? engineConfidence * structureConfidence : 0,
      })

      // قراءة واضحة جداً — لا داعي لبقية المحاولات
      if (plate && engineConfidence >= 0.85 && structureConfidence >= 0.9) {
        break
      }
    }

    onProgress?.({ progress: 1, label: 'تمت القراءة' })

    const best = attempts.reduce(
      (a, b) => (b.score > a.score ? b : a),
      attempts[0] ?? { rawText: '', plate: '', score: 0, engineConfidence: 0 },
    )

    return {
      rawText: best.rawText,
      plate: best.plate,
      // نعرض للمشغّل الثقة المركّبة لا ثقة المحرك وحدها — فقراءة أرقام
      // بثقة عالية لكن بشكل غير منطقي للوحة لا تستحق ثقة عالية.
      confidence: best.plate ? best.score : 0,
      engine: ENGINE_NAME,
    }
  },

  async dispose() {
    if (!workerPromise) return
    try {
      const worker = await workerPromise
      await worker.terminate()
    } catch {
      // تجاهل — المحرك قد يكون فشل أصلاً في التحميل
    } finally {
      workerPromise = null
    }
  },
}
