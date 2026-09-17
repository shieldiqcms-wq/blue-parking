-- ============================================================================
-- Blue Parking — فحص سلامة النظام
-- ----------------------------------------------------------------------------
-- ملف قراءة فقط — لا يعدّل أي بيانات.
--
-- الاستخدام: Supabase Dashboard > SQL Editor > الصق الملف كاملاً > Run
--
-- ملاحظة مهمة: SQL Editor يعرض نتيجة آخر استعلام فقط، لذلك كل الفحوص
--              مدمجة في جدول واحد. اقرأ عمود «النتيجة»:
--                ✅ = صح    ❌ = مشكلة    ℹ️ = للعلم فقط
-- ============================================================================

-- ---------------------------------------------------------------------------
-- فحص أولي: هل النظام مثبّت؟ (يتوقف بوضوح إن لم يكن)
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
  r record;
begin
  for r in
    select * from (values
      ('profiles'), ('vehicles'), ('subscriptions'), ('pricing_rules'),
      ('parking_sessions'), ('payments'), ('ocr_captures'), ('app_settings')
    ) t(tbl)
  loop
    if to_regclass('public.' || quote_ident(r.tbl)) is null then
      v_missing := v_missing || r.tbl;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception
      E'النظام غير مثبّت بعد — الجداول التالية غير موجودة: %\n'
      'شغّل أولاً: supabase/sql/INSTALL.sql\n'
      'ثم أعد تشغيل هذا الملف.',
      array_to_string(v_missing, ', ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- كل الفحوص في جدول واحد
-- ---------------------------------------------------------------------------
with

-- 1) الحماية: RLS مفعّل + توجد سياسة على كل جدول ------------------------------
rls_check as (
  select
    '1. الحماية (RLS)'                                        as category,
    c.relname                                                 as check_name,
    'مفعّل + سياسة واحدة على الأقل'                            as expected,
    (case when c.relrowsecurity then 'مفعّل' else 'غير مفعّل' end)
      || ' — '
      || (select count(*) from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname)::text
      || ' سياسة'                                             as actual,
    (case
      when c.relrowsecurity and exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      ) then '✅' else '❌'
    end)                                                      as result,
    10                                                        as ord1,
    c.relname                                                 as ord2
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('profiles','vehicles','subscriptions','pricing_rules',
                      'parking_sessions','payments','ocr_captures','app_settings')
),

-- 2) الحسابات ---------------------------------------------------------------
owner_count as (
  select
    '2. الحسابات',
    'عدد حسابات المالك',
    'حساب واحد',
    (select count(*) from public.profiles where role = 'owner')::text || ' حساب',
    case when (select count(*) from public.profiles where role = 'owner') = 1
         then '✅' else '❌' end,
    20,
    '0'
),
accounts as (
  select
    '2. الحسابات',
    coalesce(u.email, u.id::text),
    '—',
    case p.role
      when 'owner'   then 'المالك (صلاحية كاملة)'
      when 'pending' then 'بلا صلاحية'
      when 'staff'   then 'موظف'
      else '⚠️ لا يوجد ملف شخصي'
    end,
    case when p.role is null then '❌' else 'ℹ️' end,
    20,
    '1' || coalesce(u.email, '')
  from auth.users u
  left join public.profiles p on p.id = u.id
),

-- 3) التسعيرة ---------------------------------------------------------------
rule as (
  select * from public.pricing_rules where is_active limit 1
),
pricing as (
  select '3. التسعيرة', 'المبلغ الأساسي', '1.00 د.أ',
         to_char(r.base_amount, 'FM990.00') || ' د.أ',
         case when r.base_amount = 1.00 then '✅' else 'ℹ️' end, 30, '1'
  from rule r
  union all
  select '3. التسعيرة', 'فترة الدوام', '08:00 – 15:00',
         to_char(r.base_start_time, 'HH24:MI') || ' – ' || to_char(r.base_end_time, 'HH24:MI'),
         case when r.base_start_time = '08:00' and r.base_end_time = '15:00'
              then '✅' else 'ℹ️' end, 30, '2'
  from rule r
  union all
  select '3. التسعيرة', 'مبلغ الساعة الإضافية', '1.00 د.أ',
         to_char(r.extra_hour_amount, 'FM990.00') || ' د.أ',
         case when r.extra_hour_amount = 1.00 then '✅' else 'ℹ️' end, 30, '3'
  from rule r
  union all
  select '3. التسعيرة', 'فترة السماح', '15 دقيقة',
         r.grace_minutes::text || ' دقيقة',
         case when r.grace_minutes = 15 then '✅' else 'ℹ️' end, 30, '4'
  from rule r
  union all
  select '3. التسعيرة', 'جزء الساعة', 'ساعة كاملة',
         case r.rounding_mode when 'ceil_hour' then 'ساعة كاملة'
                              else 'حساب دقيق بالدقائق' end,
         case when r.rounding_mode = 'ceil_hour' then '✅' else 'ℹ️' end, 30, '5'
  from rule r
  union all
  select '3. التسعيرة', 'احتساب الدخول قبل الثامنة', 'نعم',
         case when r.charge_before_start then 'نعم' else 'لا' end,
         case when r.charge_before_start then '✅' else 'ℹ️' end, 30, '6'
  from rule r
  union all
  select '3. التسعيرة', 'أيام الإغلاق', 'الجمعة والسبت',
         (select coalesce(string_agg(
            case d when 0 then 'الأحد' when 1 then 'الإثنين' when 2 then 'الثلاثاء'
                   when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
                   else 'السبت' end, ' و ' order by d), 'لا يوجد')
          from unnest(r.closed_days) d),
         case when r.closed_days @> '{5,6}'::smallint[]
               and array_length(r.closed_days, 1) = 2
              then '✅' else 'ℹ️' end, 30, '7'
  from rule r
),

-- 4) محرك حساب الرسوم -------------------------------------------------------
fees as (
  select
    '4. حساب الرسوم',
    t.label,
    to_char(t.expected, 'FM990.00') || ' د.أ',
    to_char(public.calculate_parking_fee(
      (('2026-06-01 ' || t.entry_t)::timestamp at time zone 'Asia/Amman'),
      (('2026-06-01 ' || t.exit_t)::timestamp  at time zone 'Asia/Amman'),
      (select id from rule)
    ), 'FM990.00') || ' د.أ',
    case when public.calculate_parking_fee(
      (('2026-06-01 ' || t.entry_t)::timestamp at time zone 'Asia/Amman'),
      (('2026-06-01 ' || t.exit_t)::timestamp  at time zone 'Asia/Amman'),
      (select id from rule)
    ) = t.expected then '✅' else '❌' end,
    40,
    t.sort
  from (values
    ('08:00 ← 14:00  داخل الدوام',          '08:00', '14:00', 1.00, 'a'),
    ('09:00 ← 15:00  آخر الدوام',           '09:00', '15:00', 1.00, 'b'),
    ('09:00 ← 15:15  داخل السماح',          '09:00', '15:15', 1.00, 'c'),
    ('09:00 ← 15:16  تجاوز السماح',         '09:00', '15:16', 2.00, 'd'),
    ('09:00 ← 15:30',                       '09:00', '15:30', 2.00, 'e'),
    ('09:00 ← 16:00  ساعة كاملة',           '09:00', '16:00', 2.00, 'f'),
    ('09:00 ← 16:01  جزء ساعة = ساعة',      '09:00', '16:01', 3.00, 'g'),
    ('09:00 ← 20:00  خمس ساعات',            '09:00', '20:00', 6.00, 'h'),
    ('16:00 ← 17:00  دخول بعد الدوام',      '16:00', '17:00', 2.00, 'i'),
    ('07:00 ← 14:00  دخول مبكر ساعة',       '07:00', '14:00', 2.00, 'j'),
    ('07:30 ← 14:00  دخول مبكر نصف ساعة',   '07:30', '14:00', 2.00, 'k'),
    ('06:00 ← 14:00  دخول مبكر ساعتان',     '06:00', '14:00', 3.00, 'l'),
    ('07:00 ← 16:00  مبكر + متأخر',         '07:00', '16:00', 3.00, 'm')
  ) t(label, entry_t, exit_t, expected, sort)
),

-- 5) أيام الإغلاق -----------------------------------------------------------
closed as (
  select
    '5. أيام الإغلاق',
    trim(to_char(g.d::date, 'Day')) || ' — ' || to_char(g.d::date, 'YYYY-MM-DD'),
    case when extract(dow from g.d::date) in (5,6) then 'مغلق' else 'دوام' end,
    case when public.is_closed_day(g.d::date) then 'مغلق' else 'دوام' end,
    case when public.is_closed_day(g.d::date)
            = (extract(dow from g.d::date) in (5,6))
         then '✅' else '❌' end,
    50,
    to_char(g.d::date, 'YYYY-MM-DD')
  from generate_series(
    public.amman_today(), public.amman_today() + 6, interval '1 day'
  ) g(d)
),

-- 6) توحيد أرقام اللوحات ----------------------------------------------------
plates as (
  select
    '6. توحيد اللوحات',
    t.input,
    t.expected,
    coalesce(public.normalize_plate(t.input), '(فارغ)'),
    case when public.normalize_plate(t.input) = t.expected then '✅' else '❌' end,
    60,
    t.sort
  from (values
    ('12-34567',  '1234567', 'a'),
    ('12 34567',  '1234567', 'b'),
    (' 12/34567 ','1234567', 'c'),
    ('١٢-٣٤٥٦٧',  '1234567', 'd'),
    ('۱۲-۳۴۵۶۷',  '1234567', 'e'),
    ('21-abc-99', '21ABC99', 'f')
  ) t(input, expected, sort)
),

-- 7) سلامة البيانات ---------------------------------------------------------
integrity as (
  select '7. سلامة البيانات', 'سيارات لها أكثر من عملية نشطة', 'صفر',
         (select count(*) from (
            select vehicle_id from public.parking_sessions
            where exit_time is null group by vehicle_id having count(*) > 1
          ) x)::text,
         case when (select count(*) from (
            select vehicle_id from public.parking_sessions
            where exit_time is null group by vehicle_id having count(*) > 1
          ) x) = 0 then '✅' else '❌' end, 70, 'a'
  union all
  select '7. سلامة البيانات', 'عمليات خروجها قبل دخولها', 'صفر',
         (select count(*) from public.parking_sessions
          where exit_time is not null and exit_time < entry_time)::text,
         case when (select count(*) from public.parking_sessions
          where exit_time is not null and exit_time < entry_time) = 0
         then '✅' else '❌' end, 70, 'b'
  union all
  select '7. سلامة البيانات', 'اشتراكات بتواريخ غير صحيحة', 'صفر',
         (select count(*) from public.subscriptions where end_date < start_date)::text,
         case when (select count(*) from public.subscriptions
          where end_date < start_date) = 0 then '✅' else '❌' end, 70, 'c'
  union all
  select '7. سلامة البيانات', 'اشتراكات شهرية عليها رسوم', 'صفر',
         (select count(*) from public.parking_sessions
          where session_type = 'monthly' and amount_due <> 0)::text,
         case when (select count(*) from public.parking_sessions
          where session_type = 'monthly' and amount_due <> 0) = 0
         then '✅' else '❌' end, 70, 'd'
  union all
  select '7. سلامة البيانات', 'مبالغ سالبة', 'صفر',
         (select count(*) from public.parking_sessions where amount_due < 0)::text,
         case when (select count(*) from public.parking_sessions
          where amount_due < 0) = 0 then '✅' else '❌' end, 70, 'e'
),

-- 8) عدم تعرّض أي شيء للدور المجهول ------------------------------------------
exposure as (
  select '8. الدور المجهول (anon)', 'دوال متاحة لـ anon', 'صفر',
         (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'execute'))::text,
         case when (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'execute')) = 0
         then '✅' else '❌' end, 80, 'a'
  union all
  select '8. الدور المجهول (anon)', 'جداول متاحة لـ anon', 'صفر',
         (select count(*) from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (has_table_privilege('anon', c.oid, 'select')
              or has_table_privilege('anon', c.oid, 'insert')
              or has_table_privilege('anon', c.oid, 'update')
              or has_table_privilege('anon', c.oid, 'delete')))::text,
         case when (select count(*) from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (has_table_privilege('anon', c.oid, 'select')
              or has_table_privilege('anon', c.oid, 'insert')
              or has_table_privilege('anon', c.oid, 'update')
              or has_table_privilege('anon', c.oid, 'delete'))) = 0
         then '✅' else '❌' end, 80, 'b'
),

-- 9) البيانات الحالية (للعلم) ------------------------------------------------
data_counts as (
  select '9. البيانات الحالية', 'سيارات مسجّلة', '—',
         (select count(*) from public.vehicles)::text, 'ℹ️', 90, 'a'
  union all
  select '9. البيانات الحالية', 'سيارات داخل الموقف الآن', '—',
         (select count(*) from public.parking_sessions where exit_time is null)::text,
         'ℹ️', 90, 'b'
  union all
  select '9. البيانات الحالية', 'اشتراكات سارية', '—',
         (select count(*) from public.subscriptions
          where status = 'active'
            and start_date <= public.amman_today()
            and end_date >= public.amman_today())::text, 'ℹ️', 90, 'c'
  union all
  select '9. البيانات الحالية', 'عمليات مكتملة', '—',
         (select count(*) from public.parking_sessions
          where exit_time is not null)::text, 'ℹ️', 90, 'd'
),

all_checks as (
  select * from rls_check
  union all select * from owner_count
  union all select * from accounts
  union all select * from pricing
  union all select * from fees
  union all select * from closed
  union all select * from plates
  union all select * from integrity
  union all select * from exposure
  union all select * from data_counts
)

select
  category   as "القسم",
  check_name as "الفحص",
  expected   as "المتوقع",
  actual     as "الفعلي",
  result     as "النتيجة"
from all_checks
order by ord1, ord2;

-- ============================================================================
-- كيف تقرأ النتيجة:
--
--   ✅  صح — لا شيء مطلوب
--   ℹ️  للعلم فقط (قيمة معلوماتية أو إعداد عدّلته بنفسك)
--   ❌  مشكلة — راجعها قبل الاستخدام الفعلي
--
-- الأهم:
--   • القسم 1: كل الجداول الثمانية يجب أن تكون ✅
--   • القسم 2: «عدد حسابات المالك» = حساب واحد، وبريدك يظهر بـ «المالك»
--   • القسم 4: كل الحالات الـ 13 يجب أن تكون ✅
--   • القسم 8: كلا السطرين يجب أن يكونا ✅ (صفر تعرّض للمجهول)
-- ============================================================================
