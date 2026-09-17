/**
 * واجهة محرك قراءة اللوحة.
 *
 * التصميم مقصود أن يكون قابلاً للاستبدال: أي محرك آخر (سحابي أو محلي)
 * يكفي أن ينفّذ هذه الواجهة ويُسجَّل في `src/services/ocr/index.ts`
 * دون تعديل أي شاشة في التطبيق.
 *
 * قاعدة ثابتة: نتيجة المحرك لا تُعتمد أبداً بشكل تلقائي — المشغّل
 * يجب أن يؤكد أو يصحّح الرقم قبل التسجيل.
 */

export interface OcrResult {
  /** النص الخام كما قرأه المحرك */
  rawText: string
  /** أفضل تخمين لرقم اللوحة بعد التنظيف — قد يكون فارغاً */
  plate: string
  /** درجة الثقة من 0 إلى 1 */
  confidence: number
  /** اسم المحرك المستخدم — يُسجَّل في ocr_captures */
  engine: string
}

export interface OcrProgress {
  /** من 0 إلى 1 */
  progress: number
  /** وصف عربي للمرحلة الحالية */
  label: string
}

export interface OcrEngine {
  readonly name: string
  /** تحميل الموارد اللازمة (قد يستغرق وقتاً في أول مرة) */
  warmup?: (onProgress?: (p: OcrProgress) => void) => Promise<void>
  /** قراءة صورة وإرجاع النتيجة */
  recognize: (
    image: Blob | HTMLCanvasElement,
    onProgress?: (p: OcrProgress) => void,
  ) => Promise<OcrResult>
  /** تحرير الموارد */
  dispose?: () => Promise<void>
}
