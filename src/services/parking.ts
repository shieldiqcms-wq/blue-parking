import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import { normalizePlate } from '@/lib/plate'
import type {
  ServiceType,
  CarInside,
  LookupPlateResult,
  PaymentMethod,
  PrepaidAction,
  PreviewExitResult,
  RegisterEntryResult,
  RegisterExitResult,
  SessionAdjustment,
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
  /** تحصيل رسوم الوقوف كاملة أو جزئياً لحظة الدخول */
  prepaidAmount?: number | null
  prepaidMethod?: PaymentMethod | null
  /** خدمة تُضاف في نفس العملية (غسيل/تمسيح) */
  serviceType?: ServiceType | null
  serviceAmount?: number | null
  serviceNotes?: string | null
}

/**
 * تسجيل الدخول — مع الدفع والخدمة اختيارياً في عملية واحدة.
 *
 * الثلاثة تتم داخل معاملة واحدة في قاعدة البيانات: إن فشل أي جزء لا
 * يُسجَّل شيء، فلا تبقى سيارة داخل الموقف بلا قيد للمبلغ المقبوض.
 */
export async function registerEntry(
  input: EntryInput,
): Promise<RegisterEntryResult> {
  if (!normalizePlate(input.plate)) throw new AppError('رقم اللوحة مطلوب')

  const { data, error } = await supabase.rpc('register_entry', {
    p_plate: input.plate.trim(),
    p_owner_name: input.ownerName?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_prepaid_amount: input.prepaidAmount ?? null,
    p_prepaid_method: input.prepaidMethod ?? 'cash',
    p_service_type: input.serviceType ?? null,
    p_service_amount: input.serviceAmount ?? null,
    p_service_notes: input.serviceNotes?.trim() || null,
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
  /**
   * المبلغ المحصّل فعلاً. اتركه فارغاً لتحصيل الفاتورة كاملة.
   * قاعدة البيانات ترفض أي مبلغ يتجاوز الفاتورة — الخصم فقط مسموح.
   */
  collectedAmount?: number | null
  discountReason?: string | null
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
    p_collected_amount:
      input.paymentStatus === 'paid' ? (input.collectedAmount ?? null) : null,
    p_discount_reason: input.discountReason?.trim() || null,
  })

  if (error) throw new AppError(toArabicError(error))
  return data as RegisterExitResult
}

export async function settleSession(
  sessionId: string,
  paymentMethod: PaymentMethod = 'cash',
  notes?: string | null,
  collectedAmount?: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('settle_session', {
    p_session_id: sessionId,
    p_payment_method: paymentMethod,
    p_notes: notes?.trim() || null,
    p_collected_amount: collectedAmount ?? null,
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
  /**
   * على أي تاريخ تُطبَّق الفترة: تاريخ الإيراد (الخروج، افتراضياً)
   * أو تاريخ الدخول — لقائمة «السيارات التي دخلت في هذا اليوم».
   */
  dateField?: 'business_date' | 'entry_date'
}

export async function listSessions(
  filter: SessionFilter = {},
): Promise<SessionDetail[]> {
  let query = supabase
    .from('session_details')
    .select('*')
    .order('entry_time', { ascending: false })
    .limit(filter.limit ?? 500)

  const dateField = filter.dateField ?? 'business_date'
  if (filter.from) query = query.gte(dateField, filter.from)
  if (filter.to) query = query.lte(dateField, filter.to)
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

/* ================= تعديل دفع السيارات الموجودة داخل الموقف ================= */
/*
 * لا شيء يُحذف: كل تعديل يُسجَّل كقيد جديد في الدفعات، ويُحفظ في سجل
 * التعديلات مع القيم قبل وبعد والسبب.
 */

/** تحصيل مبلغ بعد الدخول وقبل الخروج — يُخصم من المستحق عند الخروج */
export async function collectSessionPayment(
  sessionId: string,
  amount: number,
  method: PaymentMethod = 'cash',
  notes?: string | null,
): Promise<{ prepaid_amount: number }> {
  const { data, error } = await supabase.rpc('collect_session_payment', {
    p_session_id: sessionId,
    p_amount: amount,
    p_payment_method: method,
    p_notes: notes?.trim() || null,
  })
  if (error) throw new AppError(toArabicError(error))
  return data as { prepaid_amount: number }
}

/** تصحيح المبلغ المسجّل عند الدخول — newAmount = ما دُفع فعلاً (0 = لم يدفع) */
export async function correctSessionPayment(
  sessionId: string,
  newAmount: number,
  reason: string,
  method?: PaymentMethod | null,
): Promise<{ difference: number; prepaid_amount: number }> {
  if (!reason.trim()) throw new AppError('اكتب سبب التصحيح')

  const { data, error } = await supabase.rpc('correct_session_payment', {
    p_session_id: sessionId,
    p_new_amount: newAmount,
    p_reason: reason.trim(),
    p_payment_method: method ?? null,
  })
  if (error) throw new AppError(toArabicError(error))
  return data as { difference: number; prepaid_amount: number }
}

/** تحويل دخول عادي إلى دخول اشتراك (السيارة اشتركت بعد أن دخلت) */
export async function convertSessionToSubscription(
  sessionId: string,
  prepaidAction: PrepaidAction = 'void',
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('convert_session_to_subscription', {
    p_session_id: sessionId,
    p_prepaid_action: prepaidAction,
    p_reason: reason?.trim() || null,
  })
  if (error) throw new AppError(toArabicError(error))
}

/** سجل تعديلات عملية — الأقدم أولاً */
export async function listSessionAdjustments(
  sessionId: string,
): Promise<SessionAdjustment[]> {
  const { data, error } = await supabase
    .from('session_adjustments')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as SessionAdjustment[]
}
