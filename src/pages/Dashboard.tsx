import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarX,
  CarFront,
  Droplets,
  Receipt,
  Ticket,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { getDashboard } from '@/services/reports'
import { listRecentSessions } from '@/services/parking'
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeading,
  StatCard,
} from '@/components/ui'
import {
  formatDateTime,
  formatLongDate,
  formatMoney,
  PAYMENT_STATUS_LABEL,
} from '@/lib/format'
import { CURRENCY } from '@/lib/env'
import { displayPlate } from '@/lib/plate'

export function DashboardPage() {
  const stats = useAsync(getDashboard, [])
  const recent = useAsync(() => listRecentSessions(8), [])

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="الرئيسية"
        description={formatLongDate(new Date())}
      />

      {stats.data?.is_closed_day && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
          <CalendarX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          اليوم من أيام الإغلاق (لا يوجد دوام). يمكنك تغيير أيام الإغلاق من
          الإعدادات.
        </p>
      )}

      {/* ------------------------- الإجراءات السريعة ------------------------ */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/gate">
          <Button
            size="xl"
            block
            icon={<ArrowLeftRight className="h-6 w-6" aria-hidden />}
            className="h-24 flex-col gap-1.5 text-base sm:h-20 sm:flex-row sm:text-lg"
          >
            دخول / خروج
          </Button>
        </Link>
        <Link to="/cashbook">
          <Button
            size="xl"
            variant="secondary"
            block
            icon={<Wallet className="h-6 w-6" aria-hidden />}
            className="h-24 flex-col gap-1.5 text-base sm:h-20 sm:flex-row sm:text-lg"
          >
            الصندوق
          </Button>
        </Link>
      </div>

      {/* ------------------------------ الأرقام ----------------------------- */}
      {stats.loading && <LoadingBlock label="جارٍ تحميل الإحصائيات…" />}

      {stats.error && (
        <ErrorBlock message={stats.error} onRetry={() => void stats.reload()} />
      )}

      {stats.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="السيارات الموجودة حالياً"
              value={stats.data.cars_inside}
              icon={<CarFront className="h-4 w-4" aria-hidden />}
              tone="blue"
            />
            <StatCard
              label="صافي اليوم"
              value={formatMoney(stats.data.net_today)}
              unit={CURRENCY}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              tone={stats.data.net_today >= 0 ? 'green' : 'red'}
              hint={`الدخل ${formatMoney(stats.data.revenue_today)} − مصاريف ${formatMoney(stats.data.expenses_today)}`}
            />
            <StatCard
              label="اشتراكات سارية"
              value={stats.data.active_subscriptions}
              icon={<Ticket className="h-4 w-4" aria-hidden />}
              tone="violet"
              hint={
                stats.data.expiring_subscriptions > 0
                  ? `${stats.data.expiring_subscriptions} ينتهي خلال أسبوع`
                  : undefined
              }
            />
            <StatCard
              label="مبالغ غير مدفوعة"
              value={formatMoney(stats.data.unpaid_total)}
              unit={CURRENCY}
              icon={<AlertCircle className="h-4 w-4" aria-hidden />}
              tone={stats.data.unpaid_total > 0 ? 'red' : 'slate'}
              hint={
                stats.data.unpaid_count > 0
                  ? `${stats.data.unpaid_count} عملية`
                  : 'لا يوجد'
              }
            />
          </div>

          <Card>
            <CardTitle>حركة اليوم</CardTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <MiniStat label="دخول" value={stats.data.entries_today} />
              <MiniStat label="خروج" value={stats.data.exits_today} />
              <MiniStat label="زيارات عادية" value={stats.data.one_time_today} />
              <MiniStat label="زيارات اشتراك" value={stats.data.monthly_today} />
              <MiniStat
                label="غير مدفوع اليوم"
                value={formatMoney(stats.data.unpaid_today)}
                unit={CURRENCY}
              />
              <MiniStat
                label="خصومات اليوم"
                value={formatMoney(stats.data.discount_today)}
                unit={CURRENCY}
              />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="وقوف اليوم"
              value={formatMoney(stats.data.parking_today)}
              unit={CURRENCY}
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
              icon={<Receipt className="h-4 w-4" aria-hidden />}
              tone={stats.data.expenses_today > 0 ? 'red' : 'slate'}
              hint={`${stats.data.expenses_count_today} مصروف`}
            />
            <StatCard
              label="إيرادات الشهر"
              value={formatMoney(stats.data.revenue_month)}
              unit={CURRENCY}
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              tone="green"
              hint={`مصاريف ${formatMoney(stats.data.expenses_month)}`}
            />
          </div>
        </>
      )}

      {/* ----------------------------- آخر العمليات ---------------------------- */}
      <Card padded={false}>
        <div className="px-4 pt-4 sm:px-5">
          <CardTitle
            action={
              <Link
                to="/reports"
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                كل العمليات
              </Link>
            }
          >
            آخر العمليات
          </CardTitle>
        </div>

        {recent.loading && <LoadingBlock />}

        {recent.error && (
          <div className="px-4 pb-4">
            <ErrorBlock
              message={recent.error}
              onRetry={() => void recent.reload()}
            />
          </div>
        )}

        {recent.data && recent.data.length === 0 && (
          <EmptyState
            title="لا توجد عمليات بعد"
            description="ابدأ بتسجيل دخول أول سيارة"
            action={
              <Link to="/gate">
                <Button size="sm">دخول سيارة</Button>
              </Link>
            }
          />
        )}

        {recent.data && recent.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {recent.data.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="num truncate text-sm font-bold text-slate-800">
                    {displayPlate(item.plate_number)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.exit_time
                      ? `خروج ${formatDateTime(item.exit_time)}`
                      : `دخول ${formatDateTime(item.entry_time)}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {item.session_type === 'monthly' ? (
                    <Badge tone="violet">اشتراك</Badge>
                  ) : item.exit_time === null ? (
                    <Badge tone="blue">داخل الموقف</Badge>
                  ) : (
                    <>
                      <span className="num text-sm font-bold text-slate-700">
                        {formatMoney(item.amount_collected ?? item.amount_due)}
                      </span>
                      <Badge
                        tone={
                          item.payment_status === 'paid'
                            ? 'green'
                            : item.payment_status === 'unpaid'
                              ? 'red'
                              : 'slate'
                        }
                      >
                        {PAYMENT_STATUS_LABEL[item.payment_status]}
                      </Badge>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function MiniStat({
  label,
  value,
  unit,
}: {
  label: string
  value: number | string
  unit?: string
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="num text-lg font-bold text-slate-800">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </p>
    </div>
  )
}
