import { useEffect, useState } from 'react'
import { Droplets } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { cx } from '@/lib/cx'
import { addService } from '@/services/extras'
import { toArabicError } from '@/lib/errors'
import { formatMoney, PAYMENT_METHOD_LABEL, SERVICE_TYPE_LABEL } from '@/lib/format'
import { CURRENCY } from '@/lib/env'
import { isValidPlate } from '@/lib/plate'
import type { PaymentMethod, ServiceType } from '@/types/database'

/** مبالغ شائعة للغسيل والتمسيح — تسريع الإدخال على الموبايل */
const QUICK_AMOUNTS = [0.5, 1, 1.5, 2, 3, 5]

interface ServiceDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
  /** عند الإضافة من شاشة الخروج */
  sessionId?: string | null
  vehicleId?: string | null
  /** رقم اللوحة — يُملأ مسبقاً، أو يُدخله المستخدم للخدمة المستقلة */
  plate?: string | null
  /** true عند الإضافة من صفحة الخدمات (سيارة قد لا تكون في الموقف) */
  standalone?: boolean
}

export function ServiceDialog({
  open,
  onClose,
  onSaved,
  sessionId = null,
  vehicleId = null,
  plate = '',
  standalone = false,
}: ServiceDialogProps) {
  const [serviceType, setServiceType] = useState<ServiceType>('wash')
  const [amount, setAmount] = useState('')
  const [plateValue, setPlateValue] = useState(plate ?? '')
  const [paid, setPaid] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setServiceType('wash')
    setAmount('')
    setPlateValue(plate ?? '')
    setPaid(true)
    setMethod('cash')
    setNotes('')
    setError(null)
  }, [open, plate])

  const handleSave = async () => {
    setError(null)

    const value = Number(amount)
    if (amount.trim() === '' || Number.isNaN(value) || value <= 0) {
      setError('أدخل قيمة الخدمة')
      return
    }

    if (standalone && !isValidPlate(plateValue)) {
      setError('رقم اللوحة مطلوب')
      return
    }

    setSaving(true)
    try {
      await addService({
        serviceType,
        amount: value,
        sessionId,
        vehicleId,
        plate: vehicleId ? null : plateValue,
        paymentStatus: paid ? 'paid' : 'unpaid',
        paymentMethod: paid ? method : null,
        notes,
      })
      await onSaved()
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة خدمة"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() => void handleSave()}
            loading={saving}
            icon={<Droplets className="h-4 w-4" aria-hidden />}
          >
            حفظ الخدمة
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="نوع الخدمة" required>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setServiceType(type)}
                aria-pressed={serviceType === type}
                className={cx(
                  'h-12 rounded-xl border-2 text-sm font-bold transition',
                  serviceType === type
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {SERVICE_TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </Field>

        {(standalone || !vehicleId) && (
          <Field
            label="رقم اللوحة"
            htmlFor="svc-plate"
            required={standalone}
            hint={standalone ? 'تُضاف السيارة تلقائياً إن لم تكن مسجّلة' : undefined}
          >
            <Input
              id="svc-plate"
              value={plateValue}
              onChange={(e) => setPlateValue(e.target.value)}
              placeholder="مثال: 15-11000"
              className="num text-lg font-bold"
              maxLength={32}
            />
          </Field>
        )}

        <Field
          label={`القيمة (${CURRENCY})`}
          htmlFor="svc-amount"
          required
          hint="تُدخل يدوياً حسب نوع الخدمة"
        >
          <div className="flex flex-col gap-2">
            <Input
              id="svc-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num h-14 text-center text-2xl font-bold"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAmount(formatMoney(value))}
                  className={cx(
                    'num rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                    Number(amount) === value
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

        <Field label="حالة الدفع">
          <div className="grid grid-cols-2 gap-2">
            {[
              [true, 'مدفوع'],
              [false, 'غير مدفوع'],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setPaid(value as boolean)}
                aria-pressed={paid === value}
                className={cx(
                  'h-12 rounded-xl border-2 text-sm font-bold transition',
                  paid === value
                    ? value
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-rose-600 bg-rose-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
        </Field>

        {paid && (
          <Field label="طريقة الدفع" htmlFor="svc-method">
            <Select
              id="svc-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="ملاحظات" htmlFor="svc-notes">
          <Textarea
            id="svc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="اختياري"
            maxLength={200}
            rows={2}
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
      </div>
    </Modal>
  )
}
