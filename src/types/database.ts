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
  /** ما دُفع من رسوم الوقوف لحظة الدخول */
  prepaid_amount: number
  prepaid_at: string | null
  prepaid_method: PaymentMethod | null
  /** المبلغ المحصّل فعلاً — null قبل الخروج أو إن كان غير مدفوع */
  amount_collected: number | null
  /** amount_collected − amount_due (سالب = خصم) */
  adjustment: number
  discount_reason: string | null
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
  amount_collected: number | null
  prepaid_amount: number
  adjustment: number
  discount_reason: string | null
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  notes: string | null
  vehicle_id: string
  services_total: number
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
  /** ما حُصِّل لحظة الدخول */
  prepaid_amount: number
  /** الخدمة المضافة في نفس العملية، إن وُجدت */
  service: ServiceRow | null
}

export interface PreviewExitResult {
  session: ParkingSession
  vehicle: Vehicle
  pricing_rule: PricingRule | null
  /** رسوم الوقوف المحسوبة كاملة */
  amount_due: number
  /** ما دُفع لحظة الدخول */
  prepaid_amount: number
  /** المطلوب تحصيله الآن = المستحق − المدفوع مقدماً */
  remaining_amount: number
  services_total: number
  estimated_exit: string
  duration_minutes: number
}

export interface RegisterExitResult {
  session: ParkingSession
  vehicle: Vehicle
  amount_due: number
  prepaid_amount: number
  /** ما حُصِّل لحظة الخروج فقط */
  collected_now: number
  /** المدفوع مقدماً + المحصّل عند الخروج */
  amount_collected: number | null
  adjustment: number
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
  /** المحصّل من الوقوف اليوم */
  parking_today: number
  /** المحصّل من الخدمات اليوم */
  services_today: number
  /** المصاريف المدفوعة اليوم */
  expenses_today: number
  /** ما حُصِّل لحظة الدخول اليوم (جزء من parking_today) */
  prepaid_today: number
  /** الوقوف + الخدمات */
  revenue_today: number
  /** الإجمالي − المصاريف */
  net_today: number
  services_count_today: number
  expenses_count_today: number
  discount_today: number
  unpaid_today: number
  revenue_week: number
  revenue_month: number
  expenses_month: number
  unpaid_total: number
  unpaid_count: number
  active_subscriptions: number
  expiring_subscriptions: number
  total_vehicles: number
}

export interface ReportTotals {
  sessions: number
  /** عدد السيارات الداخلة في الفترة */
  entries: number
  one_time: number
  monthly: number
  paid_count: number
  unpaid_count: number
  waived_count: number
  /** المحصّل من الوقوف (حسب تاريخ قبض النقد) */
  parking_revenue: number
  /** منه ما حُصِّل لحظة الدخول */
  prepaid_total: number
  /** إجمالي ما تمت فوترته قبل الخصم */
  billed_total: number
  /** مجموع الخصومات */
  discount_total: number
  unpaid_amount: number
  services_count: number
  services_revenue: number
  expenses_count: number
  expenses_total: number
  /** مصاريف محمّلة على الموقف */
  expenses_parking: number
  /** مصاريف محمّلة على الغسيل */
  expenses_wash: number
  /** مصاريف مشتركة بين النشاطين */
  expenses_shared: number
  /** الوقوف + الخدمات */
  total_revenue: number
  /** الإجمالي − المصاريف */
  net_revenue: number
  /** دخل الوقوف − مصاريف الموقف (قبل المشترك) */
  parking_net: number
  /** دخل الخدمات − مصاريف الغسيل (قبل المشترك) */
  wash_net: number
}

export interface ReportDay {
  day: string
  /** عدد السيارات الداخلة في هذا اليوم */
  entries: number
  sessions: number
  one_time: number
  monthly: number
  parking_revenue: number
  services_revenue: number
  expenses_total: number
  unpaid_amount: number
}

export interface ReportResult {
  from: string
  to: string
  totals: ReportTotals
  days: ReportDay[]
}

/* ------------------------------------------------------------------ */
/* مقارنة الأسابيع                                                     */
/* ------------------------------------------------------------------ */

export interface WeeklyDay {
  /** 0 = الأحد … 6 = السبت */
  day_index: number
  this_date: string
  last_date: string
  /** null للأيام التي لم تأتِ بعد */
  this_count: number | null
  last_count: number
  this_revenue: number | null
  last_revenue: number
}

export interface WeeklyComparison {
  this_week_start: string
  last_week_start: string
  today: string
  this_week_total: number
  last_week_total: number
  /** نفس عدد الأيام المنقضية من الأسبوع الماضي — للمقارنة العادلة */
  last_week_same_period: number
  days: WeeklyDay[]
}

/* ------------------------------------------------------------------ */
/* الخدمات الإضافية والمصاريف                                          */
/* ------------------------------------------------------------------ */

export type ServiceType = 'wipe' | 'wash' | 'other'
export type ExpenseCategory =
  | 'water'
  | 'electricity'
  | 'staff'
  | 'maintenance'
  | 'other'

export interface ServiceRow {
  id: string
  service_type: ServiceType
  amount: number
  payment_status: 'unpaid' | 'paid' | 'waived'
  payment_method: PaymentMethod | null
  notes: string | null
  performed_at: string
  business_date: string
  session_id: string | null
  vehicle_id: string | null
  plate_number: string | null
  owner_name: string | null
  created_at: string
}

/** على أي نشاط يُحمّل المصروف */
export type CostCenter = 'parking' | 'wash' | 'shared'

export interface ExpenseRow {
  id: string
  category: ExpenseCategory
  cost_center: CostCenter
  amount: number
  notes: string | null
  spent_at: string
  business_date: string
  created_at: string
}
