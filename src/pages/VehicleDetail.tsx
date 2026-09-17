import { useAsync } from '@/hooks/useAsync'
import { getVehicleSessions, getVehicleSubscriptions } from '@/services/vehicles'
import {
  Badge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
} from '@/components/ui'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  PAYMENT_STATUS_LABEL,
  SESSION_TYPE_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
} from '@/lib/format'
import { displayPlate } from '@/lib/plate'
import { CURRENCY } from '@/lib/env'
import type { Vehicle } from '@/types/database'

export function VehicleDetailModal({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle | null
  onClose: () => void
}) {
  return (
    <Modal
      open={Boolean(vehicle)}
      onClose={onClose}
      title={vehicle ? displayPlate(vehicle.plate_number) : ''}
      size="lg"
    >
      {vehicle && <VehicleDetailBody vehicle={vehicle} />}
    </Modal>
  )
}

function VehicleDetailBody({ vehicle }: { vehicle: Vehicle }) {
  const sessions = useAsync(
    () => getVehicleSessions(vehicle.id, 30),
    [vehicle.id],
  )
  const subs = useAsync(
    () => getVehicleSubscriptions(vehicle.id),
    [vehicle.id],
  )

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------ البيانات ------------------------------ */}
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3.5">
        <Item label="اسم المالك">{vehicle.owner_name || '—'}</Item>
        <Item label="رقم الهاتف">
          <span className="num">{vehicle.phone || '—'}</span>
        </Item>
        <Item label="الحالة">
          {vehicle.is_active ? (
            <Badge tone="green">فعّالة</Badge>
          ) : (
            <Badge tone="red">موقوفة</Badge>
          )}
        </Item>
        <Item label="مسجّلة منذ">{formatDate(vehicle.created_at)}</Item>
        {vehicle.notes && (
          <div className="col-span-2">
            <Item label="ملاحظات">{vehicle.notes}</Item>
          </div>
        )}
      </dl>

      {/* ----------------------------- الاشتراكات ----------------------------- */}
      <section>
        <h3 className="mb-2 text-sm font-bold text-slate-700">
          سجل الاشتراكات
        </h3>

        {subs.loading && <LoadingBlock />}
        {subs.error && (
          <ErrorBlock message={subs.error} onRetry={() => void subs.reload()} />
        )}
        {subs.data && subs.data.length === 0 && (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            لا توجد اشتراكات لهذه السيارة
          </p>
        )}
        {subs.data && subs.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {subs.data.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
              >
                <div>
                  <p className="num text-sm font-semibold text-slate-800">
                    {formatDate(sub.start_date)} — {formatDate(sub.end_date)}
                  </p>
                  {sub.monthly_amount !== null && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="num">
                        {formatMoney(sub.monthly_amount)}
                      </span>{' '}
                      {CURRENCY} شهرياً
                    </p>
                  )}
                </div>
                <Badge
                  tone={
                    sub.computed_status === 'active'
                      ? 'green'
                      : sub.computed_status === 'upcoming'
                        ? 'blue'
                        : 'slate'
                  }
                >
                  {SUBSCRIPTION_STATUS_LABEL[sub.computed_status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------ الحركات ------------------------------ */}
      <section>
        <h3 className="mb-2 text-sm font-bold text-slate-700">سجل الدخول والخروج</h3>

        {sessions.loading && <LoadingBlock />}
        {sessions.error && (
          <ErrorBlock
            message={sessions.error}
            onRetry={() => void sessions.reload()}
          />
        )}
        {sessions.data && sessions.data.length === 0 && (
          <EmptyState title="لا توجد حركات مسجّلة لهذه السيارة" />
        )}
        {sessions.data && sessions.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {sessions.data.map((session) => {
              const duration =
                session.exit_time === null
                  ? null
                  : Math.round(
                      (new Date(session.exit_time).getTime() -
                        new Date(session.entry_time).getTime()) /
                        60000,
                    )

              return (
                <li
                  key={session.id}
                  className="rounded-xl border border-slate-200 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600">
                      {SESSION_TYPE_LABEL[session.session_type]}
                    </span>
                    {session.exit_time === null ? (
                      <Badge tone="blue">داخل الموقف</Badge>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="num text-sm font-bold text-slate-800">
                          {formatMoney(session.amount_due)} {CURRENCY}
                        </span>
                        <Badge
                          tone={
                            session.payment_status === 'paid'
                              ? 'green'
                              : session.payment_status === 'unpaid'
                                ? 'red'
                                : 'slate'
                          }
                        >
                          {PAYMENT_STATUS_LABEL[session.payment_status]}
                        </Badge>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(session.entry_time)}
                    {session.exit_time && ` ← ${formatDateTime(session.exit_time)}`}
                    {duration !== null && ` · ${formatDuration(duration)}`}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Item({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{children}</dd>
    </div>
  )
}
