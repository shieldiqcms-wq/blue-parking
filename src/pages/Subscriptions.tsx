import { useEffect, useState, type FormEvent } from 'react'
import { CalendarPlus, Plus, Search, Ticket, X } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import {
  cancelSubscription,
  createSubscription,
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
  SUBSCRIPTION_STATUS_LABEL,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
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
import { cx } from '@/lib/cx'
import type {
  ComputedSubscriptionStatus,
  SubscriptionRow,
  Vehicle,
} from '@/types/database'

type Filter = ComputedSubscriptionStatus | 'all'

const FILTERS: Array<[Filter, string]> = [
  ['active', 'سارية'],
  ['expired', 'منتهية'],
  ['upcoming', 'لم تبدأ'],
  ['all', 'الكل'],
]

export function SubscriptionsPage() {
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')

  const subs = useAsync(
    () => listSubscriptions({ status: filter, search }),
    [filter, search],
  )

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionRow | null>(null)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (row: SubscriptionRow) => {
    setEditing(row)
    setFormOpen(true)
  }

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

      {subs.loading && !subs.data && <LoadingBlock />}
      {subs.error && (
        <ErrorBlock message={subs.error} onRetry={() => void subs.reload()} />
      )}

      {subs.data && subs.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Ticket className="h-7 w-7" aria-hidden />}
            title="لا توجد اشتراكات"
            description="أضف اشتراكاً شهرياً لسيارة مسجّلة"
            action={
              <Button size="sm" onClick={openCreate}>
                اشتراك جديد
              </Button>
            }
          />
        </Card>
      )}

      {subs.data && subs.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {subs.data.map((row) => (
            <li key={row.id}>
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
                    {row.monthly_amount !== null && (
                      <span>
                        <span className="num font-semibold text-slate-700">
                          {formatMoney(row.monthly_amount)}
                        </span>{' '}
                        {CURRENCY} شهرياً
                      </span>
                    )}
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

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleExtend(row)}
                      icon={<CalendarPlus className="h-4 w-4" aria-hidden />}
                    >
                      تمديد شهر
                    </Button>
                    {row.raw_status === 'active' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCancel(row)}
                        icon={<X className="h-4 w-4" aria-hidden />}
                      >
                        إلغاء
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleReactivate(row)}
                      >
                        إعادة تفعيل
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
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
    </div>
  )
}

/* ------------------------------ نموذج الاشتراك ----------------------------- */

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

  const [vehicleSearch, setVehicleSearch] = useState('')
  const [options, setOptions] = useState<Vehicle[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(
    null,
  )
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(addMonths(today, 1), -1))
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // تهيئة النموذج عند كل فتح
  useEffect(() => {
    if (!open) return

    if (editing) {
      setSelected({
        id: editing.vehicle_id,
        label: displayPlate(editing.plate_number),
      })
      setStartDate(editing.start_date)
      setEndDate(editing.end_date)
      setAmount(
        editing.monthly_amount !== null ? String(editing.monthly_amount) : '',
      )
      setNotes(editing.notes ?? '')
    } else {
      setSelected(null)
      setStartDate(today)
      setEndDate(addDays(addMonths(today, 1), -1))
      setAmount('')
      setNotes('')
    }

    setVehicleSearch('')
    setOptions([])
    setError(null)
  }, [open, editing, today])

  const handleSearchVehicle = async (term: string) => {
    setVehicleSearch(term)
    if (term.trim().length < 2) {
      setOptions([])
      return
    }
    setSearching(true)
    try {
      setOptions(await searchVehiclesForSubscription(term))
    } catch (err) {
      toast.error(toArabicError(err))
    } finally {
      setSearching(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!selected) {
      setError('يجب اختيار السيارة')
      return
    }

    const payload: SubscriptionInput = {
      vehicle_id: selected.id,
      start_date: startDate,
      end_date: endDate,
      monthly_amount: amount.trim() === '' ? null : Number(amount),
      notes,
    }

    if (payload.monthly_amount !== null && Number.isNaN(payload.monthly_amount)) {
      setError('قيمة الاشتراك غير صحيحة')
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await updateSubscription(editing.id, payload)
        toast.success('تم تحديث الاشتراك')
      } else {
        await createSubscription(payload)
        toast.success('تمت إضافة الاشتراك')
      }
      onSaved()
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
        <Field
          label="السيارة"
          htmlFor="sub-vehicle"
          required
          hint={
            selected
              ? undefined
              : 'اكتب حرفين على الأقل من رقم اللوحة أو اسم المالك'
          }
        >
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5">
              <span className="num font-bold text-brand-900">
                {selected.label}
              </span>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                >
                  تغيير
                </Button>
              )}
            </div>
          ) : (
            <>
              <Input
                id="sub-vehicle"
                value={vehicleSearch}
                onChange={(e) => void handleSearchVehicle(e.target.value)}
                placeholder="ابحث عن السيارة"
                autoComplete="off"
              />
              {searching && (
                <p className="text-xs text-slate-500">جارٍ البحث…</p>
              )}
              {!searching &&
                vehicleSearch.trim().length >= 2 &&
                options.length === 0 && (
                  <p className="text-xs text-slate-500">
                    لا توجد سيارة بهذا الرقم — سجّلها من صفحة «السيارات» أولاً
                  </p>
                )}
              {options.length > 0 && (
                <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {options.map((vehicle) => (
                    <li key={vehicle.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected({
                            id: vehicle.id,
                            label: displayPlate(vehicle.plate_number),
                          })
                          setOptions([])
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
              )}
            </>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`قيمة الاشتراك (${CURRENCY})`}
            htmlFor="sub-amount"
            hint="اختياري — للتوثيق فقط"
          >
            <Input
              id="sub-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num"
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
