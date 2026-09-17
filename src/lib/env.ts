/**
 * قراءة إعدادات البيئة والتحقق منها.
 * لا يوجد أي مفتاح مكتوب داخل الكود — كل شيء من متغيرات البيئة.
 */

export interface AppEnv {
  supabaseUrl: string
  supabaseKey: string
}

export interface EnvProblem {
  /** اسم المتغير */
  name: string
  /** القيمة كما وُجدت (مختصرة، وبلا كشف المفاتيح) */
  value: string
  /** ما الخطأ */
  message: string
  /** ما هو المطلوب */
  hint: string
}

export interface EnvResult {
  ok: boolean
  env: AppEnv | null
  problems: EnvProblem[]
}

function read(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv]
  return typeof value === 'string' ? value.trim() : ''
}

/** يخفي وسط القيمة حتى لا تُعرض المفاتيح كاملة على الشاشة */
function mask(value: string): string {
  if (!value) return '(فارغ)'
  if (value.length <= 16) return value
  return `${value.slice(0, 12)}…${value.slice(-4)}`
}

const API_URL_HINT =
  'المطلوب رابط الـ API فقط بصيغة https://<project-ref>.supabase.co — ' +
  'مكانه: Project Settings › Data API › Project URL'

/**
 * التحقق من رابط Supabase.
 *
 * الخطأ الأكثر شيوعاً: نسخ الرابط من شريط عنوان المتصفح أثناء تصفّح لوحة
 * التحكم (https://supabase.com/dashboard/project/xxxx) بدل رابط الـ API.
 * هذا الخطأ يظهر للمستخدم كخطأ CORS غامض، فنكتشفه هنا برسالة واضحة.
 */
function checkUrl(value: string): Omit<EnvProblem, 'name' | 'value'> | null {
  if (!value) {
    return { message: 'غير مضبوط', hint: API_URL_HINT }
  }

  if (!/^https?:\/\//i.test(value)) {
    return {
      message: 'الرابط يجب أن يبدأ بـ https://',
      hint: API_URL_HINT,
    }
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { message: 'صيغة الرابط غير صحيحة', hint: API_URL_HINT }
  }

  // رابط لوحة التحكم بدل رابط الـ API
  if (/(^|\.)supabase\.com$/i.test(parsed.hostname)) {
    return {
      message: 'هذا رابط لوحة تحكم Supabase، وليس رابط الـ API',
      hint: API_URL_HINT,
    }
  }

  // رابط الـ API لا يحتوي أي مسار
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return {
      message: `الرابط يحتوي مساراً زائداً: ${parsed.pathname}`,
      hint: API_URL_HINT,
    }
  }

  if (parsed.search || parsed.hash) {
    return {
      message: 'الرابط يحتوي معاملات زائدة',
      hint: API_URL_HINT,
    }
  }

  return null
}

const KEY_HINT =
  'المطلوب المفتاح العام (Publishable أو anon) — ' +
  'مكانه: Project Settings › API Keys › Publishable key'

function checkKey(value: string): Omit<EnvProblem, 'name' | 'value'> | null {
  if (!value) {
    return { message: 'غير مضبوط', hint: KEY_HINT }
  }

  // المفتاح السري يتجاوز الحماية بالكامل ولا يجوز وضعه في الواجهة إطلاقاً
  if (/^sb_secret_/i.test(value) || /service_role/i.test(value)) {
    return {
      message:
        '⚠️ هذا مفتاح سري (Secret / service_role) ولا يجوز استخدامه في ' +
        'الواجهة — فهو يتجاوز كل سياسات الحماية. ألغِ هذا المفتاح فوراً من ' +
        'لوحة Supabase واستخدم المفتاح العام بدلاً منه.',
      hint: KEY_HINT,
    }
  }

  if (value.length < 20) {
    return { message: 'المفتاح قصير جداً — يبدو ناقصاً', hint: KEY_HINT }
  }

  return null
}

export function loadEnv(): EnvResult {
  const problems: EnvProblem[] = []

  const supabaseUrl = read('VITE_SUPABASE_URL')
  const supabaseKey = read('VITE_SUPABASE_PUBLISHABLE_KEY')

  const urlProblem = checkUrl(supabaseUrl)
  if (urlProblem) {
    problems.push({
      name: 'VITE_SUPABASE_URL',
      value: supabaseUrl || '(فارغ)',
      ...urlProblem,
    })
  }

  const keyProblem = checkKey(supabaseKey)
  if (keyProblem) {
    problems.push({
      name: 'VITE_SUPABASE_PUBLISHABLE_KEY',
      value: mask(supabaseKey),
      ...keyProblem,
    })
  }

  if (problems.length > 0) {
    return { ok: false, env: null, problems }
  }

  return {
    ok: true,
    env: { supabaseUrl, supabaseKey },
    problems: [],
  }
}

export const APP_NAME = 'Blue Parking'
export const CURRENCY = 'د.أ'
export const TIMEZONE = 'Asia/Amman'
