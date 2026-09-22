import { useEffect, useState, type ReactNode } from 'react'
import { Banknote, History, PencilLine, Ticket } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import {
  collectSessionPayment,
  convertSessionToSubscription,
  correctSessionPayment,
  listSessionAdjustments,
  lookupPlate,
} from '@/services/parking'
import { getActivePricingRule } from '@/services/settings'
import { toArabicError } from '@/lib/errors'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  PAYMENT_METHOD_LABEL,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import { cx } from '@/lib/cx'
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { SubscriptionForm } from '@/pages/Subscriptions'
import type {
  LookupPlateResult,
  PaymentMethod,
  PrepaidAction,
  SessionAdjustment,
  SessionAdjustmentAction,
  SessionType,
} from '@/types/database'

export type SessionPaymentMode = 'collect' | 'correct' | 'convert'

export interface SessionPaymentTarget {
  sessionId: string
  plate: string
  sessionType: SessionType
  entryTime: string
  prepaidAmount: number
  prepaidMethod: PaymentMethod | null
}

const MODES: Array<{ value: SessionPaymentMode; label: string; icon: ReactNode }> = [
  { value: 'collect', label: 'تحصيل', icon: <Banknote className="h-5 w-5" aria-hidden /> },
  { value: 'correct', label: 'تصحيح المدفوع', icon: <PencilLine className="h-5 w-5" aria-hidden /> },
  { value: 'convert', label: 'تحويل لاشتراك', icon: <Ticket className="h-5 w-5" aria-hidden /> },
]

const ACTION_LABEL: Record<SessionAdjustmentAction, string> = {
  collect: 'تحصيل أثناء الوقوف',
  correct_payment: 'تصحيح المدفوع',
  convert_to_subscription: 'تحويل إلى اشتراك',
  auto_fix: 'تصحيح تلقائي',
}

const REASON_CHIPS = ['سُجّل مدفوعاً بالخطأ', 'دفع مبلغاً أقل', 'دفع مبلغاً أكثر']

/**
 * تعديل دفع سيارة ما زالت داخل الموقف: تحصيل، تصحيح مبلغ سُجّل بالخطأ،
 * أو تحويل الدخول إلى اشتراك.
 *
 * لا يُحذف شيء: قاعدة البيانات تسجّل كل تعديل كقيد جديد بالفرق، وتحفظ
 * القيم قبل وبعد والسبب في سجل التعديلات الظاهر أسفل النافذة.
 */
export function SessionPaymentDialog({
  target,
  initialMode = 'collect',
  onClose,
  onChanged,
}: {
  target: SessionPaymentTarget | null
  initialMode?: SessionPaymentMode
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const pricing = useAsync(getActivePricingRule, [])
  const base = pricing.data ? Number(pricing.data.base_amount) : 1

  const [mode, setMode] = useState<SessionPaymentMode>(initialMode)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reason, setReason] = useState('')
  const [prepaidAction, setPrepaidAction] = useState<PrepaidAction>('void')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [lookup, setLookup] = useState<LookupPlateResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [history, setHistory] = useState<SessionAdjustment[]>([])
  const [subFormOpen, setSubFormOpen] = useState(false)

  const monthly = target?.sessionType === 'monthly'
  const prepaid = Number(target?.prepaidAmount ?? 0)

  // تهيئة عند كل فتح
  useEffect(() => {
    if (!target) return
    setMode(initialMode)
    setAmount('')
    setMethod(target.prepaidMethod ?? 'cash')
    setReason('')
    setPrepaidAction('void')
    setError(null)
    setSubFormOpen(false)

    listSessionAdjustments(target.sessionId)
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [target, initialMode])

  // الاشتراك الساري للسيارة — يُحدَّث بعد إنشاء اشتراك من النافذة
  const refreshLookup = async (plate: string) => {
    setLookupLoading(true)
    try {
      setLookup(await lookupPlate(plate))
    } catch {
      setLookup(null)
    } finally {
      setLookupLoading(false)
    }
  }

  useEffect(() => {
    if (!target) return
    void refreshLookup(target.plate)
  }, [target])

  const subscription = lookup?.subscription ?? null
  const subAmount = subscription?.monthly_amount ?? null
  const subBalance = Number(lookup?.subscription_balance ?? 0)
  const canMoveToSub =
    prepaid > 0 && subAmount !== null && prepaid <= subBalance + 0.001

  // إن لم يمكن النقل للاشتراك نرجع للخيار الآخر
  useEffect(() => {
    if (!canMoveToSub && prepaidAction === 'to_subscription') setPrepaidAction('void')
  }, [canMoveToSub, prepaidAction])

  const done = (message: string) => {
    toast.success(message)
    onChanged()
  }

  const handleSubmit = async () => {
    if (!target) return
    setError(null)
    setSaving(true)

    try {
      if (mode === 'collect') {
        const value = Number(amount)
        if (amount.trim() === '' || Number.isNaN(value) || value <= 0) {
          throw new Error('أدخل المبلغ المحصّل')
        }
        const result = await collectSessionPayment(target.sessionId, value, method)
        done(
          `تم تحصيل ${formatMoney(value)} ${CURRENCY} — المدفوع الآن ${formatMoney(result.prepaid_amount)}`,
        )
      } else if (mode === 'correct') {
        const value = Number(amount)
        if (amount.trim() === '' || Number.isNaN(value) || value < 0) {
          throw new Error('أدخل المبلغ الذي دُفع فعلاً (صفر إذا لم يدفع)')
        }
        if (Math.abs(value - prepaid) < 0.001) {
          throw new Error('المبلغ الجديد يساوي المسجّل — لا يوجد ما يُصحَّح')
        }
        if (!reason.trim()) throw new Error('اكتب سبب التصحيح')
        await correctSessionPayment(target.sessionId, value, reason, method)
        done(
          value === 0
            ? 'تم التصحيح: السيارة غير مدفوعة'
            : `تم التصحيح: المدفوع ${formatMoney(value)} ${CURRENCY}`,
        )
      } else {
        if (!subscription) throw new Error('لا يوجد اشتراك ساري لهذه السيارة — أنشئ الاشتراك أولاً')
        await convertSessionToSubscription(target.sessionId, prepaidAction, reason)
        done('تم تحويل الدخول إلى اشتراك — لا رسوم وقوف عند الخروج')
      }
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  const correctedValue = Number(amount)
  const correctionDiff =
    mode === 'correct' && amount.trim() !== '' && !Number.isNaN(correctedValue)
      ? correctedValue - prepaid
      : null

  const submitLabel =
    mode === 'collect' ? 'تحصيل' : mode === 'correct' ? 'حفظ التصحيح' : 'تحويل إلى اشتراك'

  return (
    <>
      <Modal
        open={target !== null && !subFormOpen}
        onClose={onClose}
        title="الدفع — سيارة داخل الموقف"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
            {!monthly && (
              <Button
                onClick={() => void handleSubmit()}
                loading={saving}
                disabled={mode === 'convert' && !subscription}
              >
                {submitLabel}
              </Button>
            )}
          </>
        }
      >
        {target && (
          <div className="flex flex-col gap-4">
            {/* ------------------------------ الحالة الحالية ------------------------------ */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-sand-50 px-3.5 py-3 ring-1 ring-sand-200">
              <div className="min-w-0">
                <p className="num text-lg font-bold text-slate-900">
                  {displayPlate(target.plate)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  دخول {formatTime(target.entryTime)}
                </p>
              </div>
              {monthly ? (
                <Badge tone="violet">دخول اشتراك</Badge>
              ) : prepaid > 0 ? (
                <div className="text-end">
                  <p className="text-[11px] text-slate-500">المسجّل كمدفوع</p>
                  <p className="text-base font-bold text-emerald-700">
                    <span className="num">{formatMoney(prepaid)}</span> {CURRENCY}
                  </p>
                  {target.prepaidMethod && (
                    <p className="text-[11px] text-slate-500">
                      {PAYMENT_METHOD_LABEL[target.prepaidMethod]}
                    </p>
                  )}
                </div>
              ) : (
                <Badge tone="amber">غير مدفوع بعد</Badge>
              )}
            </div>

            {monthly ? (
              <p className="rounded-xl bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
                هذه السيارة داخلة باشتراك — لا تُحتسب عليها رسوم وقوف.
              </p>
            ) : (
              <>
                {/* ------------------------------ الخيارات ------------------------------ */}
                <div className="grid grid-cols-3 gap-2" role="tablist">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      role="tab"
                      aria-selected={mode === m.value}
                      onClick={() => {
                        setMode(m.value)
                        setAmount('')
                        setError(null)
                      }}
                      className={cx(
                        'relative flex flex-col items-center gap-1 rounded-xl border-2 px-1.5 py-2.5 text-xs font-bold transition',
                        mode === m.value
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {m.icon}
                      {m.label}
                      {m.value === 'convert' && subscription && (
                        <span
                          className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-violet-500"
                          aria-label="لديها اشتراك ساري"
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* ------------------------------ تحصيل ------------------------------ */}
                {mode === 'collect' && (
                  <div className="flex flex-col gap-3">
                    <Field
                      label={`المبلغ المحصّل الآن (${CURRENCY})`}
                      htmlFor="sp-amount"
                      hint="يُضاف لما دُفع ويُخصم من المستحق عند الخروج"
                    >
                      <div className="flex flex-col gap-2">
                        <Input
                          id="sp-amount"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.25"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="num h-12 text-center text-xl font-bold"
                        />
                        <QuickAmounts
                          values={[base, base * 2, base * 3]}
                          current={amount}
                          onPick={setAmount}
                        />
                      </div>
                    </Field>
                    <MethodSelect id="sp-method" value={method} onChange={setMethod} />
                  </div>
                )}

                {/* ------------------------------ تصحيح ------------------------------ */}
                {mode === 'correct' && (
                  <div className="flex flex-col gap-3">
                    <Field
                      label={`المبلغ الذي دُفع فعلاً (${CURRENCY})`}
                      htmlFor="sp-correct"
                      required
                      hint={`المسجّل حالياً: ${formatMoney(prepaid)} — اكتب 0 إذا لم يدفع شيئاً`}
                    >
                      <div className="flex flex-col gap-2">
                        <Input
                          id="sp-correct"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.25"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="num h-12 text-center text-xl font-bold"
                        />
                        <QuickAmounts
                          values={[0, base, base * 2]}
                          current={amount}
                          onPick={setAmount}
                          labelFor={(v) => (v === 0 ? 'لم يدفع' : formatMoney(v))}
                        />
                      </div>
                    </Field>

                    {correctionDiff !== null && Math.abs(correctionDiff) >= 0.001 && (
                      <p
                        className={cx(
                          'rounded-lg px-3 py-2 text-xs',
                          correctionDiff < 0
                            ? 'bg-rose-50 text-rose-800'
                            : 'bg-emerald-50 text-emerald-800',
                        )}
                      >
                        سيُسجَّل قيد تصحيح بقيمة{' '}
                        <span className="num font-bold">
                          {correctionDiff > 0 ? '+' : '−'}
                          {formatMoney(Math.abs(correctionDiff))}
                        </span>{' '}
                        {CURRENCY} بتاريخ الدفع الأصلي. الدفعة الأصلية تبقى في السجل ولا
                        تُحذف.
                      </p>
                    )}

                    {correctedValue > 0 && prepaid === 0 && (
                      <MethodSelect id="sp-correct-method" value={method} onChange={setMethod} />
                    )}

                    <ReasonField value={reason} onChange={setReason} required />
                  </div>
                )}

                {/* ------------------------------ تحويل لاشتراك ------------------------------ */}
                {mode === 'convert' && (
                  <div className="flex flex-col gap-3">
                    {lookupLoading && (
                      <p className="text-sm text-slate-500">جارٍ التحقق من الاشتراك…</p>
                    )}

                    {!lookupLoading && subscription && (
                      <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-sm text-violet-900">
                        <p className="font-bold">
                          اشتراك ساري حتى {formatDate(subscription.end_date)}
                        </p>
                        {subAmount !== null && (
                          <p className="mt-0.5 text-xs">
                            القيمة <span className="num font-semibold">{formatMoney(subAmount)}</span>
                            {' · '}المتبقّي{' '}
                            <span className="num font-semibold">{formatMoney(subBalance)}</span>{' '}
                            {CURRENCY}
                          </p>
                        )}
                      </div>
                    )}

                    {!lookupLoading && !subscription && (
                      <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm text-amber-900">
                          لا يوجد اشتراك ساري لهذه السيارة. أنشئ الاشتراك أولاً، ثم حوّل
                          الدخول.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => setSubFormOpen(true)}
                          icon={<Ticket className="h-4 w-4" aria-hidden />}
                        >
                          إنشاء اشتراك الآن
                        </Button>
                      </div>
                    )}

                    {subscription && prepaid > 0 && (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-sm font-semibold text-slate-700">
                          المبلغ المسجّل عند الدخول ({formatMoney(prepaid)} {CURRENCY})
                        </legend>
                        <ChoiceCard
                          checked={prepaidAction === 'void'}
                          onSelect={() => setPrepaidAction('void')}
                          title="لم يدفع فعلاً"
                          description={
                            <>
                              يُلغى المبلغ من دخل الوقوف بقيد تصحيح{' '}
                              <span className="num">−{formatMoney(prepaid)}</span>
                            </>
                          }
                        />
                        <ChoiceCard
                          checked={prepaidAction === 'to_subscription'}
                          onSelect={() => setPrepaidAction('to_subscription')}
                          disabled={!canMoveToSub}
                          title="دفع فعلاً — احسبه من الاشتراك"
                          description={
                            canMoveToSub
                              ? `يُنقل إلى دفعات الاشتراك، فيصبح المتبقّي ${formatMoney(subBalance - prepaid)}`
                              : subAmount === null
                                ? 'غير متاح: الاشتراك بلا قيمة'
                                : 'غير متاح: المبلغ أكبر من المتبقّي على الاشتراك'
                          }
                        />
                      </fieldset>
                    )}

                    {subscription && <ReasonField value={reason} onChange={setReason} />}
                  </div>
                )}

                {error && (
                  <p
                    className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
              </>
            )}

            {/* ------------------------------ سجل التعديلات ------------------------------ */}
            {history.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-600">
                  <History className="h-3.5 w-3.5" aria-hidden />
                  سجل التعديلات
                </p>
                <ul className="flex flex-col gap-2">
                  {history.map((h) => (
                    <HistoryRow key={h.id} item={h} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <SubscriptionForm
        open={subFormOpen}
        editing={null}
        initialPlate={target?.plate}
        onClose={() => setSubFormOpen(false)}
        onSaved={() => {
          setSubFormOpen(false)
          setMode('convert')
          if (target) void refreshLookup(target.plate)
        }}
      />
    </>
  )
}

/* ------------------------------ مكوّنات مساعدة ------------------------------ */

function QuickAmounts({
  values,
  current,
  onPick,
  labelFor = formatMoney,
}: {
  values: number[]
  current: string
  onPick: (value: string) => void
  labelFor?: (value: number) => string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => {
        const active = current.trim() !== '' && Math.abs(Number(current) - v) < 0.001
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(formatMoney(v))}
            className={cx(
              'rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
            )}
          >
            <span className={v === 0 ? undefined : 'num'}>{labelFor(v)}</span>
          </button>
        )
      })}
    </div>
  )
}

function MethodSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: PaymentMethod
  onChange: (value: PaymentMethod) => void
}) {
  return (
    <Field label="طريقة الدفع" htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
        <option value="cash">نقداً</option>
        <option value="transfer">تحويل</option>
        <option value="other">أخرى</option>
      </Select>
    </Field>
  )
}

function ReasonField({
  value,
  onChange,
  required,
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <Field
      label="سبب التعديل"
      htmlFor="sp-reason"
      required={required}
      hint={required ? 'يُحفظ في سجل التعديلات' : 'اختياري — يُحفظ في سجل التعديلات'}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {REASON_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onChange(chip)}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs transition',
                value === chip
                  ? 'border-brand-500 bg-brand-50 text-brand-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              {chip}
            </button>
          ))}
        </div>
        <Textarea
          id="sp-reason"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          rows={2}
        />
      </div>
    </Field>
  )
}

function ChoiceCard({
  checked,
  onSelect,
  title,
  description,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  description: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-2.5 rounded-xl border-2 px-3 py-2.5 transition',
        disabled && 'cursor-not-allowed opacity-50',
        checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white',
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1 h-4 w-4 text-brand-600"
      />
      <span className="text-sm">
        <span className="font-bold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  )
}

function HistoryRow({ item }: { item: SessionAdjustment }) {
  const before = Number(item.before_state.prepaid_amount ?? 0)
  const after = Number(item.after_state.prepaid_amount ?? 0)
  const change = Number(item.amount_change)

  return (
    <li className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-800">{ACTION_LABEL[item.action]}</span>
        <span className="text-slate-400">{formatDateTime(item.created_at)}</span>
      </div>
      {item.action !== 'auto_fix' && (
        <p className="mt-1">
          المدفوع: <span className="num font-semibold">{formatMoney(before)}</span> ←{' '}
          <span className="num font-semibold">{formatMoney(after)}</span>
          {change !== 0 && (
            <span className={cx('ms-2 font-semibold', change < 0 ? 'text-rose-600' : 'text-emerald-700')}>
              (<span className="num">{change > 0 ? '+' : '−'}{formatMoney(Math.abs(change))}</span>)
            </span>
          )}
        </p>
      )}
      {item.reason && <p className="mt-0.5 text-slate-500">{item.reason}</p>}
    </li>
  )
}
