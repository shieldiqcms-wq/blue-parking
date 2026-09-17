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

    // لوحات السيارات في الأردن رقمية بالكامل
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      // 7 = سطر واحد، الأنسب للوحات
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
    })

    return worker
  })()

  try {
    return await workerPromise
  } catch (error) {
    workerPromise = null
    throw error
  }
}

/** استخراج أفضل تخمين لرقم اللوحة من النص الخام */
function extractPlate(rawText: string): string {
  const digitGroups = rawText.match(/\d+/g) ?? []
  if (digitGroups.length === 0) return ''

  // لوحة أردنية نموذجية: رمز المنطقة (1–2 خانة) + الرقم (4–6 خانات)
  const meaningful = digitGroups.filter((g) => g.length >= 2)
  if (meaningful.length === 0) return ''

  if (meaningful.length >= 2) {
    const [first, second] = meaningful
    if (first.length <= 2 && second.length >= 4) {
      return `${first}-${second}`
    }
    if (second.length <= 2 && first.length >= 4) {
      return `${second}-${first}`
    }
  }

  const longest = meaningful.reduce((a, b) => (b.length > a.length ? b : a))
  if (longest.length >= 6 && longest.length <= 8) {
    // فصل رمز المنطقة عن الرقم
    const split = longest.length - 5
    return `${longest.slice(0, split)}-${longest.slice(split)}`
  }

  return longest
}

export const tesseractEngine: OcrEngine = {
  name: ENGINE_NAME,

  async warmup(onProgress) {
    await getWorker(onProgress)
    onProgress?.({ progress: 1, label: 'المحرك جاهز' })
  },

  async recognize(image, onProgress): Promise<OcrResult> {
    const worker = await getWorker(onProgress)

    onProgress?.({ progress: 0.6, label: 'جارٍ قراءة اللوحة…' })
    const { data } = await worker.recognize(image)
    onProgress?.({ progress: 1, label: 'تمت القراءة' })

    const rawText = (data.text ?? '').trim()
    const confidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100))

    return {
      rawText,
      plate: extractPlate(rawText),
      confidence,
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
