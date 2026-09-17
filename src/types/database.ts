/**
 * أنواع البيانات المطابقة لمخطط قاعدة البيانات في Supabase.
 * المصدر: supabase/migrations/*.sql
 */

export type SessionType = 'one_time' | 'monthly'
export type PaymentStatus = 'not_required' | 'unpaid' | 'paid' | 'waived'
export type PaymentMethod = 'cash' | 'transfer' | 'other'
export type SubscriptionStatus = 'active' | 'cancelled'
export type ComputedSubscriptionStatus =
  | 'active'
  | 'expired'
  | 'upcoming'
  | 'cancelled'
export type UserRole = 'owner' | 'staff' | 'pending'
export type RoundingMode = 'ceil_hour' | 'exact_minutes'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  created_at: string
  updated_at: string
}

export interface Vehicle {
  id: string
  plate_number: string
  plate_normalized: string
  owner_name: string | null
  phone: string | null
  vehicle_type: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  vehicle_id: string
  start_date: string
  end_date: string
  status: SubscriptionStatus
  monthly_amount: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SubscriptionRow {
  id: string
  vehicle_id: string
  plate_number: string
  plate_normalized: string
  owner_name: string | null
  phone: string | null
  start_date: string
  end_date: string
  monthly_amount: number | null
  notes: string | null
  raw_status: SubscriptionStatus
  computed_status: ComputedSubscriptionStatus
  days_left: number
  created_at: string
}

export interface ParkingSession {
  id: string
  vehicle_id: string
  session_type: SessionType
  entry_time: string
  exit_time: string | null
  pricing_rule_id: string | null
  subscription_id: string | null
  amount_due: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CarInside {
  session_id: string
  vehicle_id: string
  plate_number: string
  plate_normalized: string
  owner_name: string | null
  phone: string | null
  session_type: SessionType
  entry_time: string
  notes: string | null
  subscription_end_date: string | null
}

export interface SessionDetail {
  id: string
  plate_number: string
  owner_name: string | null
  phone: string | null
  session_type: SessionType
  entry_time: string
  exit_time: string | null
  business_date: string
  duration_minutes: number | null
  amount_due: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  notes: string | null
  created_at: string
}

export interface PricingRule {
  id: string
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
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AppSetting {
  key: string
  value: unknown
  description: string | null
  updated_by: string | null
  updated_at: string
}

/* ------------------------------------------------------------------ */
/* مخرجات دوال RPC                                                     */
/* ------------------------------------------------------------------ */

export interface LookupPlateResult {
  found: boolean
  normalized: string | null
  vehicle: Vehicle | null
  subscription: Subscription | null
  active_session: ParkingSession | null
  is_closed_day: boolean
}

export interface RegisterEntryResult {
  session: ParkingSession
  vehicle: Vehicle
  subscription: Subscription | null
  is_new_vehicle: boolean
}

export interface PreviewExitResult {
  session: ParkingSession
  vehicle: Vehicle
  pricing_rule: PricingRule | null
  amount_due: number
  estimated_exit: string
  duration_minutes: number
}

export interface RegisterExitResult {
  session: ParkingSession
  vehicle: Vehicle
  amount_due: number
  payment_status: PaymentStatus
}

export interface DashboardStats {
  today: string
  is_closed_day: boolean
  cars_inside: number
  entries_today: number
  exits_today: number
  one_time_today: number
  monthly_today: number
  revenue_today: number
  unpaid_today: number
  revenue_week: number
  revenue_month: number
  unpaid_total: number
  unpaid_count: number
  active_subscriptions: number
  expiring_subscriptions: number
  total_vehicles: number
}

export interface ReportTotals {
  sessions: number
  one_time: number
  monthly: number
  paid_count: number
  unpaid_count: number
  waived_count: number
  revenue_paid: number
  unpaid_amount: number
  total_due: number
}

export interface ReportDay {
  day: string
  sessions: number
  one_time: number
  monthly: number
  revenue_paid: number
  unpaid_amount: number
}

export interface ReportResult {
  from: string
  to: string
  totals: ReportTotals
  days: ReportDay[]
}
