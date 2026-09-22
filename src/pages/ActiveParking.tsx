import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CarFront,
  Clock,
  LogOut,
  RefreshCw,
  Search,
  Ticket,
  Wallet,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useTicker } from '@/hooks/useOnline'
import { listCarsInside } from '@/services/parking'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeading,
} from '@/components/ui'
import {
  formatDate,
  formatDuration,
  formatMoney,
  formatTime,
  minutesSince,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import {
  SessionPaymentDialog,
  type SessionPaymentMode,
  type SessionPaymentTarget,
} from '@/components/SessionPaymentDialog'
import type { CarInside } from '@/types/database'

export function ActiveParkingPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  useTicker(60_000) // تحديث المدة الظاهرة كل دقيقة

  const cars = useAsync(() => listCarsInside(search), [search])

  // نافذة الدفع: تحصيل / تصحيح / تحويل لاشتراك
  const [payTarget, setPayTarget] = useState<SessionPaymentTarget | null>(null)
  const [payMode, setPayMode] = useState<SessionPaymentMode>('collect')

  const openPayment = (car: CarInside, mode: SessionPaymentMode) => {
    setPayMode(mode)
    setPayTarget({
      sessionId: car.session_id,
      plate: car.plate_number,
      sessionType: car.session_type,
      entryTime: car.entry_time,
      prepaidAmount: Number(car.prepaid_amount ?? 0),
      prepaidMethod: car.prepaid_method,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="السيارات الموجودة حالياً"
        description={
          cars.data ? `${cars.data.length} سيارة داخل الموقف` : undefined
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void cars.reload()}
            loading={cars.loading}
            icon={<RefreshCw className="h-4 w-4" aria-hidden />}
          >
            تحديث
          </Button>
        }
      />

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

      {cars.loading && !cars.data && <LoadingBlock />}

      {cars.error && (
        <ErrorBlock message={cars.error} onRetry={() => void cars.reload()} />
      )}

      {cars.data && cars.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<CarFront className="h-7 w-7" aria-hidden />}
            title={search ? 'لا توجد نتائج' : 'لا توجد سيارات داخل الموقف'}
            description={
              search
                ? 'جرّب رقم لوحة آخر'
                : 'ستظهر هنا كل سيارة سجّلت دخولاً ولم تخرج بعد'
            }
            action={
              !search ? (
                <Link to="/gate">
                  <Button size="sm">دخول سيارة</Button>
                </Link>
              ) : undefined
            }
          />
        </Card>
      )}

      {cars.data && cars.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {cars.data.map((car) => {
            const minutes = minutesSince(car.entry_time)
            const monthly = car.session_type === 'monthly'
            const prepaid = Number(car.prepaid_amount ?? 0)
            // اشتركت بعد أن دخلت: الدخول ما زال «زيارة» والاشتراك ساري الآن
            const subscribedAfterEntry = !monthly && Boolean(car.active_subscription_id)

            return (
              <li key={car.session_id}>
                <Card padded={false} className="overflow-hidden">
                  <div className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-lg font-bold text-slate-900">
                          {displayPlate(car.plate_number)}
                        </span>
                        {monthly ? (
                          <Badge tone="violet">
                            <Ticket className="h-3 w-3" aria-hidden />
                            اشتراك ساري
                          </Badge>
                        ) : (
                          <Badge tone="blue">زيارة عادية</Badge>
                        )}
                        {!monthly &&
                          (prepaid > 0 ? (
                            <Badge tone="green">
                              مدفوع {formatMoney(prepaid)} {CURRENCY}
                            </Badge>
                          ) : (
                            <Badge tone="amber">غير مدفوع</Badge>
                          ))}
                        {car.adjustments_count > 0 && (
                          <Badge tone="slate">معدّلة</Badge>
                        )}
                      </div>

                      {car.owner_name && (
                        <p className="mt-1 truncate text-sm text-slate-600">
                          {car.owner_name}
                        </p>
                      )}

                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          دخول
                          <span className="num font-semibold text-slate-700">
                            {formatTime(car.entry_time)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden />
                          {formatDuration(minutes)}
                        </span>
                        {monthly && car.subscription_end_date && (
                          <span>
                            حتى{' '}
                            <span className="num">
                              {formatDate(car.subscription_end_date)}
                            </span>
                          </span>
                        )}
                      </p>
                    </div>

                  </div>

                  {subscribedAfterEntry && (
                    <button
                      type="button"
                      onClick={() => openPayment(car, 'convert')}
                      className="flex w-full items-center gap-2 border-t border-violet-100 bg-violet-50 px-4 py-2.5 text-start text-sm text-violet-900 transition hover:bg-violet-100"
                    >
                      <Ticket className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
                      <span className="flex-1">
                        لديها اشتراك ساري الآن
                        {car.active_subscription_end && (
                          <>
                            {' '}حتى <span className="num">{formatDate(car.active_subscription_end)}</span>
                          </>
                        )}
                        {' — '}حوّل الدخول إلى اشتراك
                      </span>
                      <span className="shrink-0 text-xs font-bold text-violet-700">تحويل</span>
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
                    <Button
                      variant="secondary"
                      onClick={() => openPayment(car, 'collect')}
                      icon={<Wallet className="h-4 w-4" aria-hidden />}
                    >
                      الدفع
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        navigate('/gate', {
                          state: { sessionId: car.session_id },
                        })
                      }
                      icon={<LogOut className="h-4 w-4" aria-hidden />}
                    >
                      خروج
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <SessionPaymentDialog
        target={payTarget}
        initialMode={payMode}
        onClose={() => setPayTarget(null)}
        onChanged={() => {
          setPayTarget(null)
          void cars.reload()
        }}
      />
    </div>
  )
}
