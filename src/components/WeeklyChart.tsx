import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Card, CardTitle } from '@/components/ui'
import { cx } from '@/lib/cx'
import { WEEKDAY_SHORT } from '@/lib/format'
import type { WeeklyComparison } from '@/types/database'

/**
 * مقارنة عدد السيارات الداخلة: هذا الأسبوع مقابل الأسبوع الماضي.
 *
 * مرسوم بـ SVG مباشرة بلا مكتبة رسوم — الرسم بسيط والمكتبات تضيف مئات
 * الكيلوبايتات إلى تطبيق يُفتح من الجوال.
 *
 * ملاحظتان في القراءة:
 *   • أيام الأسبوع التي لم تأتِ بعد لا تُرسم أصلاً (لا تُرسم كصفر) حتى
 *     لا يبدو وكأن الحركة انهارت.
 *   • المقارنة الإجمالية تقارن نفس عدد الأيام المنقضية من الأسبوعين،
 *     لا أسبوعاً كاملاً بأسبوع ناقص.
 */
export function WeeklyChart({ data }: { data: WeeklyComparison }) {
  const max = Math.max(
    1,
    ...data.days.map((d) => Math.max(d.this_count ?? 0, d.last_count)),
  )

  const thisTotal = data.this_week_total
  const lastSame = data.last_week_same_period
  const diff = thisTotal - lastSame
  const percent = lastSame > 0 ? Math.round((diff / lastSame) * 100) : null

  return (
    <Card>
      <CardTitle
        action={
          <div
            className={cx(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold',
              diff > 0
                ? 'bg-emerald-50 text-emerald-700'
                : diff < 0
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-slate-100 text-slate-600',
            )}
          >
            {diff > 0 ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            ) : diff < 0 ? (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="num">
              {diff > 0 ? '+' : ''}
              {diff}
            </span>
            {percent !== null && (
              <span className="num opacity-70">
                ({diff > 0 ? '+' : ''}
                {percent}%)
              </span>
            )}
          </div>
        }
      >
        السيارات الداخلة
      </CardTitle>

      {/* ------------------------------ المفتاح ------------------------------ */}
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-brand-600" aria-hidden />
          <span className="text-slate-600">هذا الأسبوع</span>
          <span className="num font-bold text-slate-800">{thisTotal}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-slate-300" aria-hidden />
          <span className="text-slate-600">الأسبوع الماضي</span>
          <span className="num font-bold text-slate-800">
            {data.last_week_total}
          </span>
        </span>
      </div>

      {/* ----------------------------- الأعمدة ----------------------------- */}
      <div className="flex items-end justify-between gap-1.5 sm:gap-3">
        {data.days.map((day) => {
          const thisValue = day.this_count
          const lastValue = day.last_count
          const isFuture = thisValue === null
          const isToday = day.this_date === data.today

          return (
            <div
              key={day.day_index}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              {/* العمودان */}
              <div
                className="flex h-28 w-full items-end justify-center gap-1"
                role="img"
                aria-label={`${WEEKDAY_SHORT[day.day_index]}: هذا الأسبوع ${thisValue ?? 'لم يأتِ بعد'}، الأسبوع الماضي ${lastValue}`}
              >
                {!isFuture && (
                  <div
                    className={cx(
                      'w-full max-w-[18px] rounded-t transition-all',
                      isToday ? 'bg-brand-700' : 'bg-brand-600',
                    )}
                    style={{
                      height: `${Math.max(3, (thisValue / max) * 100)}%`,
                    }}
                  />
                )}
                <div
                  className="w-full max-w-[18px] rounded-t bg-slate-300 transition-all"
                  style={{ height: `${Math.max(3, (lastValue / max) * 100)}%` }}
                />
              </div>

              {/* القيمة */}
              <span
                className={cx(
                  'num text-[11px] font-bold',
                  isFuture ? 'text-slate-300' : 'text-slate-700',
                )}
              >
                {isFuture ? '—' : thisValue}
              </span>

              {/* اليوم */}
              <span
                className={cx(
                  'truncate text-[10px] sm:text-xs',
                  isToday ? 'font-bold text-brand-700' : 'text-slate-500',
                )}
              >
                {WEEKDAY_SHORT[day.day_index]}
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-xs leading-6 text-slate-500">
        المقارنة أعلاه بين{' '}
        <span className="num font-semibold text-slate-700">{thisTotal}</span>{' '}
        سيارة هذا الأسبوع و{' '}
        <span className="num font-semibold text-slate-700">{lastSame}</span>{' '}
        في نفس عدد الأيام من الأسبوع الماضي — لا بالأسبوع كاملاً، حتى تكون
        المقارنة عادلة.
      </p>
    </Card>
  )
}
