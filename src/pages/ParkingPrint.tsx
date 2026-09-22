import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, FileDown } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { getReport } from '@/services/reports'
import {
  listPaymentsForSessions,
  listPaymentsInRange,
  listSessions,
} from '@/services/parking'
import { listSubscriptionPayments } from '@/services/subscriptions'
import { getAppSettings } from '@/services/settings'
import {
  ammanDateOf,
  ammanToday,
  formatDateNumeric,
  formatDuration,
  formatMoney,
  formatTime,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  WEEKDAY_SHORT,
} from '@/lib/format'
import {
  activeMethods,
  addToMethods,
  EMPTY_METHODS,
  mergeMethods,
  methodsTotal,
  sumByMethod,
  type MethodTotals,
} from '@/lib/paymentMethods'
import { displayPlate } from '@/lib/plate'
import { APP_NAME, CURRENCY } from '@/lib/env'
import { Button, ErrorBlock, LoadingBlock } from '@/components/ui'
import type {
  ReportDay,
  SessionDetail,
  SubscriptionPaymentDetail,
} from '@/types/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function weekday(isoDate: string): string {
  return WEEKDAY_SHORT[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]
}

/**
 * تقرير الموقف للطباعة / الحفظ PDF — ملف واحد يضم:
 *   1) ملخص الفترة — ومنه كم قُبض نقداً وكم تحويلاً
 *   2) جدول الموقف يوماً بيوم (الزيارات + الاشتراكات، نقداً / تحويل)
 *   3) لكل يوم: السيارات التي دخلت فيه مع طريقة دفع كل سيارة، والمشتركة
 *      معلَّمة بقيمة اشتراكها، ثم دفعات الاشتراكات المقبوضة في ذلك اليوم.
 *
 * طريقة الدفع تُحسب من سجل الدفعات نفسه (بما فيه قيود التصحيح)، لا من
 * حقل واحد على العملية — فالسيارة التي دفعت نقداً عند الدخول وتحويلاً عند
 * الخروج تظهر بالطريقتين.
 *
 * نستخدم طباعة المتصفح (حفظ كـ PDF) بدل مكتبة PDF: المتصفح يرسم العربية
 * ويوصل الحروف بشكل صحيح، ويقسّم الصفحات مع تكرار رؤوس الجداول.
 */
export function ParkingPrintPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const today = ammanToday()
  const fromParam = params.get('from') ?? ''
  const toParam = params.get('to') ?? ''
  const from = ISO_DATE.test(fromParam) ? fromParam : today
  const to = ISO_DATE.test(toParam) ? toParam : from
  const auto = params.get('auto') === '1'

  const data = useAsync(async () => {
    const [report, sessions, subPayments, rangePayments, settings] = await Promise.all([
      getReport(from, to),
      listSessions({ from, to, dateField: 'entry_date', limit: 5000 }),
      listSubscriptionPayments(from, to),
      listPaymentsInRange(from, to),
      getAppSettings().catch(() => ({}) as Record<string, unknown>),
    ])
    const sessionPayments = await listPaymentsForSessions(sessions.map((s) => s.id))

    const name = settings.parking_name
    return {
      report,
      sessions,
      subPayments,
      rangePayments,
      sessionPayments,
      parkingName: typeof name === 'string' && name.trim() ? name : 'موقف أبو حمدان',
    }
  }, [from, to])

  // اسم الملف المقترح عند الحفظ PDF يُؤخذ من عنوان الصفحة
  useEffect(() => {
    const previous = document.title
    document.title =
      from === to ? `تقرير-الموقف-${from}` : `تقرير-الموقف-${from}_${to}`
    return () => {
      document.title = previous
    }
  }, [from, to])

  // فتح نافذة الحفظ تلقائياً مرة واحدة بعد التحميل
  const printed = useRef(false)
  useEffect(() => {
    if (!auto || !data.data || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(timer)
  }, [auto, data.data])

  /* ------------------------- التجميع حسب طريقة الدفع ------------------------- */
  const methods = useMemo(() => {
    const byDay = new Map<string, MethodTotals>()
    const bump = (day: string, amount: number | string, method: string | null) =>
      byDay.set(day, addToMethods(byDay.get(day) ?? EMPTY_METHODS, amount, method))

    // دخل الموقف = دفعات الزيارات + دفعات الاشتراكات، بتاريخ القبض
    for (const p of data.data?.rangePayments ?? []) {
      bump(ammanDateOf(p.paid_at), p.amount, p.payment_method)
    }
    for (const p of data.data?.subPayments ?? []) {
      bump(p.business_date, p.amount, p.payment_method)
    }

    const total = [...byDay.values()].reduce(mergeMethods, EMPTY_METHODS)

    const bySession = new Map<string, MethodTotals>()
    for (const p of data.data?.sessionPayments ?? []) {
      bySession.set(
        p.session_id,
        addToMethods(bySession.get(p.session_id) ?? EMPTY_METHODS, p.amount, p.payment_method),
      )
    }

    return { byDay, total, bySession }
  }, [data.data])

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      { sessions: SessionDetail[]; payments: SubscriptionPaymentDetail[] }
    >()
    const bucket = (day: string) => {
      let entry = map.get(day)
      if (!entry) {
        entry = { sessions: [], payments: [] }
        map.set(day, entry)
      }
      return entry
    }
    for (const s of data.data?.sessions ?? []) bucket(s.entry_date).sessions.push(s)
    for (const p of data.data?.subPayments ?? []) bucket(p.business_date).payments.push(p)
    for (const entry of map.values()) {
      entry.sessions.sort((a, b) => a.entry_time.localeCompare(b.entry_time))
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data.data])

  const report = data.data?.report
  const totals = report?.totals
  const days = report?.days ?? []
  // عمود «أخرى» يظهر فقط إن وُجد مبلغ بها
  const showOther = Math.abs(methods.total.other) >= 0.005

  return (
    <div className="print-page min-h-screen bg-sand-100 print:bg-white">
      {/* ------------------------- شريط الأدوات (لا يُطبع) ------------------------- */}
      <div className="no-print sticky top-0 z-10 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/reports')}
            icon={<ArrowRight className="h-4 w-4" aria-hidden />}
          >
            رجوع
          </Button>
          <Button
            onClick={() => window.print()}
            disabled={!data.data}
            icon={<FileDown className="h-4 w-4" aria-hidden />}
          >
            حفظ PDF
          </Button>
        </div>
        <p className="mx-auto max-w-4xl px-4 pb-2 text-xs text-slate-500">
          في نافذة الطباعة اختر «حفظ بتنسيق PDF» بدل الطابعة، ثم احفظ الملف.
        </p>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-4 print:max-w-none print:p-0">
        {data.loading && <LoadingBlock label="جارٍ إعداد التقرير…" />}
        {data.error && (
          <ErrorBlock message={data.error} onRetry={() => void data.reload()} />
        )}

        {data.data && totals && (
          <article className="print-sheet flex flex-col gap-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200 sm:p-6 print:rounded-none print:p-0 print:shadow-none print:ring-0">
            {/* ------------------------------ الترويسة ------------------------------ */}
            <header className="flex items-start justify-between gap-3 border-b-2 border-brand-600 pb-3">
              <div>
                <p className="text-lg font-bold text-brand-700">
                  {data.data.parkingName}
                </p>
                <h1 className="mt-0.5 text-xl font-bold text-slate-900">
                  تقرير الموقف
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {from === to ? (
                    <>
                      يوم {weekday(from)}{' '}
                      <span className="num font-semibold">{formatDateNumeric(from)}</span>
                    </>
                  ) : (
                    <>
                      من{' '}
                      <span className="num font-semibold">{formatDateNumeric(from)}</span>{' '}
                      إلى{' '}
                      <span className="num font-semibold">{formatDateNumeric(to)}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="text-end text-[11px] text-slate-500">
                <p className="font-bold text-slate-700">{APP_NAME}</p>
                <p className="mt-0.5">
                  أُعدّ في {formatDateNumeric(new Date())} — {formatTime(new Date())}
                </p>
              </div>
            </header>

            {/* ------------------------------ الملخص ------------------------------ */}
            <section className="grid grid-cols-3 gap-2 sm:grid-cols-6 print:grid-cols-6">
              <SummaryBox label="سيارات داخلة" value={String(totals.entries)} />
              <SummaryBox label="دخل الزيارات" value={formatMoney(totals.visits_revenue)} />
              <SummaryBox
                label="دخل الاشتراكات"
                value={formatMoney(totals.subscription_revenue)}
                tone="violet"
              />
              <SummaryBox
                label="إجمالي الموقف"
                value={formatMoney(totals.parking_revenue)}
                tone="blue"
              />
              <SummaryBox
                label="مصاريف الموقف"
                value={formatMoney(totals.expenses_parking)}
                tone="red"
              />
              <SummaryBox
                label="صافي الموقف"
                value={formatMoney(totals.parking_net)}
                tone={totals.parking_net >= 0 ? 'green' : 'red'}
              />
            </section>

            {/* ------------------------- التحصيل حسب طريقة الدفع ------------------------- */}
            <section className="rounded-xl border-2 border-slate-200 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">
                التحصيل حسب طريقة الدفع
                <span className="ms-2 text-[11px] font-normal text-slate-500">
                  زيارات واشتراكات معاً — المجموع = إجمالي الموقف
                </span>
              </p>
              <div className={`grid gap-2 ${showOther ? 'grid-cols-4' : 'grid-cols-3'}`}>
                <SummaryBox label="نقدي (كاش)" value={formatMoney(methods.total.cash)} tone="green" />
                <SummaryBox label="تحويل" value={formatMoney(methods.total.transfer)} tone="sky" />
                {showOther && (
                  <SummaryBox label="أخرى" value={formatMoney(methods.total.other)} tone="amber" />
                )}
                <SummaryBox
                  label="المجموع"
                  value={formatMoney(methodsTotal(methods.total))}
                  tone="blue"
                />
              </div>
            </section>

            <p className="-mt-3 text-[11px] text-slate-500">
              المبالغ بالدينار الأردني ({CURRENCY}). الدخل محسوب بتاريخ قبض النقد، ودفعات
              الاشتراكات داخلة في دخل يوم قبضها وشهره. الغسيل غير مشمول في هذا التقرير.
            </p>

            {/* --------------------------- جدول الموقف اليومي --------------------------- */}
            <section>
              <h2 className="mb-2 text-base font-bold text-slate-900">جدول الموقف</h2>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="print-table w-full min-w-[44rem] text-xs print:min-w-0">
                  <thead>
                    <tr>
                      <th>اليوم</th>
                      <th>سيارات</th>
                      <th>زيارات</th>
                      <th>اشتراكات</th>
                      <th>الدخل</th>
                      <th className="print-th-green">منه نقدي</th>
                      <th className="print-th-sky">منه تحويل</th>
                      {showOther && <th>منه أخرى</th>}
                      <th>المصاريف</th>
                      <th>الصافي</th>
                      <th>غير مدفوع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d: ReportDay) => {
                      const m = methods.byDay.get(d.day) ?? EMPTY_METHODS
                      const empty =
                        d.entries === 0 &&
                        d.parking_revenue === 0 &&
                        d.expenses_parking === 0
                      return (
                        <tr key={d.day} className={empty ? 'text-slate-400' : undefined}>
                          <td>
                            <span className="num">{formatDateNumeric(d.day)}</span>
                            <span className="ms-1.5 text-[10px] text-slate-500">
                              {weekday(d.day)}
                            </span>
                          </td>
                          <td><span className="num">{d.entries}</span></td>
                          <td><span className="num">{formatMoney(d.visits_revenue)}</span></td>
                          <td><span className="num">{formatMoney(d.subscription_revenue)}</span></td>
                          <td className="font-semibold">
                            <span className="num">{formatMoney(d.parking_revenue)}</span>
                          </td>
                          <td><span className="num">{formatMoney(m.cash)}</span></td>
                          <td><span className="num">{formatMoney(m.transfer)}</span></td>
                          {showOther && (
                            <td><span className="num">{formatMoney(m.other)}</span></td>
                          )}
                          <td><span className="num">{formatMoney(d.expenses_parking)}</span></td>
                          <td className="font-semibold">
                            <span className="num">
                              {formatMoney(d.parking_revenue - d.expenses_parking)}
                            </span>
                          </td>
                          <td><span className="num">{formatMoney(d.unpaid_amount)}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>الإجمالي</td>
                      <td><span className="num">{totals.entries}</span></td>
                      <td><span className="num">{formatMoney(totals.visits_revenue)}</span></td>
                      <td><span className="num">{formatMoney(totals.subscription_revenue)}</span></td>
                      <td><span className="num">{formatMoney(totals.parking_revenue)}</span></td>
                      <td><span className="num">{formatMoney(methods.total.cash)}</span></td>
                      <td><span className="num">{formatMoney(methods.total.transfer)}</span></td>
                      {showOther && (
                        <td><span className="num">{formatMoney(methods.total.other)}</span></td>
                      )}
                      <td><span className="num">{formatMoney(totals.expenses_parking)}</span></td>
                      <td><span className="num">{formatMoney(totals.parking_net)}</span></td>
                      <td><span className="num">{formatMoney(totals.unpaid_amount)}</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                «منه نقدي» و«منه تحويل» تقسيم لعمود «الدخل»: زيارات + اشتراكات = الدخل =
                نقدي + تحويل.
              </p>
            </section>

            {/* ------------------------ السيارات يوماً بيوم ------------------------ */}
            <section className="flex flex-col gap-5">
              <h2 className="text-base font-bold text-slate-900">
                السيارات التي دخلت — يوماً بيوم
              </h2>

              {byDay.length === 0 && (
                <p className="rounded-xl bg-sand-50 px-3 py-4 text-center text-sm text-slate-500">
                  لا توجد سيارات ولا دفعات اشتراكات في هذه الفترة
                </p>
              )}

              {byDay.map(([day, entry]) => (
                <DaySection
                  key={day}
                  day={day}
                  sessions={entry.sessions}
                  payments={entry.payments}
                  dayMethods={methods.byDay.get(day) ?? EMPTY_METHODS}
                  sessionMethods={methods.bySession}
                />
              ))}
            </section>
          </article>
        )}
      </div>
    </div>
  )
}

/* ------------------------------ قسم يوم واحد ------------------------------ */

function DaySection({
  day,
  sessions,
  payments,
  dayMethods,
  sessionMethods,
}: {
  day: string
  sessions: SessionDetail[]
  payments: SubscriptionPaymentDetail[]
  dayMethods: MethodTotals
  sessionMethods: Map<string, MethodTotals>
}) {
  const collected = sessions.reduce(
    (sum, s) => sum + methodsTotal(sessionMethods.get(s.id) ?? EMPTY_METHODS),
    0,
  )
  const subsTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const subscribed = sessions.filter((s) => s.session_type === 'monthly').length

  return (
    <div className="print-day flex flex-col gap-2">
      <div className="flex flex-col gap-1 rounded-lg bg-brand-50 px-3 py-2 print:bg-brand-50">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-bold text-brand-900">
            {weekday(day)} <span className="num">{formatDateNumeric(day)}</span>
          </h3>
          <p className="text-xs text-brand-900">
            <span className="num font-bold">{sessions.length}</span> سيارة
            {subscribed > 0 && (
              <>
                {' '}
                (منها <span className="num font-bold">{subscribed}</span> مشتركة)
              </>
            )}
            {' · '}محصّل من الزيارات{' '}
            <span className="num font-bold">{formatMoney(collected)}</span>
            {subsTotal > 0 && (
              <>
                {' · '}اشتراكات <span className="num font-bold">{formatMoney(subsTotal)}</span>
              </>
            )}
          </p>
        </div>
        <p className="text-xs text-brand-900">
          المقبوض في هذا اليوم:{' '}
          <span className="print-badge print-badge-green">
            نقدي <span className="num">{formatMoney(dayMethods.cash)}</span>
          </span>{' '}
          <span className="print-badge print-badge-sky">
            تحويل <span className="num">{formatMoney(dayMethods.transfer)}</span>
          </span>
          {Math.abs(dayMethods.other) >= 0.005 && (
            <>
              {' '}
              <span className="print-badge print-badge-amber">
                أخرى <span className="num">{formatMoney(dayMethods.other)}</span>
              </span>
            </>
          )}
        </p>
      </div>

      {sessions.length > 0 && (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="print-table w-full min-w-[44rem] text-xs print:min-w-0">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>اللوحة</th>
                <th>المالك</th>
                <th>الدخول</th>
                <th>الخروج</th>
                <th>المدة</th>
                <th>النوع</th>
                <th>المحصّل</th>
                <th>طريقة الدفع</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, index) => {
                const m = sessionMethods.get(s.id) ?? EMPTY_METHODS
                const paid = methodsTotal(m)
                return (
                  <tr key={s.id}>
                    <td className="text-slate-400"><span className="num">{index + 1}</span></td>
                    <td className="font-bold"><span className="num">{displayPlate(s.plate_number)}</span></td>
                    <td className="!whitespace-normal">{s.owner_name || '—'}</td>
                    <td>{formatTime(s.entry_time)}</td>
                    <td>{s.exit_time ? formatTime(s.exit_time) : '—'}</td>
                    <td className="!whitespace-normal">
                      {s.duration_minutes !== null ? formatDuration(s.duration_minutes) : '—'}
                    </td>
                    <td>
                      {s.session_type === 'monthly' ? (
                        <span className="print-badge print-badge-violet">
                          مشتركة
                          {s.subscription_amount !== null && (
                            <>
                              {' '}
                              <span className="num">{formatMoney(s.subscription_amount)}</span>
                            </>
                          )}
                        </span>
                      ) : (
                        'زيارة'
                      )}
                    </td>
                    <td className="font-semibold">
                      <span className="num">
                        {Math.abs(paid) >= 0.005 ? formatMoney(paid) : '—'}
                      </span>
                    </td>
                    <td>
                      <MethodCell
                        methods={m}
                        subscribed={s.session_type === 'monthly'}
                      />
                    </td>
                    <td className="min-w-[7rem] !whitespace-normal text-[10px]">
                      <SessionNote session={s} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {payments.length > 0 && (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="print-table w-full min-w-[38rem] text-xs print:min-w-0">
            <thead>
              {/* العنوان داخل رأس الجدول: لا ينفصل عنه، ويتكرر في كل صفحة */}
              <tr>
                <th colSpan={7} className="print-th-caption">
                  دفعات اشتراكات مقبوضة في هذا اليوم
                </th>
              </tr>
              <tr>
                <th>اللوحة</th>
                <th>المالك</th>
                <th>المدفوع</th>
                <th>طريقة الدفع</th>
                <th>قيمة الاشتراك</th>
                <th>فترة الاشتراك</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="font-bold"><span className="num">{displayPlate(p.plate_number)}</span></td>
                  <td>{p.owner_name || '—'}</td>
                  <td className="font-semibold"><span className="num">{formatMoney(p.amount)}</span></td>
                  <td>
                    <MethodCell methods={sumByMethod([p])} />
                  </td>
                  <td><span className="num">
                    {p.subscription_amount !== null ? formatMoney(p.subscription_amount) : '—'}
                  </span></td>
                  <td>
                    {formatDateNumeric(p.start_date)} إلى {formatDateNumeric(p.end_date)}
                  </td>
                  <td>{formatTime(p.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const METHOD_BADGE: Record<keyof MethodTotals, string> = {
  cash: 'print-badge-green',
  transfer: 'print-badge-sky',
  other: 'print-badge-amber',
}

/** طريقة الدفع لسطر: «نقدي» أو «تحويل» — وبالمبلغين إن اختلطت الطريقتان */
function MethodCell({
  methods,
  subscribed = false,
}: {
  methods: MethodTotals
  subscribed?: boolean
}) {
  const keys = activeMethods(methods)

  if (keys.length === 0) {
    return <span className="text-slate-400">{subscribed ? 'اشتراك' : '—'}</span>
  }

  return (
    <span className="inline-flex flex-wrap gap-1">
      {keys.map((k) => (
        <span key={k} className={`print-badge ${METHOD_BADGE[k]}`}>
          {PAYMENT_METHOD_LABEL[k]}
          {keys.length > 1 && (
            <>
              {' '}
              <span className="num">{formatMoney(methods[k])}</span>
            </>
          )}
        </span>
      ))}
    </span>
  )
}

function SessionNote({ session: s }: { session: SessionDetail }) {
  const notes: string[] = []

  if (s.session_type === 'monthly') {
    if (s.subscription_balance !== null && Number(s.subscription_balance) > 0) {
      notes.push(`اشتراك غير مدفوع: متبقٍ ${formatMoney(s.subscription_balance)}`)
    }
  } else if (s.exit_time === null) {
    notes.push('داخل الموقف')
  } else if (s.payment_status !== 'paid') {
    notes.push(PAYMENT_STATUS_LABEL[s.payment_status])
  }

  if (s.adjustment < 0) {
    notes.push(
      `خصم ${formatMoney(-s.adjustment)}${s.discount_reason ? ` (${s.discount_reason})` : ''}`,
    )
  }
  if (s.prepaid_amount > 0) notes.push(`مدفوع عند الدخول ${formatMoney(s.prepaid_amount)}`)
  if (s.services_total > 0) notes.push(`غسيل ${formatMoney(s.services_total)}`)
  if (s.adjustments_count > 0) notes.push('معدّلة (لها سجل تعديلات)')

  return notes.length > 0 ? <>{notes.join(' · ')}</> : <span className="text-slate-300">—</span>
}

function SummaryBox({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string
  tone?: 'slate' | 'blue' | 'green' | 'red' | 'violet' | 'sky' | 'amber'
}) {
  const color = {
    slate: 'text-slate-900',
    blue: 'text-brand-700',
    green: 'text-emerald-700',
    red: 'text-rose-700',
    violet: 'text-violet-700',
    sky: 'text-sky-700',
    amber: 'text-amber-700',
  }[tone]

  return (
    <div className="rounded-lg border border-slate-200 px-2 py-2 text-center">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`num mt-0.5 text-sm font-bold ${color}`}>{value}</p>
    </div>
  )
}
