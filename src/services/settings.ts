import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import type { AppSetting, PricingRule, RoundingMode } from '@/types/database'

/* --------------------------------- التسعيرة -------------------------------- */

export async function getActivePricingRule(): Promise<PricingRule> {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new AppError(toArabicError(error))
  if (!data) {
    throw new AppError('لا توجد قاعدة تسعير فعّالة. اضبط التسعيرة أولاً')
  }
  return data as PricingRule
}

export async function listPricingRules(): Promise<PricingRule[]> {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) throw new AppError(toArabicError(error))
  return (data ?? []) as PricingRule[]
}

export interface PricingInput {
  name: string
  base_amount: number
  base_start_time: string
  base_end_time: string
  extra_hour_amount: number
  rounding_mode: RoundingMode
  grace_minutes: number
  charge_before_start: boolean
  /** أيام الإغلاق: 0=الأحد … 5=الجمعة, 6=السبت */
  closed_days: number[]
}

function validatePricing(input: PricingInput): void {
  if (!input.name.trim()) throw new AppError('اسم التسعيرة مطلوب')
  if (!(input.base_amount >= 0)) throw new AppError('المبلغ الأساسي غير صالح')
  if (!(input.extra_hour_amount >= 0)) {
    throw new AppError('مبلغ الساعة الإضافية غير صالح')
  }
  if (!input.base_start_time || !input.base_end_time) {
    throw new AppError('يجب تحديد بداية ونهاية فترة الدوام')
  }
  if (input.base_end_time <= input.base_start_time) {
    throw new AppError('نهاية الدوام يجب أن تكون بعد بدايته')
  }
  if (input.grace_minutes < 0 || input.grace_minutes > 240) {
    throw new AppError('فترة السماح يجب أن تكون بين 0 و 240 دقيقة')
  }
  if (input.closed_days.some((d) => d < 0 || d > 6)) {
    throw new AppError('أيام الإغلاق غير صحيحة')
  }
  if (input.closed_days.length >= 7) {
    throw new AppError('لا يمكن إغلاق الموقف كل أيام الأسبوع')
  }
}

/**
 * تعديل التسعيرة الفعّالة.
 *
 * مهم: العمليات السابقة تحتفظ بـ pricing_rule_id الخاص بها، لذلك
 * تعديل السعر لا يغيّر أي فاتورة قديمة — يؤثر فقط على العمليات الجديدة.
 */
export async function updatePricingRule(
  id: string,
  input: PricingInput,
): Promise<PricingRule> {
  validatePricing(input)

  const { data, error } = await supabase
    .from('pricing_rules')
    .update({
      name: input.name.trim(),
      base_amount: input.base_amount,
      base_start_time: input.base_start_time,
      base_end_time: input.base_end_time,
      extra_hour_amount: input.extra_hour_amount,
      rounding_mode: input.rounding_mode,
      grace_minutes: Math.round(input.grace_minutes),
      charge_before_start: input.charge_before_start,
      closed_days: [...input.closed_days].sort((a, b) => a - b),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new AppError(toArabicError(error))
  return data as PricingRule
}

/* ------------------------------ إعدادات عامة ------------------------------ */

export async function getAppSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('app_settings').select('*')
  if (error) throw new AppError(toArabicError(error))

  const result: Record<string, unknown> = {}
  for (const row of (data ?? []) as AppSetting[]) {
    result[row.key] = row.value
  }
  return result
}

export async function setAppSetting(
  key: string,
  value: unknown,
): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' })

  if (error) throw new AppError(toArabicError(error))
}

export function readString(
  settings: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = settings[key]
  return typeof value === 'string' ? value : fallback
}
