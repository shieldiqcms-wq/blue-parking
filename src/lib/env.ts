/**
 * قراءة إعدادات البيئة والتحقق منها.
 * لا يوجد أي مفتاح مكتوب داخل الكود — كل شيء من متغيرات البيئة.
 */

export interface AppEnv {
  supabaseUrl: string
  supabaseKey: string
}

export interface EnvResult {
  ok: boolean
  env: AppEnv | null
  /** أسماء المتغيرات الناقصة أو غير الصالحة */
  missing: string[]
}

function read(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv]
  return typeof value === 'string' ? value.trim() : ''
}

export function loadEnv(): EnvResult {
  const missing: string[] = []

  const supabaseUrl = read('VITE_SUPABASE_URL')
  const supabaseKey = read('VITE_SUPABASE_PUBLISHABLE_KEY')

  if (!supabaseUrl || !/^https?:\/\//i.test(supabaseUrl)) {
    missing.push('VITE_SUPABASE_URL')
  }
  if (!supabaseKey) {
    missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  }

  if (missing.length > 0) {
    return { ok: false, env: null, missing }
  }

  return {
    ok: true,
    env: { supabaseUrl, supabaseKey: supabaseKey },
    missing: [],
  }
}

export const APP_NAME = 'Blue Parking'
export const CURRENCY = 'د.أ'
export const TIMEZONE = 'Asia/Amman'
