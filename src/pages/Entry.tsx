import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Camera,
  CarFront,
  CheckCircle2,
  Search,
  Ticket,
  UserPlus,
} from 'lucide-react'
import { PlateCamera } from '@/components/PlateCamera'
import { PlateInput } from '@/components/PlateInput'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeading,
  Textarea,
} from '@/components/ui'
import { useAction } from '@/hooks/useAsync'
import { useOnline } from '@/hooks/useOnline'
import { useToast } from '@/hooks/useToast'
import { lookupPlate, registerEntry } from '@/services/parking'
import { logOcrAttempt } from '@/services/ocr'
import { isValidPlate, displayPlate } from '@/lib/plate'
import { formatDate, formatDateTime } from '@/lib/format'
import type { LookupPlateResult, RegisterEntryResult } from '@/types/database'

type Step = 'plate' | 'confirm' | 'done'

export function EntryPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const plateRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('plate')
  const [plate, setPlate] = useState('')
  const [plateError, setPlateError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [ocrNotice, setOcrNotice] = useState<string | null>(null)
  const [ocrMeta, setOcrMeta] = useState<{
    detected: string
    confidence: number
  } | null>(null)

  const [lookup, setLookup] = useState<LookupPlateResult | null>(null)
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<RegisterEntryResult | null>(null)

  const lookupAction = useAction(lookupPlate)
  const entryAction = useAction(registerEntry)

  /* ------------------------------ الكاميرا ------------------------------ */

  const handleDetected = useCallback(
    (detected: string, meta: { confidence: number; raw: string }) => {
      setCameraOpen(false)
      setOcrMeta({ detected, confidence: meta.confidence })

      if (!detected) {
        setOcrNotice('تعذر قراءة اللوحة، يرجى إدخال الرقم يدوياً')
        window.setTimeout(() => plateRef.current?.focus(), 50)
        return
      }

      setPlate(detected)
      setOcrNotice(
        `تمت قراءة الرقم بنسبة ثقة ${Math.round(meta.confidence * 100)}% — راجعه وصحّحه إن لزم قبل المتابعة`,
      )
      window.setTimeout(() => plateRef.current?.focus(), 50)
    },
    [],
  )

  /* -------------------------------- البحث ------------------------------- */

  const handleLookup = async () => {
    setPlateError(null)

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

      if (data.active_session) {
        toast.error('السيارة موجودة بالفعل داخل الموقف')
        setLookup(data)
        setStep('confirm')
        return
      }

      setLookup(data)
      setOwnerName(data.vehicle?.owner_name ?? '')
      setPhone(data.vehicle?.phone ?? '')
      setStep('confirm')
    } catch {
      // الرسالة معروضة عبر lookupAction.error
    }
  }

  /* ------------------------------ تسجيل الدخول --------------------------- */

  const handleRegister = async () => {
    if (!online) {
      toast.error('لا يوجد اتصال بالإنترنت')
      return
    }

    try {
      const data = await entryAction.run({
        plate,
        ownerName: ownerName || null,
        phone: phone || null,
        notes: notes || null,
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

      setResult(data)
      setStep('done')
      toast.success('تم تسجيل دخول السيارة بنجاح')
    } catch {
      // الرسالة معروضة عبر entryAction.error
    }
  }

  const reset = () => {
    setStep('plate')
    setPlate('')
    setPlateError(null)
    setLookup(null)
    setOwnerName('')
    setPhone('')
    setNotes('')
    setResult(null)
    setOcrNotice(null)
    setOcrMeta(null)
    window.setTimeout(() => plateRef.current?.focus(), 50)
  }

  /* -------------------------------- العرض ------------------------------- */

  if (step === 'done' && result) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading title="تم تسجيل الدخول" />

        <Card className="text-center">
          <CheckCircle2
            className="mx-auto h-14 w-14 text-emerald-500"
            aria-hidden
          />
          <p className="num mt-3 text-3xl font-bold text-slate-900">
            {displayPlate(result.vehicle.plate_number)}
          </p>

          <div className="mt-3 flex justify-center">
            {result.session.session_type === 'monthly' ? (
              <Badge tone="violet">
                <Ticket className="h-3.5 w-3.5" aria-hidden />
                اشتراك ساري
                {result.subscription &&
                  ` حتى ${formatDate(result.subscription.end_date)}`}
              </Badge>
            ) : (
              <Badge tone="blue">زيارة عادية</Badge>
            )}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 text-start">
            <Detail label="وقت الدخول">
              {formatDateTime(result.session.entry_time)}
            </Detail>
            <Detail label="اسم المالك">
              {result.vehicle.owner_name || '—'}
            </Detail>
          </dl>

          {result.is_new_vehicle && (
            <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
              تمت إضافة هذه السيارة إلى السجل لأول مرة.
            </p>
          )}

          {result.session.session_type === 'monthly' && (
            <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-800">
              سيارة مشتركة — لن تُحتسب عليها أي رسوم عند الخروج.
            </p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" onClick={reset} icon={<CarFront className="h-5 w-5" />}>
            سيارة أخرى
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => navigate('/inside')}
          >
            السيارات الموجودة
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="دخول سيارة"
        description="صوّر اللوحة أو أدخل الرقم يدوياً"
      />

      {/* ------------------------- الخطوة 1: اللوحة ------------------------- */}
      <Card>
        <div className="flex flex-col gap-4">
          <Button
            size="xl"
            block
            variant="secondary"
            onClick={() => setCameraOpen(true)}
            disabled={step !== 'plate'}
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
                if (step === 'confirm') setStep('plate')
              }}
              onEnter={() => void handleLookup()}
              invalid={Boolean(plateError)}
              autoFocus
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

          {lookupAction.error && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              {lookupAction.error}
            </p>
          )}

          {step === 'plate' && (
            <Button
              size="lg"
              block
              onClick={() => void handleLookup()}
              loading={lookupAction.pending}
              disabled={!online}
              icon={<Search className="h-5 w-5" aria-hidden />}
            >
              بحث ومتابعة
            </Button>
          )}
        </div>
      </Card>

      {/* ------------------------ الخطوة 2: التأكيد ------------------------ */}
      {step === 'confirm' && lookup && (
        <Card>
          {lookup.active_session ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-xl bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-700">
                هذه السيارة مسجّلة داخل الموقف منذ{' '}
                {formatDateTime(lookup.active_session.entry_time)}. لا يمكن
                تسجيل دخول مرتين لنفس السيارة.
              </p>
              <Link to="/exit">
                <Button block variant="success" size="lg">
                  الانتقال إلى تسجيل الخروج
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-800">
                  {lookup.found ? 'سيارة مسجّلة' : 'سيارة جديدة'}
                </h2>
                {lookup.subscription ? (
                  <Badge tone="violet">
                    <Ticket className="h-3.5 w-3.5" aria-hidden />
                    اشتراك ساري حتى {formatDate(lookup.subscription.end_date)}
                  </Badge>
                ) : (
                  <Badge tone="blue">زيارة عادية</Badge>
                )}
              </header>

              {!lookup.found && (
                <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
                  <UserPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  هذه السيارة غير مسجّلة — سيتم إنشاؤها تلقائياً عند التسجيل.
                </p>
              )}

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

              <Field label="ملاحظات" htmlFor="notes">
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="اختياري"
                  maxLength={300}
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

              <Button
                size="xl"
                block
                onClick={() => void handleRegister()}
                loading={entryAction.pending}
                disabled={!online}
                icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
              >
                تأكيد دخول السيارة
              </Button>
            </div>
          )}
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
