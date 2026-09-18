import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Banknote,
  CalendarX,
  Camera,
  CarFront,
  CheckCircle2,
  Clock,
  Droplets,
  LogIn,
  LogOut,
  Search,
  Ticket,
} from 'lucide-react'
import { PlateCamera } from '@/components/PlateCamera'
import { PlateInput } from '@/components/PlateInput'
import { ServiceDialog } from '@/components/ServiceDialog'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeading,
  Select,
  Textarea,
} from '@/components/ui'
import { cx } from '@/lib/cx'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useOnline } from '@/hooks/useOnline'
import { useToast } from '@/hooks/useToast'
import {
  lookupPlate,
  previewExit,
  registerEntry,
  registerExit,
} from '@/services/parking'
import { listSessionServices } from '@/services/extras'
import { logOcrAttempt } from '@/services/ocr'
import { displayPlate, isValidPlate } from '@/lib/plate'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  SERVICE_TYPE_LABEL,
} from '@/lib/format'
import { getActivePricingRule } from '@/services/settings'
import { CURRENCY } from '@/lib/env'
import type {
  LookupPlateResult,
  PaymentMethod,
  PreviewExitResult,
  RegisterEntryResult,
  RegisterExitResult,
  ServiceRow,
  ServiceType,
} from '@/types/database'

type Mode = 'search' | 'entry' | 'exit'
type PayChoice = 'paid' | 'unpaid' | 'waived'

/**
 * شاشة البوابة — دخول وخروج في مكان واحد.
 *
 * التدفق: أدخل اللوحة مرة واحدة ← يعرض النظام حالة السيارة ← زرّان:
 * «دخول» أخضر و«خروج» أحمر، ويُعطَّل غير المنطقي منهما مع توضيح السبب.
 */
export function GatePage() {
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
  const [ocrMeta, setOcrMeta] = useState<{
    detected: string
    confidence: number
  } | null>(null)

  const [mode, setMode] = useState<Mode>('search')
  const [lookup, setLookup] = useState<LookupPlateResult | null>(null)

  // بيانات الدخول
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [entryNotes, setEntryNotes] = useState('')

  // الدفع عند الدخول
  const [payNow, setPayNow] = useState(false)
  const [entryAmount, setEntryAmount] = useState('')
  const [entryMethod, setEntryMethod] = useState<PaymentMethod>('cash')
  const [addWash, setAddWash] = useState(false)
  const [washType, setWashType] = useState<ServiceType>('wash')
  const [washAmount, setWashAmount] = useState('')

  // بيانات الخروج
  const [preview, setPreview] = useState<PreviewExitResult | null>(null)
  const [services, setServices] = useState<ServiceRow[]>([])
  const [payChoice, setPayChoice] = useState<PayChoice>('paid')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [collected, setCollected] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [exitNotes, setExitNotes] = useState('')
  const [serviceOpen, setServiceOpen] = useState(false)

  // النتيجة
  const [entryResult, setEntryResult] = useState<RegisterEntryResult | null>(null)
  const [exitResult, setExitResult] = useState<RegisterExitResult | null>(null)

  // التسعيرة تُحمَّل مرة لاقتراح المبلغ الأساسي عند الدفع المسبق
  const pricing = useAsync(getActivePricingRule, [])
  const baseAmount = pricing.data ? Number(pricing.data.base_amount) : 1

  const lookupAction = useAction(lookupPlate)
  const entryAction = useAction(registerEntry)
  const exitAction = useAction(registerExit)
  const previewAction = useAction(previewExit)

  /* ------------ فتح شاشة الخروج مباشرة من «السيارات الموجودة» ------------ */
  const loadedPreset = useRef(false)
  const runPreview = previewAction.run

  useEffect(() => {
    if (!presetSessionId || loadedPreset.current) return
    loadedPreset.current = true

    void runPreview(presetSessionId)
      .then(async (data) => {
        if (!data) return
        setPreview(data)
        setPlate(data.vehicle.plate_number)
        setCollected(formatMoney(data.remaining_amount))
        setMode('exit')
        setServices(await listSessionServices(data.session.id).catch(() => []))
      })
      .catch(() => undefined)
  }, [presetSessionId, runPreview])

  /* ------------------------------ الكاميرا ------------------------------ */
  const handleDetected = useCallback(
    (detected: string, meta: { confidence: number }) => {
      setCameraOpen(false)
      setOcrMeta({ detected, confidence: meta.confidence })

      if (!detected) {
        setOcrNotice('تعذر قراءة اللوحة، يرجى إدخال الرقم يدوياً')
        window.setTimeout(() => plateRef.current?.focus(), 50)
        return
      }

      setPlate(detected)
      setOcrNotice(
        `تمت القراءة بثقة ${Math.round(meta.confidence * 100)}% — راجع الرقم وصحّحه إن لزم`,
      )
      window.setTimeout(() => plateRef.current?.focus(), 50)
    },
    [],
  )

  /* -------------------------------- البحث ------------------------------- */
  const handleSearch = async () => {
    setPlateError(null)
    setMode('search')
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
      const data = await lookupAction.run(plate)
      if (!data) return
      setLookup(data)
      setOwnerName(data.vehicle?.owner_name ?? '')
      setPhone(data.vehicle?.phone ?? '')
    } catch {
      // الرسالة معروضة عبر lookupAction.error
    }
  }

  /* ------------------------------ اختيار دخول ---------------------------- */
  const chooseEntry = () => {
    setMode('entry')
    setExitResult(null)
    // المشترك شهرياً لا تُحتسب عليه رسوم وقوف
    const monthlySub = Boolean(lookup?.subscription)
    setPayNow(false)
    setEntryAmount(monthlySub ? '' : formatMoney(baseAmount))
    setAddWash(false)
    setWashAmount('')
  }

  /* ------------------------------ اختيار خروج ---------------------------- */
  const chooseExit = async () => {
    if (!lookup?.active_session) return
    try {
      const data = await previewAction.run(lookup.active_session.id)
      if (!data) return
      setPreview(data)
      setCollected(formatMoney(data.remaining_amount))
      setPayChoice('paid')
      setPayMethod('cash')
      setDiscountReason('')
      setMode('exit')
      setServices(await listSessionServices(data.session.id).catch(() => []))
    } catch {
      // الرسالة معروضة عبر previewAction.error
    }
  }

  /* ------------------------------ تنفيذ الدخول --------------------------- */
  const doEntry = async () => {
    if (!online) return toast.error('لا يوجد اتصال بالإنترنت')

    const prepaid = Number(entryAmount)
    const wash = Number(washAmount)

    if (payNow) {
      if (entryAmount.trim() === '' || Number.isNaN(prepaid) || prepaid <= 0) {
        toast.error('أدخل المبلغ المدفوع عند الدخول')
        return
      }
    }

    if (addWash) {
      if (washAmount.trim() === '' || Number.isNaN(wash) || wash <= 0) {
        toast.error('أدخل قيمة الغسيل')
        return
      }
    }

    try {
      const data = await entryAction.run({
        plate,
        ownerName: ownerName || null,
        phone: phone || null,
        notes: entryNotes || null,
        prepaidAmount: payNow ? prepaid : null,
        prepaidMethod: entryMethod,
        serviceType: addWash ? washType : null,
        serviceAmount: addWash ? wash : null,
      })
      if (!data) return

      if (ocrMeta) {
        void logOcrAttempt({
          detected: ocrMeta.detected,
          corrected: plate,
          confidence: ocrMeta.confidence,
          engine: 'tesseract.js',
          sessionId: data.session.id,
        })
      }

      setEntryResult(data)
      toast.success('تم تسجيل دخول السيارة')
    } catch {
      // الرسالة معروضة عبر entryAction.error
    }
  }

  /* ------------------------------ تنفيذ الخروج --------------------------- */
  const doExit = async () => {
    if (!preview) return
    if (!online) return toast.error('لا يوجد اتصال بالإنترنت')

    const monthly = preview.session.session_type === 'monthly'
    const collectedNum = Number(collected)

    if (!monthly && payChoice === 'paid') {
      if (collected.trim() === '' || Number.isNaN(collectedNum)) {
        toast.error('أدخل المبلغ المحصّل')
        return
      }
      if (collectedNum < 0) {
        toast.error('المبلغ المحصّل لا يمكن أن يكون سالباً')
        return
      }
      if (collectedNum > preview.remaining_amount) {
        toast.error('المبلغ المحصّل لا يمكن أن يتجاوز المتبقّي')
        return
      }
    }

    try {
      const data = await exitAction.run({
        sessionId: preview.session.id,
        paymentStatus: monthly ? 'paid' : payChoice,
        paymentMethod: payMethod,
        notes: exitNotes || null,
        collectedAmount: monthly ? null : collectedNum,
        discountReason: discountReason || null,
      })
      if (!data) return

      setExitResult(data)
      toast.success('تم تسجيل خروج السيارة')
    } catch {
      // الرسالة معروضة عبر exitAction.error
    }
  }

  const reset = () => {
    setPlate('')
    setPlateError(null)
    setLookup(null)
    setPreview(null)
    setServices([])
    setMode('search')
    setOwnerName('')
    setPhone('')
    setEntryNotes('')
    setPayNow(false)
    setEntryAmount('')
    setAddWash(false)
    setWashAmount('')
    setExitNotes('')
    setCollected('')
    setDiscountReason('')
    setPayChoice('paid')
    setPayMethod('cash')
    setEntryResult(null)
    setExitResult(null)
    setOcrNotice(null)
    setOcrMeta(null)
    loadedPreset.current = true
    window.setTimeout(() => plateRef.current?.focus(), 50)
  }

  /* ============================ شاشات النجاح ============================ */

  if (entryResult) {
    return (
      <SuccessScreen
        tone="green"
        title="تم تسجيل الدخول"
        plate={entryResult.vehicle.plate_number}
        onAgain={reset}
        onHome={() => navigate('/inside')}
        homeLabel="السيارات الموجودة"
      >
        <div className="mt-3 flex justify-center">
          {entryResult.session.session_type === 'monthly' ? (
            <Badge tone="violet">
              <Ticket className="h-3.5 w-3.5" aria-hidden />
              اشتراك ساري
              {entryResult.subscription &&
                ` حتى ${formatDate(entryResult.subscription.end_date)}`}
            </Badge>
          ) : (
            <Badge tone="blue">زيارة عادية</Badge>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-start">
          <Detail label="وقت الدخول">
            {formatDateTime(entryResult.session.entry_time)}
          </Detail>
          <Detail label="اسم المالك">
            {entryResult.vehicle.owner_name || '—'}
          </Detail>
        </dl>

        {(entryResult.prepaid_amount > 0 || entryResult.service) && (
          <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-4">
            <p className="text-sm font-semibold text-emerald-900">
              المقبوض عند الدخول
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-emerald-900">
              {entryResult.prepaid_amount > 0 && (
                <li className="flex items-center justify-between">
                  <span>رسوم الوقوف</span>
                  <span className="num font-bold">
                    {formatMoney(entryResult.prepaid_amount)} {CURRENCY}
                  </span>
                </li>
              )}
              {entryResult.service && (
                <li className="flex items-center justify-between">
                  <span>{SERVICE_TYPE_LABEL[entryResult.service.service_type]}</span>
                  <span className="num font-bold">
                    {formatMoney(entryResult.service.amount)} {CURRENCY}
                  </span>
                </li>
              )}
              <li className="mt-1 flex items-center justify-between border-t border-emerald-200 pt-1.5 font-bold">
                <span>الإجمالي</span>
                <span className="num text-base">
                  {formatMoney(
                    entryResult.prepaid_amount +
                      (entryResult.service ? Number(entryResult.service.amount) : 0),
                  )}{' '}
                  {CURRENCY}
                </span>
              </li>
            </ul>
          </div>
        )}

        {entryResult.is_new_vehicle && (
          <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
            تمت إضافة هذه السيارة إلى السجل لأول مرة.
          </p>
        )}
      </SuccessScreen>
    )
  }

  if (exitResult) {
    const monthly = exitResult.session.session_type === 'monthly'
    const discount = exitResult.adjustment < 0 ? -exitResult.adjustment : 0

    return (
      <SuccessScreen
        tone="red"
        title="تم تسجيل الخروج"
        plate={exitResult.vehicle.plate_number}
        onAgain={reset}
        onHome={() => navigate('/')}
        homeLabel="الرئيسية"
      >
        <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-5">
          <p className="text-sm font-medium text-slate-500">
            {discount > 0 ? 'المبلغ المحصّل' : 'المبلغ المستحق'}
          </p>
          <p className="mt-1 flex items-baseline justify-center gap-2">
            <span className="num text-4xl font-bold text-slate-900">
              {formatMoney(exitResult.amount_collected ?? exitResult.amount_due)}
            </span>
            <span className="text-lg font-semibold text-slate-500">
              {CURRENCY}
            </span>
          </p>

          {exitResult.prepaid_amount > 0 && (
            <div className="mt-3 inline-flex flex-col gap-1 rounded-xl bg-white px-3 py-2 text-xs text-slate-700">
              <span className="flex items-center justify-between gap-4">
                <span>الرسوم الكاملة</span>
                <span className="num font-semibold">
                  {formatMoney(exitResult.amount_due)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-4 text-emerald-700">
                <span>دُفع عند الدخول</span>
                <span className="num font-semibold">
                  {formatMoney(exitResult.prepaid_amount)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-4">
                <span>حُصِّل عند الخروج</span>
                <span className="num font-semibold">
                  {formatMoney(exitResult.collected_now)}
                </span>
              </span>
            </div>
          )}

          {discount > 0 && (
            <p className="mt-2 text-sm text-amber-700">
              خصم{' '}
              <span className="num font-semibold">{formatMoney(discount)}</span>{' '}
              {CURRENCY} من الرسوم
            </p>
          )}

          <div className="mt-3 flex justify-center">
            {monthly ? (
              <Badge tone="violet">اشتراك شهري — بلا رسوم</Badge>
            ) : exitResult.payment_status === 'paid' ? (
              <Badge tone="green">مدفوع</Badge>
            ) : exitResult.payment_status === 'waived' ? (
              <Badge tone="slate">معفى</Badge>
            ) : (
              <Badge tone="red">غير مدفوع</Badge>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-start">
          <Detail label="وقت الدخول">
            {formatDateTime(exitResult.session.entry_time)}
          </Detail>
          <Detail label="وقت الخروج">
            {formatDateTime(exitResult.session.exit_time)}
          </Detail>
        </dl>
      </SuccessScreen>
    )
  }

  /* ============================ الشاشة الرئيسية ============================ */

  const activeSession = lookup?.active_session ?? null
  const isInside = Boolean(activeSession)
  const monthly = preview?.session.session_type === 'monthly'
  // الأساس هو المتبقّي بعد خصم ما دُفع عند الدخول
  const dueAmount = preview?.remaining_amount ?? 0
  const collectedNum = Number(collected)
  const discountNow =
    !Number.isNaN(collectedNum) && collectedNum < dueAmount
      ? dueAmount - collectedNum
      : 0
  const servicesTotal = services.reduce((sum, s) => sum + Number(s.amount), 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="بوابة الموقف"
        description="أدخل رقم اللوحة ثم اختر دخول أو خروج"
      />

      {/* ---------------------------- رقم اللوحة ---------------------------- */}
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
                if (mode !== 'search' || lookup) {
                  setLookup(null)
                  setPreview(null)
                  setMode('search')
                }
              }}
              onEnter={() => void handleSearch()}
              invalid={Boolean(plateError)}
              autoFocus={!presetSessionId}
            />
          </Field>

          {ocrNotice && (
            <p
              className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800"
              role="status"
            >
              {ocrNotice}
            </p>
          )}

          {(lookupAction.error || previewAction.error) && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              {lookupAction.error ?? previewAction.error}
            </p>
          )}

          {!lookup && (
            <Button
              size="lg"
              block
              onClick={() => void handleSearch()}
              loading={lookupAction.pending}
              disabled={!online}
              icon={<Search className="h-5 w-5" aria-hidden />}
            >
              بحث
            </Button>
          )}
        </div>
      </Card>

      {/* ------------------------ حالة السيارة + الزرّان ------------------------ */}
      {lookup && mode === 'search' && (
        <Card>
          <div className="flex flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <p className="num text-2xl font-bold text-slate-900">
                {displayPlate(plate)}
              </p>
              <div className="flex flex-wrap gap-2">
                {lookup.subscription ? (
                  <Badge tone="violet">
                    <Ticket className="h-3.5 w-3.5" aria-hidden />
                    اشتراك ساري حتى {formatDate(lookup.subscription.end_date)}
                  </Badge>
                ) : (
                  <Badge tone="blue">زيارة عادية</Badge>
                )}
                {!lookup.found && <Badge tone="amber">سيارة جديدة</Badge>}
              </div>
            </header>

            {isInside && activeSession && (
              <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <CarFront
                  className="ms-0 me-1.5 inline h-4 w-4 text-slate-400"
                  aria-hidden
                />
                داخل الموقف منذ{' '}
                <span className="num font-semibold">
                  {formatDateTime(activeSession.entry_time)}
                </span>
              </p>
            )}

            {lookup.is_closed_day && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
                <CalendarX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                اليوم من أيام الإغلاق حسب الإعدادات.
              </p>
            )}

            {/* ----------------------- الزرّان ----------------------- */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={chooseEntry}
                disabled={isInside || !online}
                className={cx(
                  'flex h-28 flex-col items-center justify-center gap-2 rounded-2xl text-lg font-bold transition',
                  'disabled:cursor-not-allowed',
                  isInside
                    ? 'bg-slate-100 text-slate-400'
                    : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800',
                )}
              >
                <LogIn className="h-8 w-8" aria-hidden />
                دخول
              </button>

              <button
                type="button"
                onClick={() => void chooseExit()}
                disabled={!isInside || !online || previewAction.pending}
                className={cx(
                  'flex h-28 flex-col items-center justify-center gap-2 rounded-2xl text-lg font-bold transition',
                  'disabled:cursor-not-allowed',
                  !isInside
                    ? 'bg-slate-100 text-slate-400'
                    : 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800',
                )}
              >
                <LogOut className="h-8 w-8" aria-hidden />
                خروج
              </button>
            </div>

            <p className="text-center text-xs text-slate-500">
              {isInside
                ? 'السيارة داخل الموقف — الدخول غير متاح حتى تسجيل الخروج'
                : 'السيارة ليست داخل الموقف — الخروج غير متاح'}
            </p>
          </div>
        </Card>
      )}

      {/* ------------------------- نموذج الدخول ------------------------- */}
      {mode === 'entry' && (
        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-bold text-emerald-700">
              تسجيل دخول السيارة
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم المالك" htmlFor="owner">
                <Input
                  id="owner"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="اختياري"
                  maxLength={80}
                />
              </Field>
              <Field label="رقم الهاتف" htmlFor="phone">
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="اختياري"
                  maxLength={20}
                />
              </Field>
            </div>

            {/* ------------------- الدفع عند الدخول ------------------- */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Banknote className="h-4 w-4 text-emerald-600" aria-hidden />
                تحصيل عند الدخول
                <span className="font-normal text-slate-400">— اختياري</span>
              </p>

              {lookup?.subscription ? (
                <p className="rounded-lg bg-violet-50 px-3 py-2.5 text-xs leading-6 text-violet-900">
                  سيارة مشتركة شهرياً — لا تُحتسب عليها رسوم وقوف. يمكنك مع ذلك
                  إضافة غسيل بالأسفل.
                </p>
              ) : (
                <>
                  <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={payNow}
                      onChange={(e) => setPayNow(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    <span className="text-sm text-slate-700">
                      دفع رسوم الوقوف الآن
                      <span className="mt-0.5 block text-xs text-slate-500">
                        يُخصم من المستحق عند الخروج، والباقي فقط هو ما يُطلب
                      </span>
                    </span>
                  </label>

                  {payNow && (
                    <div className="mt-3 flex flex-col gap-3">
                      <Field label={`المبلغ (${CURRENCY})`} htmlFor="entry-amount">
                        <div className="flex flex-col gap-2">
                          <Input
                            id="entry-amount"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.25"
                            value={entryAmount}
                            onChange={(e) => setEntryAmount(e.target.value)}
                            className="num h-14 text-center text-2xl font-bold"
                          />
                          <div className="flex flex-wrap gap-2">
                            {[baseAmount, baseAmount * 2, baseAmount * 3].map(
                              (value) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() =>
                                    setEntryAmount(formatMoney(value))
                                  }
                                  className={cx(
                                    'num rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                                    Number(entryAmount) === value
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                  )}
                                >
                                  {formatMoney(value)}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      </Field>

                      <Field label="طريقة الدفع" htmlFor="entry-method">
                        <Select
                          id="entry-method"
                          value={entryMethod}
                          onChange={(e) =>
                            setEntryMethod(e.target.value as PaymentMethod)
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
                    </div>
                  )}
                </>
              )}

              {/* ------------------------ الغسيل ------------------------ */}
              <label className="mt-3 flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={addWash}
                  onChange={(e) => setAddWash(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span className="text-sm text-slate-700">
                  إضافة غسيل أو تمسيح
                  <span className="mt-0.5 block text-xs text-slate-500">
                    يُحصَّل الآن ومنفصل عن رسوم الوقوف
                  </span>
                </span>
              </label>

              {addWash && (
                <div className="mt-3 flex flex-col gap-3">
                  <Field label="نوع الخدمة">
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map(
                        (type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setWashType(type)}
                            aria-pressed={washType === type}
                            className={cx(
                              'h-11 rounded-xl border-2 text-sm font-bold transition',
                              washType === type
                                ? 'border-sky-600 bg-sky-600 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                            )}
                          >
                            {SERVICE_TYPE_LABEL[type]}
                          </button>
                        ),
                      )}
                    </div>
                  </Field>

                  <Field label={`قيمة الخدمة (${CURRENCY})`} htmlFor="wash-amount">
                    <div className="flex flex-col gap-2">
                      <Input
                        id="wash-amount"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.25"
                        value={washAmount}
                        onChange={(e) => setWashAmount(e.target.value)}
                        className="num h-14 text-center text-2xl font-bold"
                      />
                      <div className="flex flex-wrap gap-2">
                        {[0.5, 1, 1.5, 2, 3, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setWashAmount(formatMoney(value))}
                            className={cx(
                              'num rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                              Number(washAmount) === value
                                ? 'border-sky-600 bg-sky-600 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                            )}
                          >
                            {formatMoney(value)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Field>
                </div>
              )}

              {/* ---------------------- إجمالي المقبوض ---------------------- */}
              {(payNow || addWash) && (
                <p className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-900">
                  <span>إجمالي المقبوض الآن</span>
                  <span className="num">
                    {formatMoney(
                      (payNow ? Number(entryAmount) || 0 : 0) +
                        (addWash ? Number(washAmount) || 0 : 0),
                    )}{' '}
                    {CURRENCY}
                  </span>
                </p>
              )}
            </div>

            <Field label="ملاحظات" htmlFor="entry-notes">
              <Textarea
                id="entry-notes"
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                placeholder="اختياري"
                maxLength={300}
                rows={2}
              />
            </Field>

            {entryAction.error && (
              <p
                className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
                role="alert"
              >
                {entryAction.error}
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="ghost"
                onClick={() => setMode('search')}
                className="col-span-1"
              >
                رجوع
              </Button>
              <Button
                size="xl"
                variant="success"
                onClick={() => void doEntry()}
                loading={entryAction.pending}
                disabled={!online}
                icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
                className="col-span-2"
              >
                تأكيد الدخول
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------- نموذج الخروج ------------------------- */}
      {mode === 'exit' && preview && (
        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-bold text-rose-700">
              تسجيل خروج السيارة
            </h2>

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

            {/* -------------------- المبلغ المستحق -------------------- */}
            <div
              className={cx(
                'rounded-2xl px-4 py-5 text-center',
                monthly ? 'bg-violet-50' : 'bg-brand-50',
              )}
            >
              <p className="text-sm font-medium text-slate-600">
                {preview.prepaid_amount > 0
                  ? 'المتبقّي للتحصيل'
                  : 'رسوم الوقوف المستحقة'}
              </p>
              <p className="mt-1 flex items-baseline justify-center gap-2">
                <span className="num text-4xl font-bold text-slate-900">
                  {formatMoney(
                    preview.prepaid_amount > 0
                      ? preview.remaining_amount
                      : preview.amount_due,
                  )}
                </span>
                <span className="text-lg font-semibold text-slate-500">
                  {CURRENCY}
                </span>
              </p>

              {preview.prepaid_amount > 0 && (
                <div className="mt-3 inline-flex flex-col gap-1 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-700">
                  <span className="flex items-center justify-between gap-4">
                    <span>الرسوم الكاملة</span>
                    <span className="num font-semibold">
                      {formatMoney(preview.amount_due)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-4 text-emerald-700">
                    <span>مدفوع عند الدخول</span>
                    <span className="num font-semibold">
                      − {formatMoney(preview.prepaid_amount)}
                    </span>
                  </span>
                </div>
              )}

              {monthly && (
                <p className="mt-2 text-sm font-medium text-violet-800">
                  سيارة مشتركة شهرياً — لا تُحتسب رسوم زيارة
                </p>
              )}

              {!monthly &&
                preview.prepaid_amount > 0 &&
                preview.remaining_amount === 0 && (
                  <p className="mt-2 text-sm font-semibold text-emerald-700">
                    الرسوم مدفوعة بالكامل — لا يوجد مبلغ مستحق
                  </p>
                )}
            </div>

            {/* ---------------------- الخدمات ---------------------- */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Droplets className="h-4 w-4 text-sky-500" aria-hidden />
                  خدمات إضافية
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setServiceOpen(true)}
                >
                  إضافة غسيل
                </Button>
              </div>

              {services.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  لا توجد خدمات — تُحصَّل منفصلة عن رسوم الوقوف
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {services.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-slate-700">
                        {SERVICE_TYPE_LABEL[s.service_type]}
                        {s.notes && (
                          <span className="text-slate-400"> · {s.notes}</span>
                        )}
                      </span>
                      <span className="num font-semibold text-slate-800">
                        {formatMoney(s.amount)} {CURRENCY}
                      </span>
                    </li>
                  ))}
                  <li className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-sm font-bold">
                    <span className="text-slate-700">مجموع الخدمات</span>
                    <span className="num text-sky-700">
                      {formatMoney(servicesTotal)} {CURRENCY}
                    </span>
                  </li>
                </ul>
              )}
            </div>

            {/* -------------------- حالة الدفع -------------------- */}
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
                  <>
                    <Field
                      label={`المبلغ المحصّل الآن (${CURRENCY})`}
                      htmlFor="collected"
                      required
                      hint="يمكن تخفيضه عند عدم توفّر صرافة — لا يمكن تجاوز المتبقّي"
                    >
                      <div className="flex flex-col gap-2">
                        <Input
                          id="collected"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={preview.remaining_amount}
                          step="0.25"
                          value={collected}
                          onChange={(e) => setCollected(e.target.value)}
                          className="num h-14 text-center text-2xl font-bold"
                        />

                        {/* اختصارات سريعة */}
                        <div className="flex flex-wrap gap-2">
                          {quickAmounts(preview.remaining_amount).map((amount) => (
                            <button
                              key={amount}
                              type="button"
                              onClick={() => setCollected(formatMoney(amount))}
                              className={cx(
                                'num rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                                Number(collected) === amount
                                  ? 'border-brand-600 bg-brand-600 text-white'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                              )}
                            >
                              {formatMoney(amount)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Field>

                    {discountNow > 0 && (
                      <>
                        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
                          خصم{' '}
                          <span className="num font-bold">
                            {formatMoney(discountNow)}
                          </span>{' '}
                          {CURRENCY} من أصل{' '}
                          <span className="num">
                            {formatMoney(preview.remaining_amount)}
                          </span>{' '}
                          — سيُسجَّل في التقارير
                        </p>

                        <Field label="سبب الخصم" htmlFor="discount-reason">
                          <Input
                            id="discount-reason"
                            value={discountReason}
                            onChange={(e) => setDiscountReason(e.target.value)}
                            placeholder="مثال: لا يوجد صرف"
                            maxLength={120}
                          />
                        </Field>
                      </>
                    )}

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
                  </>
                )}
              </>
            )}

            <Field label="ملاحظات" htmlFor="exit-notes">
              <Textarea
                id="exit-notes"
                value={exitNotes}
                onChange={(e) => setExitNotes(e.target.value)}
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

            <div className="grid grid-cols-3 gap-2">
              <Button variant="ghost" onClick={reset} className="col-span-1">
                إلغاء
              </Button>
              <Button
                size="xl"
                variant="danger"
                onClick={() => void doExit()}
                loading={exitAction.pending}
                disabled={!online}
                icon={
                  monthly ? (
                    <LogOut className="h-6 w-6" aria-hidden />
                  ) : (
                    <Banknote className="h-6 w-6" aria-hidden />
                  )
                }
                className="col-span-2"
              >
                {monthly ? 'تأكيد الخروج' : 'تأكيد الخروج والدفع'}
              </Button>
            </div>

            <p className="text-center text-xs text-slate-400">
              رسوم الوقوف تُحسب في قاعدة البيانات لحظة التأكيد.
            </p>
          </div>
        </Card>
      )}

      <PlateCamera
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={handleDetected}
      />

      <ServiceDialog
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        sessionId={preview?.session.id ?? null}
        vehicleId={preview?.vehicle.id ?? null}
        plate={preview?.vehicle.plate_number ?? plate}
        onSaved={async () => {
          setServiceOpen(false)
          if (preview) {
            setServices(
              await listSessionServices(preview.session.id).catch(() => []),
            )
          }
          toast.success('تمت إضافة الخدمة')
        }}
      />
    </div>
  )
}

/* ----------------------------- مكوّنات مساعدة ----------------------------- */

/** مبالغ سريعة للخصم: المستحق، وأقرب نصف دينار، ودينار أقل */
function quickAmounts(due: number): number[] {
  const values = new Set<number>()
  values.add(due)
  if (due >= 0.5) values.add(Math.floor(due * 2) / 2)
  if (due >= 1) values.add(Math.floor(due))
  if (due > 1) values.add(due - 1)
  if (due > 0.5) values.add(due - 0.5)
  return [...values]
    .filter((v) => v >= 0 && v <= due)
    .sort((a, b) => b - a)
    .slice(0, 4)
}

function SuccessScreen({
  tone,
  title,
  plate,
  children,
  onAgain,
  onHome,
  homeLabel,
}: {
  tone: 'green' | 'red'
  title: string
  plate: string
  children: React.ReactNode
  onAgain: () => void
  onHome: () => void
  homeLabel: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading title={title} />

      <Card className="text-center">
        <CheckCircle2
          className={cx(
            'mx-auto h-14 w-14',
            tone === 'green' ? 'text-emerald-500' : 'text-rose-500',
          )}
          aria-hidden
        />
        <p className="num mt-3 text-3xl font-bold text-slate-900">
          {displayPlate(plate)}
        </p>
        {children}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" onClick={onAgain} icon={<CarFront className="h-5 w-5" />}>
          سيارة أخرى
        </Button>
        <Button size="lg" variant="secondary" onClick={onHome}>
          {homeLabel}
        </Button>
      </div>
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
