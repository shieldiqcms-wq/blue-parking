/**
 * ترجمة أخطاء Supabase / الشبكة إلى رسائل عربية واضحة للمستخدم.
 * كل رسالة تصل إلى المستخدم تمر من هنا.
 */

interface ErrorLike {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
  status?: unknown
  error_description?: unknown
}

/** أخطاء المصادقة من Supabase Auth */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  invalid_grant: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  email_not_confirmed: 'لم يتم تأكيد البريد الإلكتروني بعد',
  user_not_found: 'لا يوجد حساب بهذا البريد الإلكتروني',
  over_request_rate_limit: 'محاولات كثيرة جداً. انتظر قليلاً ثم أعد المحاولة',
  over_email_send_rate_limit: 'محاولات كثيرة جداً. انتظر قليلاً ثم أعد المحاولة',
  weak_password: 'كلمة المرور ضعيفة جداً',
  session_expired: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد',
  signup_disabled: 'إنشاء الحسابات معطّل في هذا النظام',
  email_address_invalid: 'صيغة البريد الإلكتروني غير صحيحة',
}

/** أكواد أخطاء PostgreSQL / PostgREST */
const PG_MESSAGES: Record<string, string> = {
  '23505': 'هذا السجل موجود مسبقاً',
  '23503': 'لا يمكن تنفيذ العملية لوجود بيانات مرتبطة',
  '23514': 'البيانات المُدخلة غير صالحة',
  '23502': 'هناك حقل مطلوب لم يتم تعبئته',
  '22P02': 'صيغة البيانات المُدخلة غير صحيحة',
  '42501': 'ليس لديك صلاحية لتنفيذ هذه العملية',
  '42P01': 'قاعدة البيانات غير مهيأة. شغّل ملفات الـ migrations أولاً',
  '42883': 'قاعدة البيانات غير مهيأة. شغّل ملفات الـ migrations أولاً',
  PGRST301: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول من جديد',
  PGRST116: 'لا توجد بيانات مطابقة',
  PGRST202: 'قاعدة البيانات غير مهيأة. شغّل ملفات الـ migrations أولاً',
}

/** رسائل مخصّصة لبعض الحالات الشائعة في هذا النظام */
const CONSTRAINT_MESSAGES: Array<[RegExp, string]> = [
  [/vehicles_plate_normalized_key/i, 'هذه السيارة مسجّلة مسبقاً'],
  [/parking_sessions_one_active_per_vehicle/i, 'السيارة موجودة بالفعل داخل الموقف'],
  [/pricing_rules_single_active/i, 'يوجد قاعدة تسعير فعّالة بالفعل'],
  [/subscriptions_dates_valid/i, 'تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية'],
  [/session_time_valid/i, 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول'],
  [/pricing_time_valid/i, 'نهاية الدوام يجب أن تكون بعد بدايته'],
  [/pricing_amounts_valid/i, 'المبالغ يجب أن تكون صفراً أو أكثر'],
  [/vehicles_plate_not_blank/i, 'رقم اللوحة مطلوب'],
]

/** يحدّد إن كان النص عربياً (رسائل الأخطاء القادمة من دوال قاعدة البيانات) */
function isArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text)
}

export function toArabicError(error: unknown): string {
  if (!error) return 'حدث خطأ غير متوقع'

  if (typeof error === 'string') {
    return isArabic(error) ? error : 'حدث خطأ غير متوقع'
  }

  const err = error as ErrorLike
  const rawMessage =
    (typeof err.message === 'string' && err.message) ||
    (typeof err.error_description === 'string' && err.error_description) ||
    ''
  const code = typeof err.code === 'string' ? err.code : ''
  const details = typeof err.details === 'string' ? err.details : ''
  const status = typeof err.status === 'number' ? err.status : 0

  // 1) رسالة عربية قادمة من دوال قاعدة البيانات — تُعرض كما هي
  if (isArabic(rawMessage)) return rawMessage

  // 2) قيود قاعدة البيانات
  const haystack = `${rawMessage} ${details}`
  for (const [pattern, message] of CONSTRAINT_MESSAGES) {
    if (pattern.test(haystack)) return message
  }

  // 3) أكواد معروفة
  if (code && PG_MESSAGES[code]) return PG_MESSAGES[code]
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code]

  // 4) مطابقة نصية لأخطاء Auth
  const lower = rawMessage.toLowerCase()
  if (lower.includes('invalid login credentials')) {
    return AUTH_MESSAGES.invalid_credentials
  }
  if (lower.includes('email not confirmed')) {
    return AUTH_MESSAGES.email_not_confirmed
  }
  if (lower.includes('jwt') && lower.includes('expired')) {
    return AUTH_MESSAGES.session_expired
  }
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return AUTH_MESSAGES.signup_disabled
  }

  // 5) أخطاء الشبكة
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed')
  ) {
    return navigator.onLine
      ? 'تعذر الاتصال بقاعدة البيانات. تحقق من إعدادات الاتصال'
      : 'لا يوجد اتصال بالإنترنت'
  }

  if (status === 401 || status === 403) {
    return 'ليس لديك صلاحية لتنفيذ هذه العملية'
  }
  if (status === 404) {
    return 'الخدمة المطلوبة غير متوفرة'
  }
  if (status >= 500) {
    return 'حدث خطأ في الخادم. أعد المحاولة بعد قليل'
  }

  return 'حدث خطأ غير متوقع. أعد المحاولة'
}

/** خطأ يُرمى من طبقة الخدمات برسالة عربية جاهزة */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}
