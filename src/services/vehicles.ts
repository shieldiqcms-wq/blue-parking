import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import { normalizePlate } from '@/lib/plate'
import type {
  ParkingSession,
  SubscriptionRow,
  Vehicle,
} from '@/types/database'

export interface VehicleInput {
  plate_number: string
  owner_name?: string | null
  phone?: string | null
  vehicle_type?: string | null
  notes?: string | null
  is_active?: boolean
}

export async function listVehicles(search = '', limit = 100): Promise<Vehicle[]> {
  let query = supabase
    .from('vehicles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  const term = search.trim()
  if (term) {
    const normalized = normalizePlate(term)
    const filters: string[] = []
    if (normalized) filters.push(`plate_normalized.ilike.%${normalized}%`)
    filters.push(`plate_number.ilike.%${term}%`)
    filters.push(`owner_name.ilike.%${term}%`)
    filters.push(`phone.ilike.%${term}%`)
    query = query.or(filters.join(','))
  }

  const { data, error } = await query
  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as Vehicle[]
}

export async function getVehicle(id: string): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new AppError(toArabicError(error))
  if (!data) throw new AppError('لا توجد سيارة بهذا الرقم')
  return data as Vehicle
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const plate = input.plate_number.trim()
  if (!normalizePlate(plate)) throw new AppError('رقم اللوحة مطلوب')

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      plate_number: plate,
      owner_name: input.owner_name?.trim() || null,
      phone: input.phone?.trim() || null,
      vehicle_type: input.vehicle_type?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single()

  if (error) throw new AppError(toArabicError(error))
  return data as Vehicle
}

export async function updateVehicle(
  id: string,
  input: VehicleInput,
): Promise<Vehicle> {
  const plate = input.plate_number.trim()
  if (!normalizePlate(plate)) throw new AppError('رقم اللوحة مطلوب')

  const { data, error } = await supabase
    .from('vehicles')
    .update({
      plate_number: plate,
      owner_name: input.owner_name?.trim() || null,
      phone: input.phone?.trim() || null,
      vehicle_type: input.vehicle_type?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: input.is_active ?? true,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new AppError(toArabicError(error))
  return data as Vehicle
}

export async function getVehicleSessions(
  vehicleId: string,
  limit = 50,
): Promise<ParkingSession[]> {
  const { data, error } = await supabase
    .from('parking_sessions')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('entry_time', { ascending: false })
    .limit(limit)

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as ParkingSession[]
}

export async function getVehicleSubscriptions(
  vehicleId: string,
): Promise<SubscriptionRow[]> {
  const { data, error } = await supabase
    .from('subscription_status')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('end_date', { ascending: false })

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SubscriptionRow[]
}
