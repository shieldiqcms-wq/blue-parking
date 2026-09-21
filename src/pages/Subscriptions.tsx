import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BellRing,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  SplitSquareHorizontal,
  Ticket,
  Wallet,
  X,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import {
  cancelSubscription,
  createSubscriptionWithPayment,
  extendSubscription,
  listSubscriptions,
  reactivateSubscription,
  searchVehiclesForSubscription,
  updateSubscription,
  type SubscriptionInput,
} from '@/services/subscriptions'
import { toArabicError } from '@/lib/errors'
import {
  addDays,
  addMonths,
  ammanToday,
  formatDate,
  formatMoney,
  SUBSCRIPTION_PAYMENT_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
} from '@/lib/format'
import { displayPlate, normalizePlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeading,
  Select,
  Textarea,
} from '@/components/ui'
import { PlateInput } from '@/components/PlateInput'
import {
  SubscriptionPayDialog,
  type SubscriptionDue,
} from '@/components/SubscriptionPayDialog'
import { cx } from '@/lib/cx'
import type {
  ComputedSubscriptionStatus,
  PaymentMethod,
  SubscriptionPayMode,
  SubscriptionPaymentState,
  SubscriptionRow,
  Vehicle,
} from '@/types/database'

type Filter = ComputedSubscriptionStatus | 'all' | 'due'

const FILTERS: Array<[Filter, string]> = [
  ['active', 'سارية'],
  ['due', 'غير مدفوعة'],
  ['expired', 'منتهية'],
  ['upcoming', 'لم تبدأ'],
  ['all', 'الكل'],
]

const PAYMENT_TONE: Record<SubscriptionPaymentState, 'green' | 'amber' | 'red' | 'slate'> = {
  paid: 'green',
  partial: 'amber',
  unpaid: 'red',
  no_amount: 'slate',
}

/** اشتراك ساري أو قادم وعليه مبلغ غير مدفوع */
function isDue(row: SubscriptionRow): boolean {
  return row.raw_status === 'active' && Number(row.balance) > 0
}

export function SubscriptionsPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')

  const subs = useAsync(async () => {
    if (filter === 'due') {
      const rows = await listSubscriptions({ status: 'all', search })
      return rows.filter(isDue)
    }
    return listSubscriptions({ status: filter, search })
  }, [filter, search])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)
  const [paying, setPaying] = useState<SubscriptionDue | null>(null)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (row: SubscriptionRow) => {
    setEditing(row)
    setFormOpen(true)
  }

  const openPay = (row: SubscriptionRow) =>
    setPaying({
      subscriptionId: row.id,
      plate: row.plate_number,
      amount: row.monthly_amount,
      balance: Number(row.balance),
    })

  const handleExtend = async (row: SubscriptionRow) => {
    const base = row.end_date < ammanToday() ? ammanToday() : row.end_date
    try {
      await extendSubscription(row.id, addMonths(base, 1))
      toast.success('تم تمديد الاشتراك شهراً إضافياً')
      await subs.reload()
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const handleCancel = async (row: SubscriptionRow) => {
    try {
      await cancelSubscription(row.id)
      toast.success('تم إلغاء الاشتراك')
      await subs.reload()
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const handleReactivate = async (row: SubscriptionRow) => {
    try {
      await reactivateSubscription(row.id)
      toast.success('تم تفعيل الاشتراك')
      await subs.reload()
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const dueRows = (subs.data ?? []).filter(isDue)
  const dueTotal = dueRows.reduce((sum, row) => sum + Number(row.balance), 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="الاشتراكات"
        description="السيارات المشتركة شهرياً لا تُحتسب عليها رسوم زيارة"
        action={
          <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
            اشتراك جديد
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cx(
                'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition',
                filter === value
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-sand-300 hover:bg-sand-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث برقم اللوحة أو اسم المالك"
            className="pe-10"
            aria-label="بحث"
          />
        </div>
      </div>

      {dueRows.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <BellRing className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <p className="text-sm text-amber-900">
            <span className="num font-bold">{dueRows.length}</span>{' '}
            {dueRows.length === 1 ? 'اشتراك عليه' : 'اشتراكات عليها'} مبالغ غير
            مدفوعة — المجموع{' '}
            <span className="num font-bold">{formatMoney(dueTotal)}</span>{' '}
            {CURRENCY}
          </p>
        </div>
      )}

      {subs.loading && !subs.data && <LoadingBlock />}
      {subs.error && (
        <ErrorBlock message={subs.error} onRetry={() => void subs.reload()} />
      )}

      {subs.data && subs.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Ticket className="h-7 w-7" aria-hidden />}
            title={filter === 'due' ? 'كل الاشتراكات مدفوعة' : 'لا توجد اشتراكات'}
            description={
              filter === 'due'
                ? 'لا يوجد اشتراك عليه مبلغ غير مدفوع'
                : 'أضف اشتراكاً شهرياً — لسيارة مسجّلة أو جديدة'
            }
            action={
              filter === 'due' ? undefined : (
                <Button size="sm" onClick={openCreate}>
                  اشتراك جديد
                </Button>
              )
            }
          />
        </Card>
      )}

      {subs.data && subs.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {subs.data.map((row) => (
            <li key={row.id}>
              <SubscriptionCard
                row={row}
                onEdit={() => openEdit(row)}
                onPay={() => openPay(row)}
                onExtend={() => void handleExtend(row)}
                onCancel={() => void handleCancel(row)}
                onReactivate={() => void handleReactivate(row)}
              />
            </li>
          ))}
        </ul>
      )}

      <SubscriptionForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          void subs.reload()
        }}
      />

      <SubscriptionPayDialog
        due={paying}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null)
          void subs.reload()
        }}
      />
    </div>
  )
}

/* ------------------------------ بطاقة الاشتراك ----------------------------- */

function SubscriptionCard({
  row,
  onEdit,
  onPay,
  onExtend,
  onCancel,
  onReactivate,
}: {
  row: SubscriptionRow
  onEdit: () => void
  onPay: () => void
  onExtend: () => void
  onCancel: () => void
  onReactivate: () => void
}) {
  const due = isDue(row)

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="num text-base font-bold text-slate-900">
              {displayPlate(row.plate_number)}
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {row.owner_name || 'بدون اسم مالك'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={PAYMENT_TONE[row.payment_state]}>
              {SUBSCRIPTION_PAYMENT_LABEL[row.payment_state]}
            </Badge>
            <Badge
              tone={
                row.computed_status === 'active'
                  ? 'green'
                  : row.computed_status === 'upcoming'
                    ? 'blue'
                    : row.computed_status === 'cancelled'
                      ? 'slate'
                      : 'red'
              }
            >
              {SUBSCRIPTION_STATUS_LABEL[row.computed_status]}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            من{' '}
            <span className="num font-semibold text-slate-700">
              {formatDate(row.start_date)}
            </span>
          </span>
          <span>
            إلى{' '}
            <span className="num font-semibold text-slate-700">
              {formatDate(row.end_date)}
            </span>
          </span>
          {row.computed_status === 'active' && (
            <span
              className={cx(
                'font-semibold',
                row.days_left <= 7 ? 'text-amber-600' : 'text-slate-500',
              )}
            >
              متبقٍ <span className="num">{row.days_left}</span> يوم
            </span>
          )}
        </div>

        {row.monthly_amount !== null && (
          <div
            className={cx(
              'grid grid-cols-3 gap-2 rounded-xl p-2.5 text-center',
              due ? 'bg-rose-50 ring-1 ring-rose-100' : 'bg-sand-50 ring-1 ring-sand-200',
            )}
          >
            <MoneyCell label="القيمة" value={row.monthly_amount} />
            <MoneyCell label="المدفوع" value={row.paid_amount} tone="green" />
            <MoneyCell
              label="المتبقّي"
              value={row.balance}
              tone={due ? 'red' : 'slate'}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {due && (
            <Button
              size="sm"
              onClick={onPay}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
            >
              تحصيل
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onEdit}>
            تعديل
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onExtend}
            icon={<CalendarPlus className="h-4 w-4" aria-hidden />}
          >
            تمديد شهر
          </Button>
          {row.raw_status === 'active' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              icon={<X className="h-4 w-4" aria-hidden />}
            >
              إلغاء
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onReactivate}>
              إعادة تفعيل
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function MoneyCell({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number | null
  tone?: 'slate' | 'green' | 'red'
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p
        className={cx(
          'num mt-0.5 text-sm font-bold',
          tone === 'green' && 'text-emerald-700',
          tone === 'red' && 'text-rose-700',
          tone === 'slate' && 'text-slate-800',
        )}
      >
        {formatMoney(value)}
      </p>
    </div>
  )
}

/* ------------------------------ نموذج الاشتراك ----------------------------- */

const PAY_MODES: Array<{
  value: SubscriptionPayMode
  label: string
  hint: string
  icon: ReactNode
  active: string
}> = [
  {
    value: 'now',
    label: 'كامل الآن',
    hint: 'يُسجَّل المبلغ كاملاً في صندوق اليوم',
    icon: <CheckCircle2 className="h-5 w-5" aria-hidden />,
    active: 'border-emerald-500 bg-emerald-50 text-emerald-800',
  },
  {
    value: 'partial',
    label: 'جزء الآن',
    hint: 'يُسجَّل المدفوع اليوم ويبقى الباقي ديناً عليه',
    icon: <SplitSquareHorizontal className="h-5 w-5" aria-hidden />,
    active: 'border-amber-500 bg-amber-50 text-amber-800',
  },
  {
    value: 'later',
    label: 'لاحقاً',
    hint: 'لا يُقبض شيء الآن — ويظهر تذكير كلما دخلت السيارة',
    icon: <Clock className="h-5 w-5" aria-hidden />,
    active: 'border-slate-500 bg-slate-100 text-slate-800',
  },
]

function SubscriptionForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: SubscriptionRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const today = ammanToday()

  // السيارة: رقم اللوحة يُكتب مباشرة، وإن كانت مسجّلة تُختار من النتائج
  const [plate, setPlate] = useState('')
  const [matches, setMatches] = useState<Vehicle[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Vehicle | null>(null)
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(addMonths(today, 1), -1))
  const [amount, setAmount] = useState('')
  const [payMode, setPayMode] = useState<SubscriptionPayMode>('now')
  const [paidAmount, setPaidAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const hadAmount = useRef(false)

  // تهيئة النموذج عند كل فتح
  useEffect(() => {
    if (!open) return

    if (editing) {
      setStartDate(editing.start_date)
      setEndDate(editing.end_date)
      setAmount(
        editing.monthly_amount !== null ? String(editing.monthly_amount) : '',
      )
      setNotes(editing.notes ?? '')
    } else {
      setStartDate(today)
      setEndDate(addDays(addMonths(today, 1), -1))
      setAmount('')
      setNotes('')
    }

    setPlate('')
    setMatches([])
    setSelected(null)
    setOwnerName('')
    setPhone('')
    // بلا قيمة بعد ← «لاحقاً»؛ وعند كتابة القيمة يُقترح «كامل الآن»
    setPayMode('later')
    hadAmount.current = false
    setPaidAmount('')
    setMethod('cash')
    setError(null)
  }, [open, editing, today])

  // البحث عن السيارة أثناء الكتابة
  const normalized = normalizePlate(plate)
  useEffect(() => {
    if (!open || editing || selected) return
    if (!normalized || normalized.length < 3) {
      setMatches([])
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      searchVehiclesForSubscription(normalized)
        .then((found) => {
          if (cancelled) return
          setMatches(found)
          // تطابق تام = السيارة مسجّلة، نختارها تلقائياً
          const exact = found.find((v) => v.plate_normalized === normalized)
          if (exact) setSelected(exact)
        })
        .catch((err) => {
          if (!cancelled) toast.error(toArabicError(err))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [normalized, open, editing, selected, toast])

  const amountValue = amount.trim() === '' ? null : Number(amount)
  const hasAmount = amountValue !== null && !Number.isNaN(amountValue) && amountValue > 0

  // بلا قيمة لا يمكن تسجيل دفعة؛ وعند إدخال القيمة نقترح «كامل الآن»
  useEffect(() => {
    if (!hasAmount) {
      setPayMode('later')
    } else if (!hadAmount.current) {
      setPayMode('now')
    }
    hadAmount.current = hasAmount
  }, [hasAmount])

  const handlePlateChange = (value: string) => {
    setPlate(value)
    if (selected) setSelected(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (amountValue !== null && (Number.isNaN(amountValue) || amountValue < 0)) {
      setError('قيمة الاشتراك غير صحيحة')
      return
    }

    if (editing) {
      if (amountValue !== null && amountValue < Number(editing.paid_amount)) {
        setError(
          `القيمة أقل مما دُفع فعلاً (${formatMoney(editing.paid_amount)} ${CURRENCY})`,
        )
        return
      }

      const payload: SubscriptionInput = {
        vehicle_id: editing.vehicle_id,
        start_date: startDate,
        end_date: endDate,
        monthly_amount: amountValue,
        notes,
      }

      setSaving(true)
      try {
        await updateSubscription(editing.id, payload)
        toast.success('تم تحديث الاشتراك')
        onSaved()
      } catch (err) {
        setError(toArabicError(err))
      } finally {
        setSaving(false)
      }
      return
    }

    if (!selected && !normalized) {
      setError('اكتب رقم اللوحة')
      return
    }

    let paid: number | null = null
    if (payMode === 'partial') {
      paid = Number(paidAmount)
      if (paidAmount.trim() === '' || Number.isNaN(paid) || paid <= 0) {
        setError('أدخل المبلغ المدفوع الآن')
        return
      }
      if (hasAmount && paid >= (amountValue as number)) {
        setError('المبلغ المدفوع يساوي القيمة أو أكثر — اختر «كامل الآن»')
        return
      }
    }

    setSaving(true)
    try {
      const result = await createSubscriptionWithPayment({
        vehicleId: selected?.id ?? null,
        plate: selected ? null : plate,
        ownerName: selected ? null : ownerName,
        phone: selected ? null : phone,
        startDate,
        endDate,
        monthlyAmount: amountValue,
        payMode,
        paidAmount: paid,
        paymentMethod: method,
        notes,
      })

      const parts = ['تم إنشاء الاشتراك']
      if (result.is_new_vehicle) parts.push('وسُجّلت السيارة')
      if (Number(result.balance) > 0) {
        parts.push(`— المتبقّي ${formatMoney(result.balance)} ${CURRENCY}`)
      } else if (Number(result.paid_amount) > 0) {
        parts.push('— مدفوع بالكامل')
      }
      toast.success(parts.join(' '))
      onSaved()
    } catch (err) {
      setError(toArabicError(err))
    } finally {
      setSaving(false)
    }
  }

  const showNewVehicle = !editing && !selected && Boolean(normalized) && !searching
  const suggestions = matches.filter((v) => v.id !== selected?.id)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'تعديل الاشتراك' : 'اشتراك شهري جديد'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={(e) => void handleSubmit(e as unknown as FormEvent)}
            loading={saving}
          >
            حفظ
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {/* ------------------------------ السيارة ------------------------------ */}
        {editing ? (
          <Field label="السيارة">
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5">
              <span className="num font-bold text-brand-900">
                {displayPlate(editing.plate_number)}
              </span>
              {editing.owner_name && (
                <span className="ms-2 text-sm text-brand-800">
                  {editing.owner_name}
                </span>
              )}
            </div>
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            <Field label="رقم اللوحة" htmlFor="sub-plate" required>
              <PlateInput id="sub-plate" value={plate} onChange={handlePlateChange} />
            </Field>

            {searching && <p className="text-xs text-slate-500">جارٍ البحث…</p>}

            {selected && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-700">
                    سيارة مسجّلة
                  </p>
                  <p className="truncate text-sm text-emerald-900">
                    <span className="num font-bold">
                      {displayPlate(selected.plate_number)}
                    </span>
                    {selected.owner_name && ` — ${selected.owner_name}`}
                  </p>
                </div>
                <Badge tone="green">مسجّلة</Badge>
              </div>
            )}

            {!selected && suggestions.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-slate-500">
                  سيارات مشابهة — اضغط لاختيارها:
                </p>
                <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {suggestions.map((vehicle) => (
                    <li key={vehicle.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(vehicle)
                          setPlate(vehicle.plate_number)
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start hover:bg-slate-50"
                      >
                        <span className="num font-semibold text-slate-800">
                          {displayPlate(vehicle.plate_number)}
                        </span>
                        <span className="truncate text-xs text-slate-500">
                          {vehicle.owner_name || '—'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showNewVehicle && (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="amber">سيارة جديدة</Badge>
                  <p className="text-xs text-amber-900">
                    ستُسجَّل تلقائياً مع الاشتراك — لا يلزم دخولها الموقف
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="اسم المالك" htmlFor="sub-owner">
                    <Input
                      id="sub-owner"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      maxLength={100}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="رقم الهاتف" htmlFor="sub-phone">
                    <Input
                      id="sub-phone"
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={20}
                      autoComplete="off"
                      className="num"
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ المدة ------------------------------ */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ البداية" htmlFor="sub-start" required>
            <Input
              id="sub-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="تاريخ النهاية" htmlFor="sub-end" required>
            <Input
              id="sub-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {[1, 3, 6, 12].map((months) => (
            <Button
              key={months}
              size="sm"
              variant="secondary"
              onClick={() => setEndDate(addDays(addMonths(startDate, months), -1))}
            >
              {months === 1 ? 'شهر' : months === 12 ? 'سنة' : `${months} أشهر`}
            </Button>
          ))}
        </div>

        {/* ------------------------------ القيمة ------------------------------ */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`قيمة الاشتراك (${CURRENCY})`}
            htmlFor="sub-amount"
            hint={
              editing
                ? `المدفوع حتى الآن: ${formatMoney(editing.paid_amount)} ${CURRENCY}`
                : 'مطلوبة لتسجيل الدفع أو التذكير بالمتبقّي'
            }
          >
            <Input
              id="sub-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num text-lg font-bold"
            />
          </Field>

          {editing && (
            <Field label="الحالة">
              <Select value={editing.raw_status} disabled>
                <option value="active">فعّال</option>
                <option value="cancelled">ملغي</option>
              </Select>
            </Field>
          )}
        </div>

        {/* ------------------------------ الدفع ------------------------------ */}
        {!editing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-slate-700">الدفع</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="خيار الدفع">
              {PAY_MODES.map((mode) => {
                const disabled = mode.value !== 'later' && !hasAmount
                const active = payMode === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => setPayMode(mode.value)}
                    className={cx(
                      'flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-sm font-bold transition',
                      'disabled:cursor-not-allowed disabled:opacity-40',
                      active
                        ? mode.active
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {mode.icon}
                    {mode.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-500">
              {hasAmount
                ? PAY_MODES.find((m) => m.value === payMode)?.hint
                : 'أدخل قيمة الاشتراك لتفعيل خيارات الدفع'}
            </p>

            {payMode !== 'later' && (
              <div className="grid gap-4 sm:grid-cols-2">
                {payMode === 'partial' && (
                  <Field
                    label={`المدفوع الآن (${CURRENCY})`}
                    htmlFor="sub-paid"
                    required
                    hint={
                      hasAmount && paidAmount.trim() !== '' && !Number.isNaN(Number(paidAmount))
                        ? `المتبقّي: ${formatMoney(Math.max(0, (amountValue as number) - Number(paidAmount)))} ${CURRENCY}`
                        : undefined
                    }
                  >
                    <Input
                      id="sub-paid"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.25"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      className="num text-lg font-bold"
                    />
                  </Field>
                )}
                <Field label="طريقة الدفع" htmlFor="sub-method">
                  <Select
                    id="sub-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="cash">نقداً</option>
                    <option value="transfer">تحويل</option>
                    <option value="other">أخرى</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        <Field label="ملاحظات" htmlFor="sub-notes">
          <Textarea
            id="sub-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
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

        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  )
}
