import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import { normalizePlate } from '@/lib/plate'
import type {
  ComputedSubscriptionStatus,
  PaymentMethod,
  SubscriptionPayMode,
  SubscriptionPaymentDetail,
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

export interface NewSubscriptionInput {
  startDate: string
  endDate: string
  monthlyAmount?: number | null
  payMode: SubscriptionPayMode
  /** للدفع الجزئي فقط */
  paidAmount?: number | null
  paymentMethod?: PaymentMethod
  /** سيارة مسجّلة — أو اتركه واملأ plate لسيارة جديدة */
  vehicleId?: string | null
  plate?: string | null
  ownerName?: string | null
  phone?: string | null
  notes?: string | null
}

export interface NewSubscriptionResult {
  is_new_vehicle: boolean
  paid_amount: number
  balance: number
}

/**
 * إنشاء اشتراك — يُنشئ السيارة إن لم تكن مسجّلة، ويسجّل الدفعة الأولى
 * حسب الخيار، في معاملة واحدة داخل قاعدة البيانات.
 */
export async function createSubscriptionWithPayment(
  input: NewSubscriptionInput,
): Promise<NewSubscriptionResult> {
  if (!input.vehicleId && !normalizePlate(input.plate)) {
    throw new AppError('رقم اللوحة مطلوب')
  }
  if (!input.startDate || !input.endDate) {
    throw new AppError('تاريخ البداية والنهاية مطلوبان')
  }
  if (input.endDate < input.startDate) {
    throw new AppError('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية')
  }

  const { data, error } = await supabase.rpc('create_subscription', {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_monthly_amount: input.monthlyAmount ?? null,
    p_pay_mode: input.payMode,
    p_paid_amount: input.paidAmount ?? null,
    p_payment_method: input.paymentMethod ?? 'cash',
    p_vehicle_id: input.vehicleId ?? null,
    p_plate: input.plate?.trim() || null,
    p_owner_name: input.ownerName?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_notes: input.notes?.trim() || null,
  })

  if (error) throw new AppError(toArabicError(error))
  return data as NewSubscriptionResult
}

/** تحصيل دفعة على اشتراك — بلا مبلغ يُحصَّل كامل المتبقّي */
export async function paySubscription(
  subscriptionId: string,
  amount?: number | null,
  method: PaymentMethod = 'cash',
  notes?: string | null,
): Promise<{ paid_now: number; balance: number }> {
  const { data, error } = await supabase.rpc('pay_subscription', {
    p_subscription_id: subscriptionId,
    p_amount: amount ?? null,
    p_payment_method: method,
    p_notes: notes?.trim() || null,
  })
  if (error) throw new AppError(toArabicError(error))
  return data as { paid_now: number; balance: number }
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

/** دفعات الاشتراكات المقبوضة في فترة (حسب تاريخ القبض بتوقيت الأردن) */
export async function listSubscriptionPayments(
  from: string,
  to: string,
): Promise<SubscriptionPaymentDetail[]> {
  const { data, error } = await supabase
    .from('subscription_payment_details')
    .select('*')
    .gte('business_date', from)
    .lte('business_date', to)
    .order('paid_at', { ascending: true })
    .limit(2000)

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SubscriptionPaymentDetail[]
}
