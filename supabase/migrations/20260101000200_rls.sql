-- ============================================================================
-- Blue Parking — 0003 : سياسات الحماية (Row Level Security)
-- ----------------------------------------------------------------------------
-- المبدأ:
--   1) RLS مفعّل على كل جدول. لا وصول مجهول (anon) لأي بيانات.
--   2) الوصول مشروط بـ is_owner() — أي حساب آخر يُنشأ بصلاحية pending ولا يرى شيئاً.
--   3) جداول المال (parking_sessions / payments) للقراءة فقط من الواجهة.
--      كل كتابة تمر عبر دوال SECURITY DEFINER تحسب المبلغ داخل قاعدة البيانات.
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.vehicles         enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.pricing_rules    enable row level security;
alter table public.parking_sessions enable row level security;
alter table public.payments         enable row level security;
alter table public.ocr_captures     enable row level security;
alter table public.app_settings     enable row level security;

-- منع أي وصول مباشر من الأدوار العامة
revoke all on public.profiles         from anon, authenticated;
revoke all on public.vehicles         from anon, authenticated;
revoke all on public.subscriptions    from anon, authenticated;
revoke all on public.pricing_rules    from anon, authenticated;
revoke all on public.parking_sessions from anon, authenticated;
revoke all on public.payments         from anon, authenticated;
revoke all on public.ocr_captures     from anon, authenticated;
revoke all on public.app_settings     from anon, authenticated;

-- ثم منح الحد الأدنى اللازم للمستخدم المسجّل (و RLS يفلتر فوقه)
grant select                         on public.profiles         to authenticated;
grant select, insert, update, delete on public.vehicles         to authenticated;
grant select, insert, update, delete on public.subscriptions    to authenticated;
grant select, insert, update, delete on public.pricing_rules    to authenticated;
grant select                         on public.parking_sessions to authenticated;
grant select                         on public.payments         to authenticated;
grant select                         on public.ocr_captures     to authenticated;
grant select, insert, update         on public.app_settings     to authenticated;

-- ----------------------------------------------------------------------------
-- profiles — كل حساب يرى ملفه الشخصي فقط، والمالك يرى الجميع
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_self_or_owner" on public.profiles;
create policy "profiles_select_self_or_owner"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());

-- لا توجد سياسة INSERT/UPDATE/DELETE عمداً:
-- إنشاء الملف الشخصي يتم عبر trigger على auth.users،
-- وترقية الصلاحيات تتم من لوحة Supabase فقط.

-- ----------------------------------------------------------------------------
-- vehicles
-- ----------------------------------------------------------------------------
drop policy if exists "vehicles_owner_all" on public.vehicles;
create policy "vehicles_owner_all"
  on public.vehicles for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ----------------------------------------------------------------------------
-- subscriptions
-- ----------------------------------------------------------------------------
drop policy if exists "subscriptions_owner_all" on public.subscriptions;
create policy "subscriptions_owner_all"
  on public.subscriptions for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ----------------------------------------------------------------------------
-- pricing_rules
-- ----------------------------------------------------------------------------
drop policy if exists "pricing_rules_owner_all" on public.pricing_rules;
create policy "pricing_rules_owner_all"
  on public.pricing_rules for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ----------------------------------------------------------------------------
-- parking_sessions — قراءة فقط. الكتابة عبر register_entry / register_exit
-- ----------------------------------------------------------------------------
drop policy if exists "parking_sessions_owner_select" on public.parking_sessions;
create policy "parking_sessions_owner_select"
  on public.parking_sessions for select to authenticated
  using (public.is_owner());

-- ----------------------------------------------------------------------------
-- payments — قراءة فقط. الكتابة عبر register_exit / settle_session
-- ----------------------------------------------------------------------------
drop policy if exists "payments_owner_select" on public.payments;
create policy "payments_owner_select"
  on public.payments for select to authenticated
  using (public.is_owner());

-- ----------------------------------------------------------------------------
-- ocr_captures — قراءة فقط. الكتابة عبر log_ocr_capture
-- ----------------------------------------------------------------------------
drop policy if exists "ocr_captures_owner_select" on public.ocr_captures;
create policy "ocr_captures_owner_select"
  on public.ocr_captures for select to authenticated
  using (public.is_owner());

-- ----------------------------------------------------------------------------
-- app_settings
-- ----------------------------------------------------------------------------
drop policy if exists "app_settings_owner_select" on public.app_settings;
create policy "app_settings_owner_select"
  on public.app_settings for select to authenticated
  using (public.is_owner());

drop policy if exists "app_settings_owner_write" on public.app_settings;
create policy "app_settings_owner_write"
  on public.app_settings for insert to authenticated
  with check (public.is_owner());

drop policy if exists "app_settings_owner_update" on public.app_settings;
create policy "app_settings_owner_update"
  on public.app_settings for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ----------------------------------------------------------------------------
-- العروض (Views) — security_invoker يعني أنها تخضع لسياسات الجداول أعلاه
-- ----------------------------------------------------------------------------
revoke all on public.current_cars_inside  from anon;
revoke all on public.session_details      from anon;
revoke all on public.subscription_status  from anon;

grant select on public.current_cars_inside to authenticated;
grant select on public.session_details     to authenticated;
grant select on public.subscription_status to authenticated;

-- ----------------------------------------------------------------------------
-- منع إنشاء كائنات جديدة في schema public من قبل المستخدمين
-- ----------------------------------------------------------------------------
revoke create on schema public from anon, authenticated;

-- ----------------------------------------------------------------------------
-- الدوال: PostgreSQL يمنح EXECUTE للجميع افتراضياً — نسحبه ثم نمنح بدقة
-- ----------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

grant execute on function public.is_owner()                                   to authenticated;
grant execute on function public.assert_owner()                               to authenticated;
grant execute on function public.normalize_plate(text)                        to authenticated;
grant execute on function public.amman_date(timestamptz)                      to authenticated;
grant execute on function public.amman_today()                                to authenticated;
grant execute on function public.active_pricing_rule()                        to authenticated;
grant execute on function public.is_closed_day(date)                          to authenticated;
grant execute on function public.active_subscription_for(uuid, date)          to authenticated;
grant execute on function public.calculate_parking_fee(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.lookup_plate(text)                           to authenticated;
grant execute on function public.register_entry(text, text, text, text)       to authenticated;
grant execute on function public.preview_exit(uuid)                           to authenticated;
grant execute on function public.register_exit(uuid, text, text, text)        to authenticated;
grant execute on function public.settle_session(uuid, text, text)             to authenticated;
grant execute on function public.log_ocr_capture(text, text, numeric, text, uuid) to authenticated;
grant execute on function public.get_dashboard()                              to authenticated;
grant execute on function public.get_report(date, date)                       to authenticated;

-- دوال الـ triggers (لا تُستدعى مباشرة، لكن نتركها متاحة للدور المسجّل)
grant execute on function public.tg_set_updated_at()      to authenticated;
grant execute on function public.tg_vehicles_normalize()  to authenticated;

-- ----------------------------------------------------------------------------
-- تأكيد نهائي: لا صلاحيات إطلاقاً للدور المجهول
-- ----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
