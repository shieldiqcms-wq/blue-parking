-- ============================================================================
-- Blue Parking — فحص ما هو موجود حالياً في قاعدة البيانات
-- ----------------------------------------------------------------------------
-- ⚠️ هذا الملف للقراءة فقط — لا يحذف ولا يعدّل أي شيء.
--
-- شغّله أولاً في Supabase > SQL Editor لترى بالضبط ما هو موجود قبل أي حذف.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) كل الجداول في schema public
-- ----------------------------------------------------------------------------
select
  c.relname                                   as "الجدول",
  case
    when c.relname in ('profiles','vehicles','subscriptions','pricing_rules',
                       'parking_sessions','payments','ocr_captures','app_settings')
    then 'يتعارض مع Blue Parking'
    else 'جدول آخر — لن يُحذف'
  end                                          as "التصنيف",
  (select count(*) from pg_attribute a
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as "عدد الأعمدة",
  pg_size_pretty(pg_total_relation_size(c.oid)) as "الحجم"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 2, 1;

-- ----------------------------------------------------------------------------
-- 2) عدد الصفوف في الجداول المتعارضة — لترى إن كان فيها بيانات مهمة
-- ----------------------------------------------------------------------------
select
  c.relname                                  as "الجدول",
  (xpath('/row/c/text()',
     query_to_xml(format('select count(*) as c from public.%I', c.relname),
                  false, true, '')))[1]::text::bigint as "عدد الصفوف"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','vehicles','subscriptions','pricing_rules',
                    'parking_sessions','payments','ocr_captures','app_settings')
order by 2 desc;

-- ⚠️ راجع النتيجة أعلاه. إذا كان أي جدول فيه صفوف تحتاجها، صدّرها قبل الحذف:
--    Supabase > Table Editor > اختر الجدول > Export to CSV

-- ----------------------------------------------------------------------------
-- 3) العروض (Views) المتعارضة
-- ----------------------------------------------------------------------------
select table_name as "العرض"
from information_schema.views
where table_schema = 'public'
  and table_name in ('current_cars_inside','session_details','subscription_status',
                     'daily_revenue_report')
order by 1;

-- ----------------------------------------------------------------------------
-- 4) الدوال المتعارضة
-- ----------------------------------------------------------------------------
select
  p.proname                          as "الدالة",
  pg_get_function_identity_arguments(p.oid) as "المعاملات"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('tg_set_updated_at','tg_vehicles_normalize','tg_handle_new_user',
                    'amman_date','amman_today','normalize_plate','is_owner',
                    'assert_owner','calculate_parking_fee','active_pricing_rule',
                    'active_subscription_for','is_closed_day','lookup_plate',
                    'register_entry','preview_exit','register_exit',
                    'settle_session','log_ocr_capture','get_dashboard','get_report')
order by 1;

-- ----------------------------------------------------------------------------
-- 5) الحسابات الموجودة
-- ----------------------------------------------------------------------------
select
  u.email      as "البريد",
  u.id         as "المعرّف",
  u.created_at as "تاريخ الإنشاء",
  case
    when to_regclass('public.profiles') is null then 'لا يوجد جدول profiles'
    else 'راجع القسم 6'
  end as "ملاحظة"
from auth.users u
order by u.created_at;

-- ----------------------------------------------------------------------------
-- 6) هل جدول profiles الحالي يتبع Blue Parking؟
-- ----------------------------------------------------------------------------
select
  case
    when to_regclass('public.profiles') is null
      then '✅ لا يوجد جدول profiles — يمكنك تشغيل الـ migrations مباشرة'
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
    )
      then '✅ جدول profiles يحتوي عمود role — يبدو أنه من Blue Parking'
    else '⚠️ جدول profiles موجود بلا عمود role — هذا سبب فشل الـ migrations. شغّل 01_reset.sql'
  end as "الخلاصة";
