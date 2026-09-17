import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import { normalizePlate } from '@/lib/plate'
import type {
  CarInside,
  LookupPlateResult,
  PaymentMethod,
  PreviewExitResult,
  RegisterEntryResult,
  RegisterExitResult,
  SessionDetail,
} from '@/types/database'

/**
 * كل عمليات الدخول والخروج تمر عبر دوال RPC داخل قاعدة البيانات.
 * الواجهة لا تُرسل أي مبلغ — المبلغ يُحسب في قاعدة البيانات فقط.
 */

export async function lookupPlate(plate: string): Promise<LookupPlateResult> {
  if (!normalizePlate(plate)) throw new AppError('رقم اللوحة مطلوب')

  const { data, error } = await supabase.rpc('lookup_plate', { p_plate: plate })
  if (error) throw new AppError(toArabicError(error))
  return data as LookupPlateResult
}

export interface EntryInput {
  plate: string
  ownerName?: string | null
  phone?: string | null
  notes?: string | null
}

export async function registerEntry(
  input: EntryInput,
): Promise<RegisterEntryResult> {
  if (!normalizePlate(input.plate)) throw new AppError('رقم اللوحة مطلوب')

  const { data, error } = await supabase.rpc('register_entry', {
    p_plate: input.plate.trim(),
    p_owner_name: input.ownerName?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_notes: input.notes?.trim() || null,
  })

  if (error) throw new AppError(toArabicError(error))
  return data as RegisterEntryResult
}

export async function previewExit(sessionId: string): Promise<PreviewExitResult> {
  const { data, error } = await supabase.rpc('preview_exit', {
    p_session_id: sessionId,
  })
  if (error) throw new AppError(toArabicError(error))
  return data as PreviewExitResult
}

export interface ExitInput {
  sessionId: string
  paymentStatus: 'paid' | 'unpaid' | 'waived'
  paymentMethod?: PaymentMethod | null
  notes?: string | null
}

export async function registerExit(
  input: ExitInput,
): Promise<RegisterExitResult> {
  const { data, error } = await supabase.rpc('register_exit', {
    p_session_id: input.sessionId,
    p_payment_status: input.paymentStatus,
    p_payment_method:
      input.paymentStatus === 'paid' ? (input.paymentMethod ?? 'cash') : null,
    p_notes: input.notes?.trim() || null,
  })

  if (error) throw new AppError(toArabicError(error))
  return data as RegisterExitResult
}

export async function settleSession(
  sessionId: string,
  paymentMethod: PaymentMethod = 'cash',
  notes?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('settle_session', {
    p_session_id: sessionId,
    p_payment_method: paymentMethod,
    p_notes: notes?.trim() || null,
  })
  if (error) throw new AppError(toArabicError(error))
}

export async function listCarsInside(search = ''): Promise<CarInside[]> {
  let query = supabase
    .from('current_cars_inside')
    .select('*')
    .order('entry_time', { ascending: true })

  const term = search.trim()
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
  return (data ?? []) as CarInside[]
}

export interface SessionFilter {
  from?: string
  to?: string
  paymentStatus?: string
  sessionType?: string
  search?: string
  limit?: number
}

export async function listSessions(
  filter: SessionFilter = {},
): Promise<SessionDetail[]> {
  let query = supabase
    .from('session_details')
    .select('*')
    .order('entry_time', { ascending: false })
    .limit(filter.limit ?? 500)

  if (filter.from) query = query.gte('business_date', filter.from)
  if (filter.to) query = query.lte('business_date', filter.to)
  if (filter.paymentStatus) query = query.eq('payment_status', filter.paymentStatus)
  if (filter.sessionType) query = query.eq('session_type', filter.sessionType)

  const term = filter.search?.trim()
  if (term) {
    query = query.or(`plate_number.ilike.%${term}%,owner_name.ilike.%${term}%`)
  }

  const { data, error } = await query
  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SessionDetail[]
}

export async function listRecentSessions(limit = 8): Promise<SessionDetail[]> {
  const { data, error } = await supabase
    .from('session_details')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SessionDetail[]
}

export async function listUnpaidSessions(): Promise<SessionDetail[]> {
  const { data, error } = await supabase
    .from('session_details')
    .select('*')
    .eq('payment_status', 'unpaid')
    .not('exit_time', 'is', null)
    .order('exit_time', { ascending: false })
    .limit(200)

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SessionDetail[]
}
