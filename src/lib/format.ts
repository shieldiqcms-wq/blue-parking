import { TIMEZONE } from './env'

/**
 * تنسيق التواريخ والمبالغ بتوقيت الأردن.
 * الأرقام تُعرض لاتينية (0-9) لأنها أوضح في سياق لوحات السيارات والمبالغ.
 */

const dateTimeFmt = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const timeFmt = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const dateFmt = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const longDateFmt = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeZone: TIMEZONE,
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = parse(value)
  return d ? dateTimeFmt.format(d) : '—'
}

export function formatTime(value: string | Date | null | undefined): string {
  const d = parse(value)
  return d ? timeFmt.format(d) : '—'
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = parse(value)
  return d ? dateFmt.format(d) : '—'
}

/**
 * تاريخ رقمي نظيف `DD/MM/YYYY` بلا أي علامات اتجاه.
 *
 * لماذا؟ تنسيق `ar-JO` يُدرج علامات اتجاه خفية (RLM ‏U+200F) بين أجزاء
 * التاريخ لضبط عرضه داخل نص عربي. لكن حين يُوضع الناتج داخل عنصر اتجاهه
 * LTR — مثل خانات الأرقام في الجداول — تتصارع العلامتان فيتفكك التاريخ
 * ويظهر مثل «182026/09/» بدل «18/09/2026».
 *
 * `en-GB` يعطي نفس الترتيب (يوم/شهر/سنة) بأرقام لاتينية وبلا أي علامة
 * اتجاه، فيُعرض صحيحاً في الجداول والأعمدة الرقمية.
 */
const numericDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatDateNumeric(
  value: string | Date | null | undefined,
): string {
  const d = parse(value)
  return d ? numericDateFmt.format(d) : '—'
}

export function formatLongDate(value: string | Date | null | undefined): string {
  const d = parse(value)
  return d ? longDateFmt.format(d) : '—'
}

/** مبلغ بالدينار الأردني — منزلتان عشريتان دائماً */
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === null || n === undefined || Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

/** مدة بالدقائق -> نص عربي مقروء */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—'
  const total = Math.max(0, Math.round(minutes))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60

  const parts: string[] = []
  if (days > 0) parts.push(days === 1 ? 'يوم' : days === 2 ? 'يومان' : `${days} أيام`)
  if (hours > 0) {
    parts.push(hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتان' : `${hours} ساعات`)
  }
  if (mins > 0 && days === 0) {
    parts.push(mins === 1 ? 'دقيقة' : mins === 2 ? 'دقيقتان' : `${mins} دقيقة`)
  }
  if (parts.length === 0) return 'أقل من دقيقة'
  return parts.join(' و')
}

/** المدة منذ وقت الدخول حتى الآن */
export function minutesSince(value: string | Date): number {
  const d = parse(value)
  if (!d) return 0
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
}

/* ------------------------- تنسيق خاص بتصدير CSV ------------------------- */

const csvDateTimeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * تاريخ ووقت بصيغة `YYYY-MM-DD HH:mm` (24 ساعة).
 *
 * التنسيق العربي للعرض يحتوي علامات اتجاه خفية (U+200F) وصيغة 12 ساعة
 * بـ «ص/م» — وكلاهما يمنع Excel من التعرّف على الخلية كتاريخ، فتبقى نصاً
 * لا يمكن فرزه أو حسابه. هذه الصيغة يفهمها Excel مباشرة.
 */
export function formatDateTimeForCsv(
  value: string | Date | null | undefined,
): string {
  const d = parse(value)
  if (!d) return ''
  // en-CA يعطي "2026-09-17, 22:58" — نزيل الفاصلة فقط
  return csvDateTimeFmt.format(d).replace(',', '')
}

/** تاريخ فقط بصيغة `YYYY-MM-DD` — يفهمها Excel كتاريخ */
export function formatDateForCsv(
  value: string | Date | null | undefined,
): string {
  const d = parse(value)
  return d ? ammanDateOf(d) : ''
}

const ammanPartsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * يحوّل لحظة زمنية إلى تاريخ «ساعة حائط» بتوقيت الأردن، لاستخدامه في Excel.
 *
 * Excel لا يعرف المناطق الزمنية — يخزّن رقماً يمثّل ساعة حائط مجرّدة.
 * فلو مرّرنا اللحظة كما هي لظهر التوقيت العالمي (أقل بثلاث ساعات).
 * هنا نبني تاريخاً حقولُه بالتوقيت العالمي تساوي حقول التوقيت الأردني،
 * فيقرأه Excel كما يراه المستخدم.
 */
export function toExcelDate(
  value: string | Date | null | undefined,
): Date | null {
  const d = parse(value)
  if (!d) return null

  const parts: Record<string, string> = {}
  for (const part of ammanPartsFmt.formatToParts(d)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }

  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    ),
  )
}

/** مبلغ للتصدير — رقم صافٍ بلا رموز حتى يُحسب في Excel */
export function formatMoneyForCsv(
  value: number | string | null | undefined,
): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === null || n === undefined || Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

/** تاريخ اليوم بصيغة YYYY-MM-DD بتوقيت الأردن */
export function ammanToday(): string {
  return ammanDateOf(new Date())
}

/** تحويل أي وقت إلى تاريخ YYYY-MM-DD بتوقيت الأردن */
export function ammanDateOf(value: string | Date): string {
  const d = parse(value)
  if (!d) return ''
  // en-CA يعطي صيغة YYYY-MM-DD مباشرة
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** إضافة أيام إلى تاريخ بصيغة YYYY-MM-DD */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** إضافة أشهر إلى تاريخ بصيغة YYYY-MM-DD */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

/** أول يوم في الشهر الحالي (توقيت الأردن) */
export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`
}

/** بداية الأسبوع (الأحد) */
export function startOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return date.toISOString().slice(0, 10)
}

/* ----------------------------- تسميات عربية ----------------------------- */

export const SESSION_TYPE_LABEL: Record<string, string> = {
  one_time: 'زيارة عادية',
  monthly: 'اشتراك شهري',
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_required: 'غير مطلوب',
  unpaid: 'غير مدفوع',
  paid: 'مدفوع',
  waived: 'معفى',
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'نقدي',
  transfer: 'تحويل',
  other: 'أخرى',
}

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: 'ساري',
  expired: 'منتهي',
  upcoming: 'لم يبدأ',
  cancelled: 'ملغي',
}

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  wipe: 'تمسيح',
  wash: 'غسيل',
  other: 'خدمة أخرى',
}

export const COST_CENTER_LABEL: Record<string, string> = {
  parking: 'الموقف',
  wash: 'غسيل السيارات',
  shared: 'مشترك',
}

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  water: 'ماء',
  electricity: 'كهرباء',
  staff: 'موظف مساعد',
  maintenance: 'صيانة',
  other: 'أخرى',
}

export const WEEKDAY_SHORT = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
]
