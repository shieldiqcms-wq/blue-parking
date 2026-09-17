import { supabase } from '@/lib/supabase'
import { AppError, toArabicError } from '@/lib/errors'
import type { DashboardStats, ReportResult } from '@/types/database'

export async function getDashboard(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard')
  if (error) throw new AppError(toArabicError(error))
  return data as DashboardStats
}

export async function getReport(from: string, to: string): Promise<ReportResult> {
  if (!from || !to) throw new AppError('يجب تحديد تاريخ البداية والنهاية')
  if (to < from) {
    throw new AppError('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية')
  }

  const { data, error } = await supabase.rpc('get_report', {
    p_from: from,
    p_to: to,
  })

  if (error) throw new AppError(toArabicError(error))
  return data as ReportResult
}
