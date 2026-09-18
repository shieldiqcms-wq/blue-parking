import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { LogIn, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useOnline } from '@/hooks/useOnline'
import { Button, Card, Field, Input, LoadingBlock } from '@/components/ui'
import { APP_NAME } from '@/lib/env'

export function LoginPage() {
  const { session, isOwner, loading, signIn } = useAuth()
  const online = useOnline()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string
    password?: string
  }>({})
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-sand-100">
        <LoadingBlock label="جارٍ التحقق من الجلسة…" />
      </div>
    )
  }

  if (session && isOwner) return <Navigate to="/" replace />

  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {}
    if (!email.trim()) {
      errors.email = 'البريد الإلكتروني مطلوب'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'صيغة البريد الإلكتروني غير صحيحة'
    }
    if (!password) errors.password = 'كلمة المرور مطلوبة'

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!online) {
      setError('لا يوجد اتصال بالإنترنت')
      return
    }
    if (!validate()) return

    setSubmitting(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الدخول')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-800 via-brand-700 to-brand-900 px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-3 text-white">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/15 text-3xl backdrop-blur">
          🅿️
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-brand-100">نظام إدارة الموقف</p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <h2 className="text-lg font-bold text-slate-800">تسجيل الدخول</h2>

          <Field
            label="البريد الإلكتروني"
            htmlFor="email"
            required
            error={fieldErrors.email}
          >
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="username"
              dir="ltr"
              className="text-start"
              invalid={Boolean(fieldErrors.email)}
              disabled={submitting}
            />
          </Field>

          <Field
            label="كلمة المرور"
            htmlFor="password"
            required
            error={fieldErrors.password}
          >
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              dir="ltr"
              className="text-start"
              invalid={Boolean(fieldErrors.password)}
              disabled={submitting}
            />
          </Field>

          {!online && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800">
              لا يوجد اتصال بالإنترنت
            </p>
          )}

          {error && (
            <p
              className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            block
            loading={submitting}
            disabled={!online}
            icon={<LogIn className="h-5 w-5" aria-hidden />}
          >
            تسجيل الدخول
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-xs text-brand-200">
        هذا النظام مخصص لحساب المالك فقط ولا يوجد تسجيل حسابات جديدة.
      </p>
    </div>
  )
}
