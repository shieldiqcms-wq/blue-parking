import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CarFront, Clock, LogOut, RefreshCw, Search, Ticket } from 'lucide-react'
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
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format'
import { displayPlate } from '@/lib/plate'

export function ActiveParkingPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  useTicker(60_000) // تحديث المدة الظاهرة كل دقيقة

  const cars = useAsync(() => listCarsInside(search), [search])

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
                <Link to="/entry">
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

                    <Button
                      size="lg"
                      variant="success"
                      onClick={() =>
                        navigate('/exit', {
                          state: { sessionId: car.session_id },
                        })
                      }
                      icon={<LogOut className="h-5 w-5" aria-hidden />}
                      className="shrink-0"
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
    </div>
  )
}
