/**
 * توحيد أرقام اللوحات — نسخة الواجهة.
 *
 * ⚠️ هذه الدالة يجب أن تبقى مطابقة تماماً لدالة `public.normalize_plate`
 *    في supabase/migrations/20260101000000_schema.sql
 *    المطابقة النهائية تتم دائماً في قاعدة البيانات؛ هذه النسخة للبحث
 *    الفوري والتحقق في الواجهة فقط.
 *
 * ما تفعله:
 *   • الأرقام العربية-الهندية ٠-٩ والفارسية ۰-۹  ->  0-9
 *   • صور الألف  أ إ آ ٱ  ->  ا
 *   • الألف المقصورة  ى  ->  ي
 *   • حذف المسافات والشرطات والنقاط وأي رمز آخر
 *   • حذف التطويل والتشكيل
 *   • الحروف اللاتينية إلى Uppercase
 *
 * ما لا تفعله عمداً (حتى لا تتحوّل لوحتان مختلفتان إلى نفس القيمة):
 *   • لا تحوّل ة -> ه   ولا  ؤ/ئ -> و/ي
 *   • لا تحذف الأصفار البادئة
 */

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

const LETTER_MAP: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ى': 'ي',
}

/** يبقي: 0-9، A-Z، والحروف العربية ء..غ و ف..ي (يستبعد التطويل والتشكيل) */
const KEEP_RE = /[^0-9A-Zء-غف-ي]+/g

export function normalizePlate(input: string | null | undefined): string {
  if (!input) return ''

  let out = ''
  for (const ch of input) {
    out += DIGIT_MAP[ch] ?? LETTER_MAP[ch] ?? ch
  }

  return out.toUpperCase().replace(KEEP_RE, '')
}

/** هل رقم اللوحة صالح للحفظ؟ */
export function isValidPlate(input: string | null | undefined): boolean {
  const normalized = normalizePlate(input)
  return normalized.length >= 1 && normalized.length <= 32
}

/**
 * تنسيق رقم اللوحة للعرض — يحافظ على النص كما أدخله المستخدم
 * ويكتفي بتنظيف المسافات الزائدة.
 */
export function displayPlate(input: string | null | undefined): string {
  if (!input) return '—'
  return input.trim().replace(/\s+/g, ' ')
}

/**
 * تحويل الأرقام العربية إلى لاتينية أثناء الكتابة،
 * مع الحفاظ على الشرطة والمسافة كما كتبها المستخدم.
 */
export function toLatinDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    out += DIGIT_MAP[ch] ?? ch
  }
  return out
}
