import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import { normalizePlate } from '@/lib/plate'
import type {
  ComputedSubscriptionStatus,
  SubscriptionRow,
  Vehicle,
} from '@/types/database'

export interface SubscriptionInput {
  vehicle_id: string
  start_date: string
  end_date: string
  monthly_amount?: number | null
  notes?: string | null
}

export async function listSubscriptions(options: {
  status?: ComputedSubscriptionStatus | 'all'
  search?: string
} = {}): Promise<SubscriptionRow[]> {
  let query = supabase
    .from('subscription_status')
    .select('*')
    .order('end_date', { ascending: false })
    .limit(300)

  if (options.status && options.status !== 'all') {
    query = query.eq('computed_status', options.status)
  }

  const term = options.search?.trim()
  if (term) {
    const normalized = normalizePlate(term)
    const filters: string[] = []
    if (normalized) filters.push(`plate_normalized.ilike.%${normalized}%`)
    filters.push(`plate_number.ilike.%${term}%`)
    filters.push(`owner_name.ilike.%${term}%`)
    query = query.or(filters.join(','))
  }

  const { data, error } = await query
  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SubscriptionRow[]
}

function validate(input: SubscriptionInput): void {
  if (!input.vehicle_id) throw new AppError('يجب اختيار السيارة')
  if (!input.start_date) throw new AppError('تاريخ البداية مطلوب')
  if (!input.end_date) throw new AppError('تاريخ النهاية مطلوب')
  if (input.end_date < input.start_date) {
    throw new AppError('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية')
  }
  if (
    input.monthly_amount !== null &&
    input.monthly_amount !== undefined &&
    input.monthly_amount < 0
  ) {
    throw new AppError('قيمة الاشتراك لا يمكن أن تكون سالبة')
  }
}

export async function createSubscription(
  input: SubscriptionInput,
): Promise<SubscriptionRow> {
  validate(input)

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      vehicle_id: input.vehicle_id,
      start_date: input.start_date,
      end_date: input.end_date,
      status: 'active',
      monthly_amount: input.monthly_amount ?? null,
      notes: input.notes?.trim() || null,
    })
    .select()
    .single()

  if (error) throw new AppError(toArabicError(error))
  return data as unknown as SubscriptionRow
}

export async function updateSubscription(
  id: string,
  input: SubscriptionInput,
): Promise<void> {
  validate(input)

  const { error } = await supabase
    .from('subscriptions')
    .update({
      vehicle_id: input.vehicle_id,
      start_date: input.start_date,
      end_date: input.end_date,
      monthly_amount: input.monthly_amount ?? null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new AppError(toArabicError(error))
}

/** تمديد الاشتراك بعدد من الأشهر اعتباراً من تاريخ نهايته */
export async function extendSubscription(
  id: string,
  newEndDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ end_date: newEndDate, status: 'active' })
    .eq('id', id)

  if (error) throw new AppError(toArabicError(error))
}

export async function cancelSubscription(id: string): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (error) throw new AppError(toArabicError(error))
}

export async function reactivateSubscription(id: string): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'active' })
    .eq('id', id)

  if (error) throw new AppError(toArabicError(error))
}

/** بحث سريع عن سيارة لإضافة اشتراك */
export async function searchVehiclesForSubscription(
  term: string,
): Promise<Vehicle[]> {
  const search = term.trim()
  if (!search) return []

  const normalized = normalizePlate(search)
  const filters: string[] = []
  if (normalized) filters.push(`plate_normalized.ilike.%${normalized}%`)
  filters.push(`plate_number.ilike.%${search}%`)
  filters.push(`owner_name.ilike.%${search}%`)

  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .or(filters.join(','))
    .eq('is_active', true)
    .limit(10)

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as Vehicle[]
}
