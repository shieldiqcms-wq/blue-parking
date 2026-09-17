import { useEffect, useState, type FormEvent } from 'react'
import { Info, Save } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import {
  getActivePricingRule,
  getAppSettings,
  readString,
  setAppSetting,
  updatePricingRule,
  type PricingInput,
} from '@/services/settings'
import { toArabicError } from '@/lib/errors'
import { formatMoney, WEEKDAY_SHORT } from '@/lib/format'
import { APP_NAME, CURRENCY, TIMEZONE } from '@/lib/env'
import {
  Button,
  Card,
  CardTitle,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeading,
  Select,
} from '@/components/ui'
import { cx } from '@/lib/cx'
import type { RoundingMode } from '@/types/database'

export function SettingsPage() {
  const toast = useToast()
  const { profile, session } = useAuth()

  const pricing = useAsync(getActivePricingRule, [])
  const settings = useAsync(getAppSettings, [])

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="الإعدادات"
        description="تعديل التسعيرة يؤثر على العمليات الجديدة فقط"
      />

      {/* ------------------------------ التسعيرة ----------------------------- */}
      {pricing.loading && <LoadingBlock label="جارٍ تحميل التسعيرة…" />}
      {pricing.error && (
        <ErrorBlock message={pricing.error} onRetry={() => void pricing.reload()} />
      )}
      {pricing.data && (
        <PricingForm
          rule={pricing.data}
          onSaved={() => {
            toast.success('تم حفظ التسعيرة')
            void pricing.reload()
          }}
        />
      )}

      {/* --------------------------- معلومات الموقف --------------------------- */}
      {settings.loading && <LoadingBlock />}
      {settings.error && (
        <ErrorBlock
          message={settings.error}
          onRetry={() => void settings.reload()}
        />
      )}
      {settings.data && (
        <GeneralForm
          initial={settings.data}
          onSaved={() => {
            toast.success('تم حفظ الإعدادات')
            void settings.reload()
          }}
        />
      )}

      {/* ----------------------------- معلومات النظام ---------------------------- */}
      <Card>
        <CardTitle>معلومات النظام</CardTitle>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Row label="اسم التطبيق">{APP_NAME}</Row>
          <Row label="المستخدم الحالي">
            {profile?.full_name || session?.user.email || '—'}
          </Row>
          <Row label="البريد الإلكتروني">
            <span dir="ltr" className="num">
              {session?.user.email ?? '—'}
            </span>
          </Row>
          <Row label="المنطقة الزمنية">
            <span className="num">{TIMEZONE}</span>
          </Row>
          <Row label="العملة">{CURRENCY} — الدينار الأردني</Row>
          <Row label="الصلاحية">
            {profile?.role === 'owner' ? 'المالك' : profile?.role || '—'}
          </Row>
        </dl>

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs leading-6 text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          للنسخ الاحتياطي: صدّر بيانات العمليات من صفحة «التقارير» بصيغة CSV
          بشكل دوري. تصدير CSV يحفظ سجل العمليات فقط ولا يُعد نسخة احتياطية
          كاملة لقاعدة البيانات — للنسخة الكاملة استخدم أدوات النسخ الاحتياطي في
          لوحة Supabase.
        </p>
      </Card>
    </div>
  )
}

/* -------------------------------- التسعيرة -------------------------------- */

function PricingForm({
  rule,
  onSaved,
}: {
  rule: import('@/types/database').PricingRule
  onSaved: () => void
}) {
  const toForm = (r: import('@/types/database').PricingRule): PricingInput => ({
    name: r.name,
    base_amount: Number(r.base_amount),
    base_start_time: r.base_start_time.slice(0, 5),
    base_end_time: r.base_end_time.slice(0, 5),
    extra_hour_amount: Number(r.extra_hour_amount),
    rounding_mode: r.rounding_mode,
    grace_minutes: r.grace_minutes,
    charge_before_start: r.charge_before_start,
    closed_days: r.closed_days ?? [],
  })

  const [form, setForm] = useState<PricingInput>(() => toForm(rule))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(toForm(rule))
  }, [rule])

  const toggleClosedDay = (day: number) => {
    setForm((current) => ({
      ...current,
      closed_days: current.closed_days.includes(day)
        ? current.closed_days.filter((d) => d !== day)
        : [...current.closed_days, day].sort((a, b) => a - b),
    }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await updatePricingRule(rule.id, form)
      onSaved()
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardTitle>التسعيرة</CardTitle>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="اسم التسعيرة" htmlFor="p-name" required>
          <Input
            id="p-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={60}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="بداية الدوام" htmlFor="p-start" required>
            <Input
              id="p-start"
              type="time"
              value={form.base_start_time}
              onChange={(e) =>
                setForm({ ...form, base_start_time: e.target.value })
              }
            />
          </Field>
          <Field label="نهاية الدوام" htmlFor="p-end" required>
            <Input
              id="p-end"
              type="time"
              value={form.base_end_time}
              onChange={(e) =>
                setForm({ ...form, base_end_time: e.target.value })
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`المبلغ الأساسي (${CURRENCY})`}
            htmlFor="p-base"
            required
            hint="يغطي كامل فترة الدوام أعلاه"
          >
            <Input
              id="p-base"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={form.base_amount}
              onChange={(e) =>
                setForm({ ...form, base_amount: Number(e.target.value) })
              }
              className="num"
            />
          </Field>

          <Field
            label={`مبلغ الساعة الإضافية (${CURRENCY})`}
            htmlFor="p-extra"
            required
            hint="يُضاف عن كل ساعة بعد نهاية الدوام"
          >
            <Input
              id="p-extra"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={form.extra_hour_amount}
              onChange={(e) =>
                setForm({ ...form, extra_hour_amount: Number(e.target.value) })
              }
              className="num"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="طريقة حساب جزء الساعة" htmlFor="p-round" required>
            <Select
              id="p-round"
              value={form.rounding_mode}
              onChange={(e) =>
                setForm({
                  ...form,
                  rounding_mode: e.target.value as RoundingMode,
                })
              }
            >
              <option value="ceil_hour">أي جزء من الساعة = ساعة كاملة</option>
              <option value="exact_minutes">حساب دقيق بالدقائق</option>
            </Select>
          </Field>

          <Field
            label="فترة السماح (دقيقة)"
            htmlFor="p-grace"
            hint="تأخير مسموح بعد نهاية الدوام قبل بدء احتساب الزيادة"
          >
            <Input
              id="p-grace"
              type="number"
              inputMode="numeric"
              min="0"
              max="240"
              step="5"
              value={form.grace_minutes}
              onChange={(e) =>
                setForm({ ...form, grace_minutes: Number(e.target.value) })
              }
              className="num"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-3">
          <input
            type="checkbox"
            checked={form.charge_before_start}
            onChange={(e) =>
              setForm({ ...form, charge_before_start: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          <span className="text-sm text-slate-700">
            احتساب زيادة على الدخول قبل بداية الدوام
            <span className="mt-0.5 block text-xs text-slate-500">
              المبلغ الأساسي يغطي فقط من دخل داخل فترة الدوام
            </span>
          </span>
        </label>

        {/* --------------------------- أيام الإغلاق --------------------------- */}
        <Field
          label="أيام الإغلاق"
          hint="الأيام التي لا يوجد فيها دوام — يظهر تنبيه إذا سجّلت دخولاً فيها"
        >
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAY_SHORT.map((label, day) => {
              const closed = form.closed_days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleClosedDay(day)}
                  aria-pressed={closed}
                  className={cx(
                    'h-11 rounded-xl border-2 text-xs font-bold transition',
                    closed
                      ? 'border-rose-500 bg-rose-500 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {form.closed_days.length === 0
              ? 'الموقف يعمل كل أيام الأسبوع'
              : `مغلق: ${form.closed_days.map((d) => WEEKDAY_SHORT[d]).join(' و ')}`}
          </p>
        </Field>

        {/* ------------------------- شرح الحساب ------------------------- */}
        <div className="rounded-xl bg-brand-50 px-3.5 py-3 text-xs leading-6 text-brand-900">
          <p className="font-bold">كيف يُحسب المبلغ؟</p>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-5">
            <li>
              دخول وخروج داخل{' '}
              <span className="num font-semibold">
                {form.base_start_time}–{form.base_end_time}
              </span>{' '}
              ={' '}
              <span className="num font-semibold">
                {formatMoney(form.base_amount)}
              </span>{' '}
              {CURRENCY}
            </li>
            {form.grace_minutes > 0 && (
              <li>
                سماح <span className="num font-semibold">{form.grace_minutes}</span>{' '}
                دقيقة بعد{' '}
                <span className="num">{form.base_end_time}</span> بلا رسوم إضافية
              </li>
            )}
            <li>
              بعد ذلك:{' '}
              <span className="num font-semibold">
                {formatMoney(form.extra_hour_amount)}
              </span>{' '}
              {CURRENCY}{' '}
              {form.rounding_mode === 'ceil_hour'
                ? 'عن كل ساعة أو جزء منها'
                : 'لكل ساعة بالحساب الدقيق'}
            </li>
            {form.charge_before_start && (
              <li>
                الدخول قبل{' '}
                <span className="num">{form.base_start_time}</span> يُحاسب أيضاً:{' '}
                <span className="num font-semibold">
                  {formatMoney(form.extra_hour_amount)}
                </span>{' '}
                {CURRENCY} عن كل ساعة أو جزء منها قبل بداية الدوام
              </li>
            )}
            <li>السيارات المشتركة شهرياً لا تُحتسب عليها أي رسوم</li>
          </ul>
        </div>

        {error && (
          <p
            className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          loading={saving}
          icon={<Save className="h-5 w-5" aria-hidden />}
          className="self-start"
        >
          حفظ التسعيرة
        </Button>
      </form>
    </Card>
  )
}

/* ----------------------------- معلومات الموقف ----------------------------- */

function GeneralForm({
  initial,
  onSaved,
}: {
  initial: Record<string, unknown>
  onSaved: () => void
}) {
  const [parkingName, setParkingName] = useState(
    readString(initial, 'parking_name', 'موقف أبو حمدان'),
  )
  const [phone, setPhone] = useState(readString(initial, 'contact_phone'))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await setAppSetting('parking_name', parkingName.trim())
      await setAppSetting('contact_phone', phone.trim())
      onSaved()
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardTitle>معلومات الموقف</CardTitle>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="اسم الموقف" htmlFor="s-name">
          <Input
            id="s-name"
            value={parkingName}
            onChange={(e) => setParkingName(e.target.value)}
            maxLength={80}
          />
        </Field>

        <Field label="رقم التواصل" htmlFor="s-phone">
          <Input
            id="s-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
          />
        </Field>

        {error && (
          <p
            className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          loading={saving}
          icon={<Save className="h-4 w-4" aria-hidden />}
          className="self-start"
        >
          حفظ
        </Button>
      </form>
    </Card>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-800">{children}</dd>
    </div>
  )
}
