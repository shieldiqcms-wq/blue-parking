import { useState, type FormEvent } from 'react'
import { Car, Pencil, Plus, Search } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/hooks/useToast'
import {
  createVehicle,
  listVehicles,
  updateVehicle,
  type VehicleInput,
} from '@/services/vehicles'
import { toArabicError } from '@/lib/errors'
import { isValidPlate, displayPlate } from '@/lib/plate'
import { PlateInput } from '@/components/PlateInput'
import { formatDate } from '@/lib/format'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeading,
  Textarea,
} from '@/components/ui'
import { VehicleDetailModal } from './VehicleDetail'
import type { Vehicle } from '@/types/database'

const EMPTY: VehicleInput = {
  plate_number: '',
  owner_name: '',
  phone: '',
  notes: '',
  is_active: true,
}

export function VehiclesPage() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const vehicles = useAsync(() => listVehicles(search), [search])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<VehicleInput>(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (vehicle: Vehicle) => {
    setEditing(vehicle)
    setForm({
      plate_number: vehicle.plate_number,
      owner_name: vehicle.owner_name ?? '',
      phone: vehicle.phone ?? '',
      notes: vehicle.notes ?? '',
      is_active: vehicle.is_active,
    })
    setFormError(null)
    setFormOpen(true)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)

    if (!isValidPlate(form.plate_number)) {
      setFormError('رقم اللوحة مطلوب')
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await updateVehicle(editing.id, form)
        toast.success('تم تحديث بيانات السيارة')
      } else {
        await createVehicle(form)
        toast.success('تمت إضافة السيارة')
      }
      setFormOpen(false)
      await vehicles.reload()
    } catch (error) {
      setFormError(toArabicError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="السيارات"
        description={
          vehicles.data ? `${vehicles.data.length} سيارة` : undefined
        }
        action={
          <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
            إضافة سيارة
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
          placeholder="ابحث برقم اللوحة أو اسم المالك أو الهاتف"
          className="pe-10"
          aria-label="بحث"
        />
      </div>

      {vehicles.loading && !vehicles.data && <LoadingBlock />}

      {vehicles.error && (
        <ErrorBlock
          message={vehicles.error}
          onRetry={() => void vehicles.reload()}
        />
      )}

      {vehicles.data && vehicles.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Car className="h-7 w-7" aria-hidden />}
            title={search ? 'لا توجد نتائج' : 'لا توجد سيارات مسجّلة'}
            description={
              search
                ? 'جرّب كلمة بحث أخرى'
                : 'السيارات تُضاف تلقائياً عند أول دخول، أو يمكنك إضافتها يدوياً'
            }
            action={
              !search ? (
                <Button size="sm" onClick={openCreate}>
                  إضافة سيارة
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {vehicles.data && vehicles.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {vehicles.data.map((vehicle) => (
            <li key={vehicle.id}>
              <Card padded={false}>
                <div className="flex items-center gap-2 p-3.5">
                  <button
                    type="button"
                    onClick={() => setDetailVehicle(vehicle)}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-base font-bold text-slate-900">
                        {displayPlate(vehicle.plate_number)}
                      </span>
                      {!vehicle.is_active && <Badge tone="red">موقوفة</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">
                      {vehicle.owner_name || 'بدون اسم مالك'}
                      {vehicle.phone && (
                        <>
                          {' · '}
                          <span className="num">{vehicle.phone}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      مسجّلة منذ {formatDate(vehicle.created_at)}
                    </p>
                  </button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(vehicle)}
                    aria-label={`تعديل ${vehicle.plate_number}`}
                    icon={<Pencil className="h-4 w-4" aria-hidden />}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------ النموذج ------------------------------ */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'تعديل بيانات السيارة' : 'إضافة سيارة'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={(e) => void handleSubmit(e as unknown as FormEvent)}
              loading={saving}
            >
              حفظ
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="رقم اللوحة" htmlFor="v-plate" required>
            <PlateInput
              id="v-plate"
              value={form.plate_number}
              onChange={(value) => setForm({ ...form, plate_number: value })}
              autoFocus
            />
          </Field>

          <Field label="اسم المالك" htmlFor="v-owner">
            <Input
              id="v-owner"
              value={form.owner_name ?? ''}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              maxLength={80}
            />
          </Field>

          <Field label="رقم الهاتف" htmlFor="v-phone">
            <Input
              id="v-phone"
              type="tel"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              maxLength={20}
            />
          </Field>

          <Field label="ملاحظات" htmlFor="v-notes">
            <Textarea
              id="v-notes"
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={300}
            />
          </Field>

          {editing && (
            <label className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-3">
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span className="text-sm font-medium text-slate-700">
                السيارة فعّالة (يمكن تسجيل دخولها)
              </span>
            </label>
          )}

          {formError && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700"
              role="alert"
            >
              {formError}
            </p>
          )}

          <button type="submit" className="hidden" aria-hidden />
        </form>
      </Modal>

      <VehicleDetailModal
        vehicle={detailVehicle}
        onClose={() => setDetailVehicle(null)}
      />
    </div>
  )
}
