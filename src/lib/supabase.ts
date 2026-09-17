import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from './env'

const result = loadEnv()

/** أسماء المتغيرات الناقصة — تُعرض للمستخدم في شاشة الإعداد */
export const missingEnvVars = result.missing

/** هل الإعداد مكتمل؟ */
export const isConfigured = result.ok

function createStub(): SupabaseClient {
  // عميل وهمي يمنع انهيار التطبيق قبل ضبط متغيرات البيئة.
  // شاشة `MissingConfig` تُعرض بدلاً من التطبيق في هذه الحالة.
  const message =
    'لم يتم ضبط الاتصال بقاعدة البيانات. راجع ملف ‎.env.local‎'
  const handler: ProxyHandler<object> = {
    get() {
      throw new Error(message)
    },
  }
  return new Proxy({}, handler) as SupabaseClient
}

export const supabase: SupabaseClient = result.ok
  ? createClient(result.env!.supabaseUrl, result.env!.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'blue-parking-auth',
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-application-name': 'blue-parking' },
      },
    })
  : createStub()
