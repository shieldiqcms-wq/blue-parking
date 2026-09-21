import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { paySubscription } from '@/services/subscriptions'
import { toArabicError } from '@/lib/errors'
import { formatMoney } from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import { Button, Field, Input, Modal, Select } from '@/components/ui'
import type { PaymentMethod } from '@/types/database'

export interface SubscriptionDue {
  subscriptionId: string
  plate: string
  /** قيمة الاشتراك الكاملة */
  amount: number | null
  /** المتبقّي غير المدفوع */
  balance: number
}

/**
 * تحصيل دفعة على اشتراك — كامل المتبقّي افتراضياً، ويمكن تعديله لدفعة
 * جزئية. تُستخدم من صفحة الاشتراكات ومن شاشة الدخول (عند التذكير).
 */
export function SubscriptionPayDialog({
  due,
  onClose,
  onPaid,
}: {
  due: SubscriptionDue | null
  onClose: () => void
  onPaid: () => void
}) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!due) return
    setAmount(formatMoney(due.balance))
    setMethod('cash')
    setError(null)
  }, [due])

  const value = Number(amount)
  const invalid =
    amount.trim() === '' || Number.isNaN(value) || value <= 0

  const handlePay = async () => {
    if (!due) return
    setError(null)

    if (invalid) {
      setError('أدخل مبلغاً صحيحاً أكبر من صفر')
      return
    }
    if (value > due.balance + 0.001) {
      setError(`المبلغ أكبر من المتبقّي (${formatMoney(due.balance)} ${CURRENCY})`)
      return
    }

    setSaving(true)
    try {
      const result = await paySubscription(due.subscriptionId, value, method)
      toast.success(
        Number(result.balance) > 0
          ? `تم تحصيل ${formatMoney(result.paid_now)} ${CURRENCY} — المتبقّي ${formatMoney(result.balance)} ${CURRENCY}`
          : `تم تحصيل ${formatMoney(result.paid_now)} ${CURRENCY} — الاشتراك مدفوع بالكامل`,
      )
      onPaid()
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={due !== null}
      onClose={onClose}
      title="تحصيل الاشتراك"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() => void handlePay()}
            loading={saving}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
          >
            تحصيل
          </Button>
        </>
      }
    >
      {due && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-sand-50 p-3 text-center ring-1 ring-sand-200">
            <div>
              <p className="text-[11px] text-slate-500">السيارة</p>
              <p className="num mt-0.5 font-bold text-slate-900">
                {displayPlate(due.plate)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">قيمة الاشتراك</p>
              <p className="num mt-0.5 font-bold text-slate-900">
                {due.amount !== null ? formatMoney(due.amount) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">المتبقّي</p>
              <p className="num mt-0.5 font-bold text-rose-700">
                {formatMoney(due.balance)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`المبلغ المدفوع الآن (${CURRENCY})`}
              htmlFor="sub-pay-amount"
              hint="اتركه كما هو لتسديد الكل، أو غيّره لدفعة جزئية"
            >
              <Input
                id="sub-pay-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="num text-lg font-bold"
              />
            </Field>
            <Field label="طريقة الدفع" htmlFor="sub-pay-method">
              <Select
                id="sub-pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                <option value="cash">نقداً</option>
                <option value="transfer">تحويل</option>
                <option value="other">أخرى</option>
              </Select>
            </Field>
          </div>

          {error && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
