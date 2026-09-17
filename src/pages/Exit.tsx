import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Banknote,
  Camera,
  CheckCircle2,
  Clock,
  LogOut,
  Search,
  Ticket,
} from 'lucide-react'
import { PlateCamera } from '@/components/PlateCamera'
import { PlateInput } from '@/components/PlateInput'
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeading,
  Select,
  Textarea,
} from '@/components/ui'
import { cx } from '@/lib/cx'
import { useAction } from '@/hooks/useAsync'
import { useOnline } from '@/hooks/useOnline'
import { useToast } from '@/hooks/useToast'
import { lookupPlate, previewExit, registerExit } from '@/services/parking'
import { displayPlate, isValidPlate } from '@/lib/plate'
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  PAYMENT_METHOD_LABEL,
} from '@/lib/format'
import { CURRENCY } from '@/lib/env'
import type {
  PaymentMethod,
  PreviewExitResult,
  RegisterExitResult,
} from '@/types/database'

type PayChoice = 'paid' | 'unpaid' | 'waived'

export function ExitPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const online = useOnline()
  const plateRef = useRef<HTMLInputElement>(null)

  const presetSessionId =
    (location.state as { sessionId?: string } | null)?.sessionId ?? null

  const [plate, setPlate] = useState('')
  const [plateError, setPlateError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [ocrNotice, setOcrNotice] = useState<string | null>(null)

  const [preview, setPreview] = useState<PreviewExitResult | null>(null)
  const [payChoice, setPayChoice] = useState<PayChoice>('paid')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<RegisterExitResult | null>(null)

  const findAction = useAction(async (value: string) => {
    const found = await lookupPlate(value)
    if (!found.found) {
      throw new Error('لا توجد سيارة بهذا الرقم')
    }
    if (!found.active_session) {
      throw new Error('لا توجد حركة دخول نشطة لهذه السيارة')
    }
    return previewExit(found.active_session.id)
  })

  const loadByIdAction = useAction(previewExit)
  const exitAction = useAction(registerExit)

  /* -------- تحميل مباشر عند القدوم من صفحة "السيارات الموجودة" -------- */
  const loadedPreset = useRef(false)
  const loadById = loadByIdAction.run

  useEffect(() => {
    if (!presetSessionId || loadedPreset.current) return
    loadedPreset.current = true

    void loadById(presetSessionId)
      .then((data) => {
        if (data) setPreview(data)
      })
      .catch(() => undefined)
  }, [presetSessionId, loadById])

  const handleDetected = useCallback(
    (detected: string, meta: { confidence: number }) => {
      setCameraOpen(false)
      if (!detected) {
        setOcrNotice('تعذر قراءة اللوحة، يرجى إدخال الرقم يدوياً')
        window.setTimeout(() => plateRef.current?.focus(), 50)
        return
      }
      setPlate(detected)
      setOcrNotice(
        `تمت قراءة الرقم بنسبة ثقة ${Math.round(meta.confidence * 100)}% — راجعه قبل المتابعة`,
      )
      window.setTimeout(() => plateRef.current?.focus(), 50)
    },
    [],
  )

  const handleSearch = async () => {
    setPlateError(null)
    setPreview(null)

    if (!isValidPlate(plate)) {
      setPlateError('رقم اللوحة مطلوب')
      return
    }
    if (!online) {
      toast.error('لا يوجد اتصال بالإنترنت')
      return
    }

    try {
      const data = await findAction.run(plate)
      if (data) setPreview(data)
    } catch {
      // الرسالة معروضة في findAction.error
    }
  }

  const handleExit = async () => {
    if (!preview) return
    if (!online) {
      toast.error('لا يوجد اتصال بالإنترنت')
      return
    }

    const isMonthly = preview.session.session_type === 'monthly'

    try {
      const data = await exitAction.run({
        sessionId: preview.session.id,
        paymentStatus: isMonthly ? 'paid' : payChoice,
        paymentMethod: payMethod,
        notes: notes || null,
      })
      if (!data) return

      setResult(data)
      toast.success('تم تسجيل خروج السيارة بنجاح')
    } catch {
      // الرسالة معروضة في exitAction.error
    }
  }

  const reset = () => {
    setPlate('')
    setPlateError(null)
    setPreview(null)
    setResult(null)
    setNotes('')
    setPayChoice('paid')
    setPayMethod('cash')
    setOcrNotice(null)
    loadedPreset.current = true
    window.setTimeout(() => plateRef.current?.focus(), 50)
  }

  /* ------------------------------ شاشة النجاح ----------------------------- */

  if (result) {
    const monthly = result.session.session_type === 'monthly'
    return (
      <div className="flex flex-col gap-4">
        <PageHeading title="تم تسجيل الخروج" />

        <Card className="text-center">
          <CheckCircle2
            className="mx-auto h-14 w-14 text-emerald-500"
            aria-hidden
          />
          <p className="num mt-3 text-3xl font-bold text-slate-900">
            {displayPlate(result.vehicle.plate_number)}
          </p>

          <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-5">
            <p className="text-sm font-medium text-slate-500">المبلغ المستحق</p>
            <p className="mt-1 flex items-baseline justify-center gap-2">
              <span className="num text-4xl font-bold text-slate-900">
                {formatMoney(result.amount_due)}
              </span>
              <span className="text-lg font-semibold text-slate-500">
                {CURRENCY}
              </span>
            </p>
            <div className="mt-3 flex justify-center">
              {monthly ? (
                <Badge tone="violet">اشتراك شهري — بلا رسوم</Badge>
              ) : result.payment_status === 'paid' ? (
                <Badge tone="green">مدفوع</Badge>
              ) : result.payment_status === 'waived' ? (
                <Badge tone="slate">معفى</Badge>
              ) : (
                <Badge tone="red">غير مدفوع</Badge>
              )}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-start">
            <Detail label="وقت الدخول">
              {formatDateTime(result.session.entry_time)}
            </Detail>
            <Detail label="وقت الخروج">
              {formatDateTime(result.session.exit_time)}
            </Detail>
          </dl>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" onClick={reset}>
            سيارة أخرى
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/')}>
            الرئيسية
          </Button>
        </div>
      </div>
    )
  }

  /* -------------------------------- الشاشة ------------------------------- */

  const monthly = preview?.session.session_type === 'monthly'

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="خروج سيارة"
        description="ابحث عن السيارة ثم أكّد الخروج والدفع"
      />

      <Card>
        <div className="flex flex-col gap-4">
          <Button
            size="xl"
            block
            variant="secondary"
            onClick={() => setCameraOpen(true)}
            icon={<Camera className="h-6 w-6" aria-hidden />}
            className="h-20 border-2 border-dashed border-brand-300 bg-brand-50 text-brand-800 hover:bg-brand-100"
          >
            تصوير لوحة السيارة
          </Button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            أو أدخل الرقم يدوياً
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Field label="رقم اللوحة" htmlFor="plate" required error={plateError}>
            <PlateInput
              ref={plateRef}
              value={plate}
              onChange={(value) => {
                setPlate(value)
                setPlateError(null)
              }}
              onEnter={() => void handleSearch()}
              invalid={Boolean(plateError)}
              autoFocus={!presetSessionId}
            />
          </Field>

          {ocrNotice && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800">
              {ocrNotice}
            </p>
          )}

          {(findAction.error || loadByIdAction.error) && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              {findAction.error ?? loadByIdAction.error}
            </p>
          )}

          <Button
            size="lg"
            block
            onClick={() => void handleSearch()}
            loading={findAction.pending || loadByIdAction.pending}
            disabled={!online}
            icon={<Search className="h-5 w-5" aria-hidden />}
          >
            بحث عن السيارة
          </Button>
        </div>
      </Card>

      {/* ------------------------- تفاصيل الخروج ------------------------- */}
      {preview && (
        <Card>
          <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <p className="num text-2xl font-bold text-slate-900">
                {displayPlate(preview.vehicle.plate_number)}
              </p>
              {monthly ? (
                <Badge tone="violet">
                  <Ticket className="h-3.5 w-3.5" aria-hidden />
                  اشتراك ساري
                </Badge>
              ) : (
                <Badge tone="blue">زيارة عادية</Badge>
              )}
            </header>

            <dl className="grid grid-cols-2 gap-3">
              <Detail label="وقت الدخول">
                {formatDateTime(preview.session.entry_time)}
              </Detail>
              <Detail label="وقت الخروج">
                {formatDateTime(preview.estimated_exit)}
              </Detail>
              <Detail label="مدة الوقوف">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {formatDuration(preview.duration_minutes)}
                </span>
              </Detail>
              <Detail label="اسم المالك">
                {preview.vehicle.owner_name || '—'}
              </Detail>
            </dl>

            {/* ------------------------- المبلغ ------------------------- */}
            <div
              className={cx(
                'rounded-2xl px-4 py-5 text-center',
                monthly ? 'bg-violet-50' : 'bg-brand-50',
              )}
            >
              <p className="text-sm font-medium text-slate-600">
                المبلغ المستحق
              </p>
              <p className="mt-1 flex items-baseline justify-center gap-2">
                <span className="num text-4xl font-bold text-slate-900">
                  {formatMoney(preview.amount_due)}
                </span>
                <span className="text-lg font-semibold text-slate-500">
                  {CURRENCY}
                </span>
              </p>
              {monthly ? (
                <p className="mt-2 text-sm font-medium text-violet-800">
                  سيارة مشتركة شهرياً — لا تُحتسب رسوم زيارة
                </p>
              ) : (
                preview.pricing_rule && (
                  <p className="mt-2 text-xs text-slate-500">
                    حسب تسعيرة «{preview.pricing_rule.name}»:{' '}
                    <span className="num">
                      {formatMoney(preview.pricing_rule.base_amount)}
                    </span>{' '}
                    {CURRENCY} للفترة{' '}
                    <span className="num">
                      {preview.pricing_rule.base_start_time.slice(0, 5)}–
                      {preview.pricing_rule.base_end_time.slice(0, 5)}
                    </span>
                    ، ثم{' '}
                    <span className="num">
                      {formatMoney(preview.pricing_rule.extra_hour_amount)}
                    </span>{' '}
                    {CURRENCY} لكل ساعة أو جزء منها
                  </p>
                )
              )}
            </div>

            {/* ------------------------ حالة الدفع ------------------------ */}
            {!monthly && (
              <>
                <Field label="حالة الدفع" required>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ['paid', 'مدفوع'],
                        ['unpaid', 'غير مدفوع'],
                        ['waived', 'معفى'],
                      ] as Array<[PayChoice, string]>
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPayChoice(value)}
                        aria-pressed={payChoice === value}
                        className={cx(
                          'h-12 rounded-xl border-2 text-sm font-bold transition',
                          payChoice === value
                            ? value === 'paid'
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : value === 'unpaid'
                                ? 'border-rose-600 bg-rose-600 text-white'
                                : 'border-slate-500 bg-slate-500 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>

                {payChoice === 'paid' && (
                  <Field label="طريقة الدفع" htmlFor="method">
                    <Select
                      id="method"
                      value={payMethod}
                      onChange={(e) =>
                        setPayMethod(e.target.value as PaymentMethod)
                      }
                    >
                      {Object.entries(PAYMENT_METHOD_LABEL).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                )}
              </>
            )}

            <Field label="ملاحظات" htmlFor="exit-notes">
              <Textarea
                id="exit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="اختياري"
                maxLength={300}
                rows={2}
              />
            </Field>

            {exitAction.error && (
              <p
                className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
                role="alert"
              >
                {exitAction.error}
              </p>
            )}

            <Button
              size="xl"
              block
              variant="success"
              onClick={() => void handleExit()}
              loading={exitAction.pending}
              disabled={!online}
              icon={
                monthly ? (
                  <LogOut className="h-6 w-6" aria-hidden />
                ) : (
                  <Banknote className="h-6 w-6" aria-hidden />
                )
              }
            >
              {monthly ? 'تأكيد الخروج' : 'تأكيد الخروج والدفع'}
            </Button>

            <p className="text-center text-xs text-slate-400">
              المبلغ يُحسب في قاعدة البيانات لحظة التأكيد حسب وقت الخروج الفعلي.
            </p>
          </div>
        </Card>
      )}

      <PlateCamera
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={handleDetected}
      />
    </div>
  )
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  )
}
