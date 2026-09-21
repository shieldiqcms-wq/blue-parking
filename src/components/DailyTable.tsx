import { Card, CardTitle } from '@/components/ui'
import { cx } from '@/lib/cx'
import { formatDateNumeric, WEEKDAY_SHORT } from '@/lib/format'
import { CURRENCY } from '@/lib/env'

/**
 * جدول التوزيع اليومي لنشاط واحد.
 *
 * ملاحظتان في التنسيق:
 *   • التاريخ يستخدم `formatDateNumeric` لا `formatDate`، لأن التنسيق
 *     العربي يُدرج علامات اتجاه خفية تتفكك داخل خانة أرقام اتجاهها LTR
 *     فيظهر التاريخ مثل «182026/09/».
 *   • أعمدة الأرقام كلها `text-start` صراحةً مثل عناوينها، وبعرض ثابت،
 *     فلا تنزاح القيم عن رؤوسها.
 */

export interface DailyColumn<T> {
  header: string
  value: (row: T) => string | number
  /** نغمة اللون للقيمة */
  tone?: 'default' | 'positive' | 'negative' | 'sky' | 'violet' | 'muted'
  /** القيمة صفر تُعرض باهتة لتقليل الضجيج البصري */
  dimZero?: boolean
}

interface DailyTableProps<T extends { day: string }> {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  /** زر في رأس الجدول (مثل PDF) */
  action?: React.ReactNode
  rows: T[]
  columns: DailyColumn<T>[]
  /** صف الإجمالي */
  totals: Array<string | number>
  /** لتلوين صافي الإجمالي */
  totalTones?: Array<DailyColumn<T>['tone']>
  /** يُخفت صفوف الأيام التي لا حركة فيها */
  isEmptyRow?: (row: T) => boolean
}

function toneClass(
  tone: DailyColumn<unknown>['tone'],
  value: string | number,
  dimZero?: boolean,
): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  const isZero = !Number.isNaN(numeric) && numeric === 0

  if (dimZero && isZero) return 'text-slate-300'

  switch (tone) {
    case 'positive':
      return isZero ? 'text-slate-400' : 'font-semibold text-emerald-700'
    case 'negative':
      return isZero ? 'text-slate-400' : 'text-rose-600'
    case 'sky':
      return isZero ? 'text-slate-400' : 'text-sky-700'
    case 'violet':
      return isZero ? 'text-slate-400' : 'text-violet-700'
    case 'muted':
      return 'text-slate-500'
    default:
      return 'text-slate-700'
  }
}

export function DailyTable<T extends { day: string }>({
  title,
  subtitle,
  icon,
  action,
  rows,
  columns,
  totals,
  totalTones,
  isEmptyRow,
}: DailyTableProps<T>) {
  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-2 px-4 pt-4 sm:px-5">
        <CardTitle>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {icon}
            {title}
            {subtitle && (
              <span className="text-xs font-normal text-slate-400">
                {subtitle}
              </span>
            )}
          </span>
        </CardTitle>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead className="bg-sand-100 text-xs text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2.5 text-start font-semibold sm:px-4">
                اليوم
              </th>
              {columns.map((col) => (
                <th
                  key={col.header}
                  className="whitespace-nowrap px-3 py-2.5 text-start font-semibold sm:px-4"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const dim = isEmptyRow?.(row) ?? false
              const weekday = WEEKDAY_SHORT[new Date(row.day).getUTCDay()]

              return (
                <tr key={row.day} className={cx(dim && 'opacity-45')}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-start sm:px-4">
                    <span className="num font-medium text-slate-700">
                      {formatDateNumeric(row.day)}
                    </span>
                    <span className="ms-2 text-xs text-slate-400">
                      {weekday}
                    </span>
                  </td>

                  {columns.map((col) => {
                    const value = col.value(row)
                    return (
                      <td
                        key={col.header}
                        className="whitespace-nowrap px-3 py-2.5 text-start sm:px-4"
                      >
                        <span
                          className={cx(
                            'num',
                            toneClass(col.tone, value, col.dimZero),
                          )}
                        >
                          {value}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>

          <tfoot className="border-t-2 border-slate-200 bg-sand-100">
            <tr>
              <td className="whitespace-nowrap px-3 py-3 text-start text-sm font-bold text-slate-700 sm:px-4">
                الإجمالي
              </td>
              {totals.map((value, i) => (
                <td
                  key={columns[i]?.header ?? i}
                  className="whitespace-nowrap px-3 py-3 text-start sm:px-4"
                >
                  <span
                    className={cx(
                      'num font-bold',
                      toneClass(totalTones?.[i] ?? columns[i]?.tone, value),
                    )}
                  >
                    {value}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-4 pb-3 pt-2 text-xs text-slate-400 sm:px-5">
        كل المبالغ بالـ{CURRENCY}
      </p>
    </Card>
  )
}

