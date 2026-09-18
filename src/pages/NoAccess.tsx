import { ShieldX } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button, Card } from '@/components/ui'

/**
 * تُعرض عندما يسجّل مستخدم الدخول بحساب لا يملك صلاحية المالك.
 * الحماية الحقيقية في قاعدة البيانات (RLS) — هذه الشاشة للتوضيح فقط.
 */
export function NoAccessPage() {
  const { session, profile, signOut, refreshProfile } = useAuth()

  return (
    <div className="grid min-h-screen place-items-center bg-sand-100 px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <ShieldX className="mx-auto h-14 w-14 text-rose-500" aria-hidden />

        <h1 className="mt-4 text-xl font-bold text-slate-900">
          لا تملك صلاحية الوصول
        </h1>

        <p className="mt-2 text-sm leading-7 text-slate-600">
          هذا الحساب مسجّل في النظام لكنه لا يملك صلاحية المالك، ولا يمكنه رؤية
          بيانات الموقف.
        </p>

        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-start text-xs leading-6 text-slate-600">
          <p>
            الحساب:{' '}
            <span className="num font-semibold" dir="ltr">
              {session?.user.email ?? '—'}
            </span>
          </p>
          <p className="mt-1">
            الصلاحية الحالية:{' '}
            <span className="font-semibold">
              {profile?.role ?? 'لا يوجد ملف شخصي'}
            </span>
          </p>
          <p className="mt-2 text-slate-500">
            لمنح الصلاحية: شغّل ملف{' '}
            <code className="rounded bg-slate-200 px-1">
              supabase/sql/promote_owner.sql
            </code>{' '}
            من SQL Editor في لوحة Supabase.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="secondary" onClick={() => void refreshProfile()}>
            إعادة التحقق
          </Button>
          <Button variant="danger" onClick={() => void signOut()}>
            تسجيل الخروج
          </Button>
        </div>
      </Card>
    </div>
  )
}
