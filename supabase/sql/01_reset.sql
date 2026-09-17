-- ============================================================================
-- Blue Parking — حذف الكائنات المتعارضة قبل تثبيت النظام
-- ============================================================================
--
--   ⚠️⚠️  تحذير: هذا الملف يحذف بيانات نهائياً  ⚠️⚠️
--
--   شغّل `00_inspect.sql` أولاً وراجع عدد الصفوف في كل جدول.
--   إذا كان فيها بيانات تحتاجها، صدّرها قبل الحذف:
--      Supabase > Table Editor > الجدول > Export to CSV
--
-- ----------------------------------------------------------------------------
-- ما يحذفه هذا الملف:
--   • جداول Blue Parking الثمانية فقط (بالاسم، واحداً واحداً)
--   • عروض ودوال Blue Parking
--   • trigger إنشاء الحساب على auth.users
--
-- ما لا يمسّه:
--   • أي جدول آخر في schema public لا ينتمي لهذا النظام
--   • حسابات auth.users — تبقى كما هي، ولا تحتاج إعادة إنشاء أبو حمدان
--   • schema auth و storage و أي شيء خاص بـ Supabase
-- ----------------------------------------------------------------------------
-- بعد تشغيل هذا الملف، شغّل الـ migrations الثلاثة بالترتيب.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) trigger على auth.users
-- ----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

-- ----------------------------------------------------------------------------
-- 2) العروض (قبل الجداول لأنها تعتمد عليها)
-- ----------------------------------------------------------------------------
drop view if exists public.current_cars_inside  cascade;
drop view if exists public.session_details      cascade;
drop view if exists public.subscription_status  cascade;
drop view if exists public.daily_revenue_report cascade;

-- ----------------------------------------------------------------------------
-- 3) الجداول — بالترتيب العكسي للعلاقات
-- ----------------------------------------------------------------------------
drop table if exists public.ocr_captures     cascade;
drop table if exists public.payments         cascade;
drop table if exists public.parking_sessions cascade;
drop table if exists public.subscriptions    cascade;
drop table if exists public.vehicles         cascade;
drop table if exists public.pricing_rules    cascade;
drop table if exists public.app_settings     cascade;
drop table if exists public.profiles         cascade;

-- ----------------------------------------------------------------------------
-- 4) الدوال — كل التوقيعات المحتملة، بما فيها نسخ قديمة
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'tg_set_updated_at', 'tg_vehicles_normalize', 'tg_handle_new_user',
        'amman_date', 'amman_today', 'normalize_plate',
        'is_owner', 'assert_owner',
        'calculate_parking_fee', 'active_pricing_rule', 'active_subscription_for',
        'is_closed_day',
        'lookup_plate', 'register_entry', 'preview_exit', 'register_exit',
        'settle_session', 'log_ocr_capture',
        'get_dashboard', 'get_report'
      )
  loop
    execute format('drop function if exists %s cascade', r.sig);
    raise notice 'حُذفت الدالة: %', r.sig;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5) التحقق — يجب أن تكون كل النتائج صفراً
-- ----------------------------------------------------------------------------
select 'جداول Blue Parking المتبقية' as "الفحص", count(*) as "يجب أن يكون صفراً"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('profiles','vehicles','subscriptions','pricing_rules',
                    'parking_sessions','payments','ocr_captures','app_settings')
union all
select 'دوال Blue Parking المتبقية', count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('amman_date','amman_today','normalize_plate','is_owner',
                    'assert_owner','calculate_parking_fee','register_entry',
                    'register_exit','get_dashboard','get_report');

-- ----------------------------------------------------------------------------
-- 6) الحسابات الباقية — أبو حمدان يبقى موجوداً
-- ----------------------------------------------------------------------------
select email as "الحسابات الباقية", created_at as "تاريخ الإنشاء"
from auth.users
order by created_at;

-- ============================================================================
-- الخطوة التالية: شغّل الـ migrations الثلاثة بالترتيب
--   1) supabase/migrations/20260101000000_schema.sql
--   2) supabase/migrations/20260101000100_functions.sql
--   3) supabase/migrations/20260101000200_rls.sql
--
-- ملاحظة: الملف الأول سيُنشئ ملفاً شخصياً بصلاحية owner لأول حساب في المشروع.
--         إذا كان عندك أكثر من حساب، شغّل promote_owner.sql بعدها لتحديد المالك.
-- ============================================================================
