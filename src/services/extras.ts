import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import type {
  CostCenter,
  ExpenseCategory,
  ExpenseRow,
  PaymentMethod,
  ServiceRow,
  ServiceType,
} from '@/types/database'

/* ============================== الخدمات ============================== */

export interface ServiceInput {
  serviceType: ServiceType
  amount: number
  /** السيارة — إما بالمعرّف أو برقم اللوحة */
  vehicleId?: string | null
  plate?: string | null
  sessionId?: string | null
  paymentStatus?: 'paid' | 'unpaid' | 'waived'
  paymentMethod?: PaymentMethod | null
  notes?: string | null
}

export async function addService(input: ServiceInput): Promise<ServiceRow> {
  if (!(input.amount > 0)) {
    throw new AppError('قيمة الخدمة مطلوبة ويجب أن تكون أكبر من صفر')
  }

  const { data, error } = await supabase.rpc('add_service', {
    p_service_type: input.serviceType,
    p_amount: input.amount,
    p_vehicle_id: input.vehicleId ?? null,
    p_session_id: input.sessionId ?? null,
    p_payment_status: input.paymentStatus ?? 'paid',
    p_payment_method: input.paymentMethod ?? 'cash',
    p_notes: input.notes?.trim() || null,
    p_plate: input.plate?.trim() || null,
  })

  if (error) throw new AppError(toArabicError(error))
  return (data as { service: ServiceRow }).service
}

export async function deleteService(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_service', { p_id: id })
  if (error) throw new AppError(toArabicError(error))
}

export interface ServiceFilter {
  from?: string
  to?: string
  search?: string
  limit?: number
}

export async function listServices(
  filter: ServiceFilter = {},
): Promise<ServiceRow[]> {
  let query = supabase
    .from('service_details')
    .select('*')
    .order('performed_at', { ascending: false })
    .limit(filter.limit ?? 300)

  if (filter.from) query = query.gte('business_date', filter.from)
  if (filter.to) query = query.lte('business_date', filter.to)

  const term = filter.search?.trim()
  if (term) {
    query = query.or(`plate_number.ilike.%${term}%,notes.ilike.%${term}%`)
  }

  const { data, error } = await query
  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as ServiceRow[]
}

export async function listSessionServices(
  sessionId: string,
): Promise<ServiceRow[]> {
  const { data, error } = await supabase
    .from('service_details')
    .select('*')
    .eq('session_id', sessionId)
    .order('performed_at', { ascending: false })

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as ServiceRow[]
}

/* ============================= المصاريف ============================= */

export interface ExpenseInput {
  category: ExpenseCategory
  amount: number
  notes?: string | null
  spentAt?: string | null
  /** على أي نشاط يُحمّل المصروف — افتراضياً مشترك */
  costCenter?: CostCenter
}

export async function addExpense(input: ExpenseInput): Promise<ExpenseRow> {
  if (!(input.amount > 0)) {
    throw new AppError('قيمة المصروف مطلوبة ويجب أن تكون أكبر من صفر')
  }

  const { data, error } = await supabase.rpc('add_expense', {
    p_category: input.category,
    p_amount: input.amount,
    p_notes: input.notes?.trim() || null,
    p_spent_at: input.spentAt ?? null,
    p_cost_center: input.costCenter ?? 'shared',
  })

  if (error) throw new AppError(toArabicError(error))
  return (data as { expense: ExpenseRow }).expense
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_expense', { p_id: id })
  if (error) throw new AppError(toArabicError(error))
}

export interface ExpenseFilter {
  from?: string
  to?: string
  category?: string
  costCenter?: string
  limit?: number
}

export async function listExpenses(
  filter: ExpenseFilter = {},
): Promise<ExpenseRow[]> {
  let query = supabase
    .from('expense_details')
    .select('*')
    .order('spent_at', { ascending: false })
    .limit(filter.limit ?? 300)

  if (filter.from) query = query.gte('business_date', filter.from)
  if (filter.to) query = query.lte('business_date', filter.to)
  if (filter.category) query = query.eq('category', filter.category)
  if (filter.costCenter) query = query.eq('cost_center', filter.costCenter)

  const { data, error } = await query
  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as ExpenseRow[]
}
