import { useState } from 'react'
import {
  Droplets,
  Receipt,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import {
  addExpense,
  deleteExpense,
  deleteService,
  listExpenses,
  listServices,
} from '@/services/extras'
import { getDashboard } from '@/services/reports'
import { ServiceDialog } from '@/components/ServiceDialog'
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeading,
  StatCard,
  Textarea,
} from '@/components/ui'
import { cx } from '@/lib/cx'
import { toArabicError } from '@/lib/errors'
import {
  addDays,
  ammanToday,
  formatDate,
  formatMoney,
  formatTime,
  COST_CENTER_LABEL,
  EXPENSE_CATEGORY_LABEL,
  SERVICE_TYPE_LABEL,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import type { CostCenter, ExpenseCategory } from '@/types/database'

const QUICK_EXPENSE = [0.5, 1, 2, 3, 5, 10]

type Range = 'today' | 'week' | 'month'

const RANGES: Array<[Range, string]> = [
  ['today', 'اليوم'],
  ['week', 'آخر 7 أيام'],
  ['month', 'آخر 30 يوم'],
]

function rangeDates(range: Range): [string, string] {
  const today = ammanToday()
  if (range === 'today') return [today, today]
  if (range === 'week') return [addDays(today, -6), today]
  return [addDays(today, -29), today]
}

/**
 * الصندوق — الخدمات الإضافية والمصاريف اليومية في مكان واحد،
 * لأن كليهما يؤثر مباشرة على حصيلة اليوم.
 */
export function CashbookPage() {
  const toast = useToast()
  const [range, setRange] = useState<Range>('today')
  const [from, to] = rangeDates(range)

  const stats = useAsync(getDashboard, [])
  const services = useAsync(() => listServices({ from, to }), [from, to])
  const expenses = useAsync(() => listExpenses({ from, to }), [from, to])

  const [serviceOpen, setServiceOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)

  const reloadAll = async () => {
    await Promise.all([stats.reload(), services.reload(), expenses.reload()])
  }

  const handleDeleteService = async (id: string, label: string) => {
    if (!window.confirm(`حذف خدمة «${label}»؟ لا يمكن التراجع.`)) return
    try {
      await deleteService(id)
      toast.success('تم حذف الخدمة')
      await reloadAll()
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const handleDeleteExpense = async (id: string, label: string) => {
    if (!window.confirm(`حذف مصروف «${label}»؟ لا يمكن التراجع.`)) return
    try {
      await deleteExpense(id)
      toast.success('تم حذف المصروف')
      await reloadAll()
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const servicesTotal = (services.data ?? []).reduce(
    (sum, s) => sum + (s.payment_status === 'paid' ? Number(s.amount) : 0),
    0,
  )
  const expensesTotal = (expenses.data ?? []).reduce(
    (sum, e) => sum + Number(e.amount),
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="الصندوق"
        description="الخدمات الإضافية والمصاريف اليومية"
      />

      {/* --------------------------- حصيلة اليوم --------------------------- */}
      {stats.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="وقوف اليوم"
            value={formatMoney(stats.data.parking_today)}
            unit={CURRENCY}
            icon={<Wallet className="h-4 w-4" aria-hidden />}
            tone="blue"
          />
          <StatCard
            label="خدمات اليوم"
            value={formatMoney(stats.data.services_today)}
            unit={CURRENCY}
            icon={<Droplets className="h-4 w-4" aria-hidden />}
            tone="blue"
            hint={`${stats.data.services_count_today} خدمة`}
          />
          <StatCard
            label="مصاريف اليوم"
            value={formatMoney(stats.data.expenses_today)}
            unit={CURRENCY}
            icon={<TrendingDown className="h-4 w-4" aria-hidden />}
            tone={stats.data.expenses_today > 0 ? 'red' : 'slate'}
            hint={`${stats.data.expenses_count_today} مصروف`}
          />
          <StatCard
            label="صافي اليوم"
            value={formatMoney(stats.data.net_today)}
            unit={CURRENCY}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            tone={stats.data.net_today >= 0 ? 'green' : 'red'}
            hint="بعد خصم المصاريف"
          />
        </div>
      )}

      {/* ------------------------- الإجراءات السريعة ------------------------- */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="xl"
          onClick={() => setServiceOpen(true)}
          icon={<Droplets className="h-6 w-6" aria-hidden />}
          className="h-20 flex-col gap-1 bg-sky-600 text-base hover:bg-sky-700 active:bg-sky-800 sm:flex-row sm:text-lg"
        >
          إضافة خدمة
        </Button>
        <Button
          size="xl"
          variant="danger"
          onClick={() => setExpenseOpen(true)}
          icon={<Receipt className="h-6 w-6" aria-hidden />}
          className="h-20 flex-col gap-1 text-base sm:flex-row sm:text-lg"
        >
          إضافة مصروف
        </Button>
      </div>

      {/* ------------------------------ الفترة ------------------------------ */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {RANGES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            className={cx(
              'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition',
              range === value
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-sand-300 hover:bg-sand-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------ الخدمات ------------------------------ */}
      <Card padded={false}>
        <div className="px-4 pt-4 sm:px-5">
          <CardTitle
            action={
              <span className="num text-sm font-bold text-sky-700">
                {formatMoney(servicesTotal)} {CURRENCY}
              </span>
            }
          >
            الخدمات
          </CardTitle>
        </div>

        {services.loading && !services.data && <LoadingBlock />}
        {services.error && (
          <div className="px-4 pb-4">
            <ErrorBlock
              message={services.error}
              onRetry={() => void services.reload()}
            />
          </div>
        )}
        {services.data && services.data.length === 0 && (
          <EmptyState
            icon={<Droplets className="h-7 w-7" aria-hidden />}
            title="لا توجد خدمات في هذه الفترة"
            description="الغسيل والتمسيح يُسجَّلان هنا بقيمة يدوية"
          />
        )}
        {services.data && services.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {services.data.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">
                      {SERVICE_TYPE_LABEL[s.service_type]}
                    </span>
                    {s.plate_number && (
                      <span className="num text-sm text-slate-600">
                        {displayPlate(s.plate_number)}
                      </span>
                    )}
                    {s.payment_status === 'unpaid' && (
                      <Badge tone="red">غير مدفوع</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(s.performed_at)} · {formatTime(s.performed_at)}
                    {s.notes && ` · ${s.notes}`}
                  </p>
                </div>

                <span className="num shrink-0 text-sm font-bold text-slate-800">
                  {formatMoney(s.amount)} {CURRENCY}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void handleDeleteService(
                      s.id,
                      SERVICE_TYPE_LABEL[s.service_type],
                    )
                  }
                  aria-label="حذف الخدمة"
                  icon={<Trash2 className="h-4 w-4 text-rose-500" aria-hidden />}
                  className="shrink-0 px-2"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ----------------------------- المصاريف ----------------------------- */}
      <Card padded={false}>
        <div className="px-4 pt-4 sm:px-5">
          <CardTitle
            action={
              <span className="num text-sm font-bold text-rose-700">
                {formatMoney(expensesTotal)} {CURRENCY}
              </span>
            }
          >
            المصاريف
          </CardTitle>
        </div>

        {expenses.loading && !expenses.data && <LoadingBlock />}
        {expenses.error && (
          <div className="px-4 pb-4">
            <ErrorBlock
              message={expenses.error}
              onRetry={() => void expenses.reload()}
            />
          </div>
        )}
        {expenses.data && expenses.data.length === 0 && (
          <EmptyState
            icon={<Receipt className="h-7 w-7" aria-hidden />}
            title="لا توجد مصاريف في هذه الفترة"
            description="سجّل هنا ما يُدفع من حصيلة الموقف: ماء، كهرباء، موظف…"
          />
        )}
        {expenses.data && expenses.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {expenses.data.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">
                      {EXPENSE_CATEGORY_LABEL[e.category]}
                    </span>
                    <Badge
                      tone={
                        e.cost_center === 'parking'
                          ? 'blue'
                          : e.cost_center === 'wash'
                            ? 'sky'
                            : 'slate'
                      }
                    >
                      {COST_CENTER_LABEL[e.cost_center]}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(e.spent_at)} · {formatTime(e.spent_at)}
                    {e.notes && ` · ${e.notes}`}
                  </p>
                </div>

                <span className="num shrink-0 text-sm font-bold text-rose-700">
                  − {formatMoney(e.amount)} {CURRENCY}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void handleDeleteExpense(
                      e.id,
                      EXPENSE_CATEGORY_LABEL[e.category],
                    )
                  }
                  aria-label="حذف المصروف"
                  icon={<Trash2 className="h-4 w-4 text-rose-500" aria-hidden />}
                  className="shrink-0 px-2"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ServiceDialog
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        standalone
        onSaved={async () => {
          setServiceOpen(false)
          toast.success('تمت إضافة الخدمة')
          await reloadAll()
        }}
      />

      <ExpenseDialog
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onSaved={async () => {
          setExpenseOpen(false)
          toast.success('تمت إضافة المصروف')
          await reloadAll()
        }}
      />
    </div>
  )
}

/* ---------------------------- نافذة المصروف ---------------------------- */

function ExpenseDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [category, setCategory] = useState<ExpenseCategory>('water')
  const [costCenter, setCostCenter] = useState<CostCenter>('parking')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setCategory('water')
    setCostCenter('parking')
    setAmount('')
    setNotes('')
    setError(null)
  }

  const handleSave = async () => {
    setError(null)
    const value = Number(amount)
    if (amount.trim() === '' || Number.isNaN(value) || value <= 0) {
      setError('أدخل قيمة المصروف')
      return
    }

    setSaving(true)
    try {
      await addExpense({ category, amount: value, notes, costCenter })
      reset()
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
      title="إضافة مصروف"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleSave()}
            loading={saving}
            icon={<Receipt className="h-4 w-4" aria-hidden />}
          >
            حفظ المصروف
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="على أي نشاط؟"
          required
          hint="يحدّد على أي نشاط يُحمّل المصروف عند حساب الأرباح"
        >
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(COST_CENTER_LABEL) as CostCenter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCostCenter(value)}
                aria-pressed={costCenter === value}
                className={cx(
                  'h-14 rounded-xl border-2 px-1 text-xs font-bold leading-tight transition sm:text-sm',
                  costCenter === value
                    ? value === 'parking'
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : value === 'wash'
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-slate-500 bg-slate-500 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {COST_CENTER_LABEL[value]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="نوع المصروف" required>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategory(value)}
                  aria-pressed={category === value}
                  className={cx(
                    'h-12 rounded-xl border-2 px-1 text-xs font-bold transition sm:text-sm',
                    category === value
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {EXPENSE_CATEGORY_LABEL[value]}
                </button>
              ),
            )}
          </div>
        </Field>

        <Field label={`القيمة (${CURRENCY})`} htmlFor="exp-amount" required>
          <div className="flex flex-col gap-2">
            <Input
              id="exp-amount"
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
              {QUICK_EXPENSE.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAmount(formatMoney(value))}
                  className={cx(
                    'num rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                    Number(amount) === value
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {formatMoney(value)}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <Field label="البيان" htmlFor="exp-notes" hint="مثال: فاتورة كهرباء الشهر">
          <Textarea
            id="exp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
