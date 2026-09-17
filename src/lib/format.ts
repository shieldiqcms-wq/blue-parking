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

export const WEEKDAY_SHORT = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
]
