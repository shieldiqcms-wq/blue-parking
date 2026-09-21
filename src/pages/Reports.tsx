import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CarFront,
  Droplets,
  FileDown,
  FileSpreadsheet,
  Receipt,
  Wallet,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import { getReport, getWeeklyComparison } from '@/services/reports'
import { listSessions, settleSession } from '@/services/parking'
import { listExpenses, listServices } from '@/services/extras'
import { exportXlsx, type SheetColumn } from '@/lib/xlsx'
import { toArabicError } from '@/lib/errors'
import { WeeklyChart } from '@/components/WeeklyChart'
import { DailyTable } from '@/components/DailyTable'
import {
  addDays,
  ammanToday,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  startOfMonth,
  startOfWeek,
  toExcelDate,
  COST_CENTER_LABEL,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  SERVICE_TYPE_LABEL,
  SESSION_TYPE_LABEL,
  WEEKDAY_SHORT,
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
import type { ExpenseRow, ServiceRow, SessionDetail } from '@/types/database'

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
  const navigate = useNavigate()
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
  const weekly = useAsync(getWeeklyComparison, [])
  const services = useAsync(() => listServices({ from, to }), [from, to])
  const expenses = useAsync(() => listExpenses({ from, to }), [from, to])
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

  /** تقرير PDF واحد: جدول الموقف + السيارات التي دخلت كل يوم */
  const openPdf = () =>
    navigate(`/reports/print?from=${from}&to=${to}&auto=1`)

  const pdfButton = (
    <Button
      size="sm"
      variant="secondary"
      onClick={openPdf}
      icon={<FileDown className="h-4 w-4" aria-hidden />}
    >
      PDF
    </Button>
  )

  const handleSettle = async (row: SessionDetail) => {
    try {
      await settleSession(
        row.id,
        'cash',
        null,
        row.amount_due - row.prepaid_amount,
      )
      toast.success('تم تسجيل الدفع')
      await Promise.all([report.reload(), sessions.reload()])
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  /* ------------------------------ التصدير ------------------------------ */

  const sessionColumns: SheetColumn<SessionDetail>[] = [
    { header: 'التاريخ', value: (r) => toExcelDate(r.business_date), type: 'date', width: 13 },
    { header: 'رقم اللوحة', value: (r) => r.plate_number, width: 14 },
    { header: 'اسم المالك', value: (r) => r.owner_name ?? '', width: 16 },
    { header: 'رقم الهاتف', value: (r) => r.phone ?? '', width: 14 },
    { header: 'نوع الزيارة', value: (r) => SESSION_TYPE_LABEL[r.session_type], width: 13 },
    {
      header: `قيمة الاشتراك (${CURRENCY})`,
      value: (r) => r.subscription_amount ?? '',
      type: 'money',
      width: 16,
    },
    { header: 'وقت الدخول', value: (r) => toExcelDate(r.entry_time), type: 'datetime', width: 18 },
    {
      header: 'وقت الخروج',
      value: (r) => (r.exit_time ? toExcelDate(r.exit_time) : 'ما زالت داخل الموقف'),
      type: 'datetime',
      width: 18,
    },
    {
      header: 'المدة (دقيقة)',
      value: (r) => r.duration_minutes ?? '',
      type: 'number',
      width: 13,
    },
    { header: `المستحق (${CURRENCY})`, value: (r) => r.amount_due, type: 'money', width: 13 },
    {
      header: `مدفوع عند الدخول (${CURRENCY})`,
      value: (r) => r.prepaid_amount,
      type: 'money',
      width: 19,
    },
    {
      header: `المحصّل (${CURRENCY})`,
      value: (r) => r.amount_collected ?? '',
      type: 'money',
      width: 13,
    },
    {
      header: `الخصم (${CURRENCY})`,
      value: (r) => (r.adjustment < 0 ? -r.adjustment : 0),
      type: 'money',
      width: 12,
    },
    { header: 'سبب الخصم', value: (r) => r.discount_reason ?? '', width: 18 },
    {
      header: `خدمات مرتبطة (${CURRENCY})`,
      value: (r) => r.services_total,
      type: 'money',
      width: 18,
    },
    { header: 'حالة الدفع', value: (r) => PAYMENT_STATUS_LABEL[r.payment_status], width: 12 },
    {
      header: 'طريقة الدفع',
      value: (r) => (r.payment_method ? PAYMENT_METHOD_LABEL[r.payment_method] : ''),
      width: 12,
    },
    { header: 'ملاحظات', value: (r) => r.notes ?? '', width: 24 },
  ]

  const serviceColumns: SheetColumn<ServiceRow>[] = [
    { header: 'التاريخ', value: (r) => toExcelDate(r.business_date), type: 'date', width: 13 },
    { header: 'الوقت', value: (r) => toExcelDate(r.performed_at), type: 'datetime', width: 18 },
    { header: 'نوع الخدمة', value: (r) => SERVICE_TYPE_LABEL[r.service_type], width: 14 },
    { header: 'رقم اللوحة', value: (r) => r.plate_number ?? '', width: 14 },
    { header: 'اسم المالك', value: (r) => r.owner_name ?? '', width: 16 },
    { header: `القيمة (${CURRENCY})`, value: (r) => r.amount, type: 'money', width: 13 },
    { header: 'حالة الدفع', value: (r) => PAYMENT_STATUS_LABEL[r.payment_status], width: 12 },
    {
      header: 'طريقة الدفع',
      value: (r) => (r.payment_method ? PAYMENT_METHOD_LABEL[r.payment_method] : ''),
      width: 12,
    },
    { header: 'ملاحظات', value: (r) => r.notes ?? '', width: 24 },
  ]

  const expenseColumns: SheetColumn<ExpenseRow>[] = [
    { header: 'التاريخ', value: (r) => toExcelDate(r.business_date), type: 'date', width: 13 },
    { header: 'الوقت', value: (r) => toExcelDate(r.spent_at), type: 'datetime', width: 18 },
    { header: 'النوع', value: (r) => EXPENSE_CATEGORY_LABEL[r.category], width: 14 },
    { header: 'محمّل على', value: (r) => COST_CENTER_LABEL[r.cost_center], width: 14 },
    { header: `القيمة (${CURRENCY})`, value: (r) => r.amount, type: 'money', width: 13 },
    { header: 'البيان', value: (r) => r.notes ?? '', width: 28 },
  ]

  const exportAll = () => {
    const daily = report.data?.days ?? []
    const hasData =
      daily.length > 0 ||
      (sessions.data?.length ?? 0) > 0 ||
      (services.data?.length ?? 0) > 0 ||
      (expenses.data?.length ?? 0) > 0

    if (!hasData) {
      toast.warning('لا توجد بيانات للتصدير')
      return
    }

    try {
      exportXlsx(`blue-parking-${from}_${to}`, [
        {
          name: 'الموقف',
          rows: daily,
          columns: [
            { header: 'التاريخ', value: (d) => toExcelDate(d.day), type: 'date', width: 13 },
            {
              header: 'اليوم',
              value: (d) => WEEKDAY_SHORT[new Date(d.day).getUTCDay()],
              width: 11,
            },
            { header: 'سيارات داخلة', value: (d) => d.entries, type: 'number', width: 13 },
            { header: 'عمليات مكتملة', value: (d) => d.sessions, type: 'number', width: 14 },
            {
              header: `الزيارات (${CURRENCY})`,
              value: (d) => d.visits_revenue,
              type: 'money',
              width: 14,
            },
            {
              header: `الاشتراكات (${CURRENCY})`,
              value: (d) => d.subscription_revenue,
              type: 'money',
              width: 15,
            },
            {
              header: `الدخل (${CURRENCY})`,
              value: (d) => d.parking_revenue,
              type: 'money',
              width: 14,
            },
            {
              header: `المصاريف (${CURRENCY})`,
              value: (d) => d.expenses_parking,
              type: 'money',
              width: 15,
            },
            {
              header: `الصافي (${CURRENCY})`,
              value: (d) => d.parking_revenue - d.expenses_parking,
              type: 'money',
              width: 14,
            },
            {
              header: `غير المدفوع (${CURRENCY})`,
              value: (d) => d.unpaid_amount,
              type: 'money',
              width: 16,
            },
          ],
        },
        {
          name: 'غسيل السيارات',
          rows: daily,
          columns: [
            { header: 'التاريخ', value: (d) => toExcelDate(d.day), type: 'date', width: 13 },
            {
              header: 'اليوم',
              value: (d) => WEEKDAY_SHORT[new Date(d.day).getUTCDay()],
              width: 11,
            },
            { header: 'عدد الخدمات', value: (d) => d.services_count, type: 'number', width: 13 },
            {
              header: `الدخل (${CURRENCY})`,
              value: (d) => d.services_revenue,
              type: 'money',
              width: 14,
            },
            {
              header: `المصاريف (${CURRENCY})`,
              value: (d) => d.expenses_wash,
              type: 'money',
              width: 15,
            },
            {
              header: `الصافي (${CURRENCY})`,
              value: (d) => d.services_revenue - d.expenses_wash,
              type: 'money',
              width: 14,
            },
          ],
        },
        {
          name: 'الملخص العام',
          rows: daily,
          columns: [
            { header: 'التاريخ', value: (d) => toExcelDate(d.day), type: 'date', width: 13 },
            {
              header: 'اليوم',
              value: (d) => WEEKDAY_SHORT[new Date(d.day).getUTCDay()],
              width: 11,
            },
            {
              header: `دخل الموقف (${CURRENCY})`,
              value: (d) => d.parking_revenue,
              type: 'money',
              width: 16,
            },
            {
              header: `دخل الغسيل (${CURRENCY})`,
              value: (d) => d.services_revenue,
              type: 'money',
              width: 16,
            },
            {
              header: `مصاريف الموقف (${CURRENCY})`,
              value: (d) => d.expenses_parking,
              type: 'money',
              width: 18,
            },
            {
              header: `مصاريف الغسيل (${CURRENCY})`,
              value: (d) => d.expenses_wash,
              type: 'money',
              width: 18,
            },
            {
              header: `مصاريف مشتركة (${CURRENCY})`,
              value: (d) => d.expenses_shared,
              type: 'money',
              width: 18,
            },
            {
              header: `الصافي (${CURRENCY})`,
              value: (d) =>
                d.parking_revenue + d.services_revenue - d.expenses_total,
              type: 'money',
              width: 14,
            },
          ],
        },
        { name: 'العمليات', rows: sessions.data ?? [], columns: sessionColumns },
        { name: 'الخدمات', rows: services.data ?? [], columns: serviceColumns },
        { name: 'المصاريف', rows: expenses.data ?? [], columns: expenseColumns },
      ])
      toast.success('تم تصدير ملف Excel')
    } catch (error) {
      toast.error(toArabicError(error))
    }
  }

  const totals = report.data?.totals

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="التقارير"
        description={
          from === to
            ? `يوم ${formatDate(from)}`
            : `الفترة من ${formatDate(from)} إلى ${formatDate(to)}`
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={openPdf}
              icon={<FileDown className="h-4 w-4" aria-hidden />}
            >
              PDF
            </Button>
            <Button
              onClick={exportAll}
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            >
              Excel
            </Button>
          </div>
        }
      />

      {/* -------------------------- الرسم البياني -------------------------- */}
      {weekly.loading && <LoadingBlock label="جارٍ تحميل المقارنة…" />}
      {weekly.data && <WeeklyChart data={weekly.data} />}

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
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-sand-100 text-slate-600 hover:bg-sand-200',
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

      {report.loading && <LoadingBlock label="جارٍ إعداد التقرير…" />}
      {report.error && (
        <ErrorBlock message={report.error} onRetry={() => void report.reload()} />
      )}

      {totals && (
        <>
          {/* ---------------------------- الملخص ---------------------------- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="صافي الدخل"
              value={formatMoney(totals.net_revenue)}
              unit={CURRENCY}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              tone={totals.net_revenue >= 0 ? 'green' : 'red'}
              hint="الدخل − كل المصاريف"
            />
            <StatCard
              label="سيارات داخلة"
              value={totals.entries}
              icon={<CarFront className="h-4 w-4" aria-hidden />}
              tone="blue"
              hint={`${totals.sessions} عملية مكتملة`}
            />
            <StatCard
              label="إجمالي الدخل"
              value={formatMoney(totals.total_revenue)}
              unit={CURRENCY}
              tone="green"
              hint="وقوف + خدمات"
            />
            <StatCard
              label="المصاريف"
              value={formatMoney(totals.expenses_total)}
              unit={CURRENCY}
              icon={<Receipt className="h-4 w-4" aria-hidden />}
              tone={totals.expenses_total > 0 ? 'red' : 'slate'}
              hint={`${totals.expenses_count} مصروف`}
            />
          </div>

          {/* ------------------- نتيجة كل نشاط على حدة ------------------- */}
          <Card>
            <CardTitle>نتيجة كل نشاط</CardTitle>

            <div className="grid gap-3 sm:grid-cols-2">
              <ActivityCard
                title="الموقف"
                icon={<CarFront className="h-4 w-4" aria-hidden />}
                tone="blue"
                revenue={totals.parking_revenue}
                expenses={totals.expenses_parking}
                net={totals.parking_net}
                note={
                  totals.subscription_revenue > 0
                    ? `منه اشتراكات ${formatMoney(totals.subscription_revenue)}`
                    : undefined
                }
              />
              <ActivityCard
                title="غسيل السيارات"
                icon={<Droplets className="h-4 w-4" aria-hidden />}
                tone="sky"
                revenue={totals.services_revenue}
                expenses={totals.expenses_wash}
                net={totals.wash_net}
              />
            </div>

            {totals.expenses_shared > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-sand-100 px-3.5 py-3 text-sm">
                <span className="text-slate-600">
                  مصاريف مشتركة
                  <span className="mt-0.5 block text-xs text-slate-500">
                    غير محمّلة على نشاط بعينه — مطروحة من الصافي الإجمالي
                  </span>
                </span>
                <span className="num shrink-0 font-bold text-rose-600">
                  {formatMoney(totals.expenses_shared)} {CURRENCY}
                </span>
              </div>
            )}
          </Card>

          {/* ------------------------ أرقام إضافية ------------------------ */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="غير المدفوع"
              value={formatMoney(totals.unpaid_amount)}
              unit={CURRENCY}
              tone={totals.unpaid_amount > 0 ? 'red' : 'slate'}
              hint={`${totals.unpaid_count} عملية`}
            />
            <StatCard
              label="الخصومات"
              value={formatMoney(totals.discount_total)}
              unit={CURRENCY}
              tone={totals.discount_total > 0 ? 'amber' : 'slate'}
              hint={`من أصل ${formatMoney(totals.billed_total)}`}
            />
            <StatCard
              label="مدفوع عند الدخول"
              value={formatMoney(totals.prepaid_total)}
              unit={CURRENCY}
              tone="blue"
              hint="جزء من دخل الوقوف"
            />
            <StatCard
              label="زيارات الاشتراكات"
              value={totals.monthly}
              tone="violet"
              hint={`${totals.one_time} زيارة عادية`}
            />
          </div>

          {/* ---------------------- جدول الموقف ---------------------- */}
          <DailyTable
            title="الموقف"
            subtitle="حركة الوقوف يوماً بيوم — الدخل يشمل دفعات الاشتراكات"
            icon={<CarFront className="h-4 w-4 text-brand-600" aria-hidden />}
            action={pdfButton}
            rows={report.data?.days ?? []}
            isEmptyRow={(d) =>
              d.entries === 0 && d.parking_revenue === 0 && d.expenses_parking === 0
            }
            columns={[
              { header: 'سيارات', value: (d) => d.entries, dimZero: true },
              {
                header: 'اشتراكات',
                value: (d) => formatMoney(d.subscription_revenue),
                tone: 'violet',
              },
              { header: 'الدخل', value: (d) => formatMoney(d.parking_revenue) },
              {
                header: 'المصاريف',
                value: (d) => formatMoney(d.expenses_parking),
                tone: 'negative',
              },
              {
                header: 'الصافي',
                value: (d) =>
                  formatMoney(d.parking_revenue - d.expenses_parking),
                tone: 'positive',
              },
              {
                header: 'غير مدفوع',
                value: (d) => formatMoney(d.unpaid_amount),
                tone: 'negative',
              },
            ]}
            totals={[
              totals.entries,
              formatMoney(totals.subscription_revenue),
              formatMoney(totals.parking_revenue),
              formatMoney(totals.expenses_parking),
              formatMoney(totals.parking_net),
              formatMoney(totals.unpaid_amount),
            ]}
            totalTones={[
              'default',
              'violet',
              'default',
              'negative',
              totals.parking_net >= 0 ? 'positive' : 'negative',
              'negative',
            ]}
          />

          {/* -------------------- جدول غسيل السيارات -------------------- */}
          <DailyTable
            title="غسيل السيارات"
            subtitle="الخدمات يوماً بيوم"
            icon={<Droplets className="h-4 w-4 text-sky-600" aria-hidden />}
            rows={report.data?.days ?? []}
            isEmptyRow={(d) =>
              d.services_count === 0 && d.expenses_wash === 0
            }
            columns={[
              { header: 'خدمات', value: (d) => d.services_count, dimZero: true },
              {
                header: 'الدخل',
                value: (d) => formatMoney(d.services_revenue),
                tone: 'sky',
              },
              {
                header: 'المصاريف',
                value: (d) => formatMoney(d.expenses_wash),
                tone: 'negative',
              },
              {
                header: 'الصافي',
                value: (d) => formatMoney(d.services_revenue - d.expenses_wash),
                tone: 'positive',
              },
            ]}
            totals={[
              totals.services_count,
              formatMoney(totals.services_revenue),
              formatMoney(totals.expenses_wash),
              formatMoney(totals.wash_net),
            ]}
            totalTones={[
              'default',
              'sky',
              'negative',
              totals.wash_net >= 0 ? 'positive' : 'negative',
            ]}
          />

          {/* ------------------ المصاريف المشتركة ------------------ */}
          {totals.expenses_shared > 0 && (
            <DailyTable
              title="مصاريف مشتركة"
              subtitle="غير محمّلة على نشاط بعينه"
              icon={<Receipt className="h-4 w-4 text-slate-500" aria-hidden />}
              rows={(report.data?.days ?? []).filter(
                (d) => d.expenses_shared > 0,
              )}
              columns={[
                {
                  header: 'المبلغ',
                  value: (d) => formatMoney(d.expenses_shared),
                  tone: 'negative',
                },
              ]}
              totals={[formatMoney(totals.expenses_shared)]}
              totalTones={['negative']}
            />
          )}
        </>
      )}

      {/* ----------------------------- العمليات ----------------------------- */}
      <Card padded={false}>
        <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>تفاصيل العمليات</CardTitle>
            {pdfButton}
          </div>

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

                  <div className="flex flex-wrap items-center gap-2">
                    {row.session_type === 'monthly' && (
                      <Badge tone="violet">
                        مشتركة
                        {row.subscription_amount !== null &&
                          ` · ${formatMoney(row.subscription_amount)}`}
                      </Badge>
                    )}
                    {row.session_type === 'monthly' &&
                      row.subscription_balance !== null &&
                      Number(row.subscription_balance) > 0 && (
                        <Badge tone="amber">
                          اشتراك غير مدفوع {formatMoney(row.subscription_balance)}
                        </Badge>
                      )}
                    {row.exit_time === null ? (
                      <Badge tone="blue">داخل الموقف</Badge>
                    ) : (
                      <>
                        <span className="num text-sm font-bold text-slate-800">
                          {formatMoney(row.amount_collected ?? row.amount_due)}{' '}
                          {CURRENCY}
                        </span>
                        {row.adjustment < 0 && (
                          <Badge tone="amber">
                            خصم {formatMoney(-row.adjustment)}
                          </Badge>
                        )}
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

/* ---------------------------- بطاقة نشاط ---------------------------- */

function ActivityCard({
  title,
  icon,
  tone,
  revenue,
  expenses,
  net,
  note,
}: {
  title: string
  icon: React.ReactNode
  tone: 'blue' | 'sky'
  revenue: number
  expenses: number
  net: number
  note?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 p-4">
      <p
        className={cx(
          'mb-3 flex items-center gap-2 text-sm font-bold',
          tone === 'blue' ? 'text-brand-800' : 'text-sky-800',
        )}
      >
        <span
          className={cx(
            'rounded-lg p-1.5',
            tone === 'blue' ? 'bg-brand-50' : 'bg-sky-50',
          )}
        >
          {icon}
        </span>
        {title}
      </p>

      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">
            الدخل
            {note && (
              <span className="ms-1.5 text-xs text-violet-700">({note})</span>
            )}
          </dt>
          <dd className="num font-semibold text-slate-800">
            {formatMoney(revenue)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-600">المصاريف</dt>
          <dd className="num font-semibold text-rose-600">
            − {formatMoney(expenses)}
          </dd>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-2">
          <dt className="font-bold text-slate-700">الصافي</dt>
          <dd
            className={cx(
              'num text-base font-bold',
              net >= 0 ? 'text-emerald-700' : 'text-rose-600',
            )}
          >
            {formatMoney(net)} {CURRENCY}
          </dd>
        </div>
      </dl>
    </div>
  )
}
