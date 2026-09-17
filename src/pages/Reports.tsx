import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Wallet } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import { getReport } from '@/services/reports'
import { listSessions, settleSession } from '@/services/parking'
import { exportCsv, type CsvColumn } from '@/lib/csv'
import { toArabicError } from '@/lib/errors'
import {
  addDays,
  ammanToday,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  startOfMonth,
  startOfWeek,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  SESSION_TYPE_LABEL,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
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
  PageHeading,
  Select,
  StatCard,
} from '@/components/ui'
import { cx } from '@/lib/cx'
import type { SessionDetail } from '@/types/database'

type Preset = 'today' | 'week' | 'month' | 'custom'

const PRESETS: Array<[Preset, string]> = [
  ['today', 'اليوم'],
  ['week', 'هذا الأسبوع'],
  ['month', 'هذا الشهر'],
  ['custom', 'فترة مخصصة'],
]

function rangeFor(preset: Preset, from: string, to: string): [string, string] {
  const today = ammanToday()
  switch (preset) {
    case 'today':
      return [today, today]
    case 'week':
      return [startOfWeek(today), today]
    case 'month':
      return [startOfMonth(today), today]
    case 'custom':
      return [from, to]
  }
}

export function ReportsPage() {
  const toast = useToast()
  const today = ammanToday()

  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(addDays(today, -30))
  const [customTo, setCustomTo] = useState(today)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [from, to] = useMemo(
    () => rangeFor(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  const report = useAsync(() => getReport(from, to), [from, to])
  const sessions = useAsync(
    () =>
      listSessions({
        from,
        to,
        paymentStatus: statusFilter || undefined,
        sessionType: typeFilter || undefined,
      }),
    [from, to, statusFilter, typeFilter],
  )

  const handleSettle = async (row: SessionDetail) => {
    try {
      await settleSession(row.id, 'cash')
      toast.success('تم تسجيل الدفع')
      await Promise.all([report.reload(), sessions.reload()])
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const exportSessions = () => {
    if (!sessions.data || sessions.data.length === 0) {
      toast.warning('لا توجد بيانات للتصدير')
      return
    }

    const columns: CsvColumn<SessionDetail>[] = [
      { header: 'رقم اللوحة', value: (r) => r.plate_number },
      { header: 'اسم المالك', value: (r) => r.owner_name ?? '' },
      { header: 'رقم الهاتف', value: (r) => r.phone ?? '' },
      { header: 'نوع الزيارة', value: (r) => SESSION_TYPE_LABEL[r.session_type] },
      { header: 'وقت الدخول', value: (r) => formatDateTime(r.entry_time) },
      {
        header: 'وقت الخروج',
        value: (r) => (r.exit_time ? formatDateTime(r.exit_time) : 'ما زالت داخل الموقف'),
      },
      {
        header: 'المدة',
        value: (r) => (r.duration_minutes === null ? '' : formatDuration(r.duration_minutes)),
      },
      { header: `المبلغ (${CURRENCY})`, value: (r) => formatMoney(r.amount_due) },
      {
        header: 'حالة الدفع',
        value: (r) => PAYMENT_STATUS_LABEL[r.payment_status],
      },
      {
        header: 'طريقة الدفع',
        value: (r) =>
          r.payment_method ? PAYMENT_METHOD_LABEL[r.payment_method] : '',
      },
      { header: 'التاريخ', value: (r) => r.business_date },
      { header: 'ملاحظات', value: (r) => r.notes ?? '' },
    ]

    exportCsv(`blue-parking-${from}_${to}.csv`, sessions.data, columns)
    toast.success('تم تصدير الملف')
  }

  const exportDaily = () => {
    if (!report.data || report.data.days.length === 0) {
      toast.warning('لا توجد بيانات للتصدير')
      return
    }

    exportCsv(`blue-parking-daily-${from}_${to}.csv`, report.data.days, [
      { header: 'التاريخ', value: (d) => d.day },
      { header: 'عدد العمليات', value: (d) => d.sessions },
      { header: 'زيارات عادية', value: (d) => d.one_time },
      { header: 'زيارات اشتراك', value: (d) => d.monthly },
      { header: `المحصّل (${CURRENCY})`, value: (d) => formatMoney(d.revenue_paid) },
      {
        header: `غير المدفوع (${CURRENCY})`,
        value: (d) => formatMoney(d.unpaid_amount),
      },
    ])
    toast.success('تم تصدير الملف')
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="التقارير"
        description={`من ${formatDate(from)} إلى ${formatDate(to)}`}
      />

      {/* -------------------------- اختيار الفترة -------------------------- */}
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PRESETS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreset(value)}
                className={cx(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition',
                  preset === value
                    ? 'bg-brand-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="من تاريخ" htmlFor="from">
                <Input
                  id="from"
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </Field>
              <Field label="إلى تاريخ" htmlFor="to">
                <Input
                  id="to"
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </Card>

      {/* ------------------------------ الملخص ------------------------------ */}
      {report.loading && <LoadingBlock label="جارٍ إعداد التقرير…" />}
      {report.error && (
        <ErrorBlock message={report.error} onRetry={() => void report.reload()} />
      )}

      {report.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="عدد العمليات"
              value={report.data.totals.sessions}
              tone="blue"
            />
            <StatCard
              label="المحصّل"
              value={formatMoney(report.data.totals.revenue_paid)}
              unit={CURRENCY}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              tone="green"
            />
            <StatCard
              label="غير المدفوع"
              value={formatMoney(report.data.totals.unpaid_amount)}
              unit={CURRENCY}
              tone={report.data.totals.unpaid_amount > 0 ? 'red' : 'slate'}
              hint={`${report.data.totals.unpaid_count} عملية`}
            />
            <StatCard
              label="زيارات الاشتراكات"
              value={report.data.totals.monthly}
              tone="violet"
              hint={`${report.data.totals.one_time} زيارة عادية`}
            />
          </div>

          {/* ------------------------ التوزيع اليومي ------------------------ */}
          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5">
              <CardTitle
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={exportDaily}
                    icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
                  >
                    تصدير
                  </Button>
                }
              >
                التوزيع اليومي
              </CardTitle>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold">اليوم</th>
                    <th className="px-4 py-2.5 text-start font-semibold">العمليات</th>
                    <th className="px-4 py-2.5 text-start font-semibold">عادية</th>
                    <th className="px-4 py-2.5 text-start font-semibold">اشتراك</th>
                    <th className="px-4 py-2.5 text-start font-semibold">المحصّل</th>
                    <th className="px-4 py-2.5 text-start font-semibold">غير مدفوع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.data.days.map((day) => (
                    <tr
                      key={day.day}
                      className={cx(day.sessions === 0 && 'text-slate-400')}
                    >
                      <td className="num whitespace-nowrap px-4 py-2.5 font-medium">
                        {formatDate(day.day)}
                      </td>
                      <td className="num px-4 py-2.5">{day.sessions}</td>
                      <td className="num px-4 py-2.5">{day.one_time}</td>
                      <td className="num px-4 py-2.5">{day.monthly}</td>
                      <td className="num px-4 py-2.5 font-semibold text-emerald-700">
                        {formatMoney(day.revenue_paid)}
                      </td>
                      <td
                        className={cx(
                          'num px-4 py-2.5',
                          day.unpaid_amount > 0 && 'font-semibold text-rose-600',
                        )}
                      >
                        {formatMoney(day.unpaid_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold">
                  <tr>
                    <td className="px-4 py-2.5">الإجمالي</td>
                    <td className="num px-4 py-2.5">
                      {report.data.totals.sessions}
                    </td>
                    <td className="num px-4 py-2.5">
                      {report.data.totals.one_time}
                    </td>
                    <td className="num px-4 py-2.5">
                      {report.data.totals.monthly}
                    </td>
                    <td className="num px-4 py-2.5 text-emerald-700">
                      {formatMoney(report.data.totals.revenue_paid)}
                    </td>
                    <td className="num px-4 py-2.5 text-rose-600">
                      {formatMoney(report.data.totals.unpaid_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ----------------------------- العمليات ----------------------------- */}
      <Card padded={false}>
        <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5">
          <CardTitle
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={exportSessions}
                icon={<Download className="h-4 w-4" aria-hidden />}
              >
                تصدير CSV
              </Button>
            }
          >
            تفاصيل العمليات
          </CardTitle>

          <div className="grid gap-3 pb-3 sm:grid-cols-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="حالة الدفع"
            >
              <option value="">كل حالات الدفع</option>
              <option value="paid">مدفوع</option>
              <option value="unpaid">غير مدفوع</option>
              <option value="waived">معفى</option>
              <option value="not_required">غير مطلوب</option>
            </Select>

            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="نوع الزيارة"
            >
              <option value="">كل الأنواع</option>
              <option value="one_time">زيارة عادية</option>
              <option value="monthly">اشتراك شهري</option>
            </Select>
          </div>
        </div>

        {sessions.loading && <LoadingBlock />}
        {sessions.error && (
          <div className="px-4 pb-4">
            <ErrorBlock
              message={sessions.error}
              onRetry={() => void sessions.reload()}
            />
          </div>
        )}

        {sessions.data && sessions.data.length === 0 && (
          <EmptyState
            title="لا توجد عمليات في هذه الفترة"
            description="جرّب فترة أخرى أو غيّر الفلاتر"
          />
        )}

        {sessions.data && sessions.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {sessions.data.map((row) => (
              <li key={row.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-sm font-bold text-slate-900">
                      {displayPlate(row.plate_number)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(row.entry_time)}
                      {row.exit_time && ` ← ${formatDateTime(row.exit_time)}`}
                    </p>
                    {row.duration_minutes !== null && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatDuration(row.duration_minutes)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {row.session_type === 'monthly' && (
                      <Badge tone="violet">اشتراك</Badge>
                    )}
                    {row.exit_time === null ? (
                      <Badge tone="blue">داخل الموقف</Badge>
                    ) : (
                      <>
                        <span className="num text-sm font-bold text-slate-800">
                          {formatMoney(row.amount_due)} {CURRENCY}
                        </span>
                        <Badge
                          tone={
                            row.payment_status === 'paid'
                              ? 'green'
                              : row.payment_status === 'unpaid'
                                ? 'red'
                                : 'slate'
                          }
                        >
                          {PAYMENT_STATUS_LABEL[row.payment_status]}
                        </Badge>
                      </>
                    )}
                    {row.payment_status === 'unpaid' && row.exit_time && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => void handleSettle(row)}
                      >
                        تحصيل
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
