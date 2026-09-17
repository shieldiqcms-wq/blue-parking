-- ============================================================================
-- Blue Parking — فحص سلامة النظام
-- ----------------------------------------------------------------------------
-- ملف قراءة فقط (ما عدا القسم 5 الذي لا يكتب شيئاً أيضاً).
-- شغّله في Supabase > SQL Editor بعد تطبيق الـ migrations للتأكد من أن كل شيء
-- مضبوط كما يجب. لا يعدّل أي بيانات.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) الجداول: RLS مفعّل + توجد سياسات
-- ----------------------------------------------------------------------------
select
  c.relname                                            as "الجدول",
  case when c.relrowsecurity then 'نعم' else '⚠️ لا' end as "RLS مفعّل",
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as "عدد السياسات"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','vehicles','subscriptions','pricing_rules',
                    'parking_sessions','payments','ocr_captures','app_settings')
order by c.relname;

-- المتوقع: كل الجداول "نعم" وعدد السياسات >= 1

-- ----------------------------------------------------------------------------
-- 2) الحسابات وصلاحياتها — يجب أن يكون هناك حساب owner واحد فقط
-- ----------------------------------------------------------------------------
select
  u.email                       as "البريد",
  coalesce(p.role, '⚠️ بلا ملف') as "الصلاحية",
  p.full_name                   as "الاسم",
  u.created_at                  as "تاريخ الإنشاء"
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at;

-- ----------------------------------------------------------------------------
-- 3) التسعيرة الفعّالة
-- ----------------------------------------------------------------------------
select
  name                as "اسم التسعيرة",
  base_amount         as "المبلغ الأساسي",
  base_start_time     as "بداية الدوام",
  base_end_time       as "نهاية الدوام",
  extra_hour_amount   as "الساعة الإضافية",
  rounding_mode       as "طريقة التقريب",
  grace_minutes       as "فترة السماح",
  charge_before_start as "احتساب الدخول المبكر",
  closed_days         as "أيام الإغلاق"
from public.pricing_rules
where is_active;

-- المتوقع: صف واحد
--   1.00 / 08:00 / 15:00 / 1.00 / ceil_hour / 15 / true / {5,6}

-- أيام الإغلاق: 0=الأحد 1=الإثنين 2=الثلاثاء 3=الأربعاء 4=الخميس 5=الجمعة 6=السبت
select g.d::date                       as "التاريخ",
       trim(to_char(g.d::date, 'Day')) as "اليوم",
       public.is_closed_day(g.d::date) as "يوم إغلاق"
from generate_series(
  public.amman_today(), public.amman_today() + 6, interval '1 day'
) g(d);

-- المتوقع: الجمعة والسبت فقط = true

-- ----------------------------------------------------------------------------
-- 4) اختبار محرك الحساب على الحالات المعتمدة
-- ----------------------------------------------------------------------------
select
  label                                    as "الحالة",
  expected                                 as "المتوقع",
  actual                                   as "الفعلي",
  case when actual = expected then '✅ صح' else '❌ خطأ' end as "النتيجة"
from (
  select
    t.label,
    t.expected,
    public.calculate_parking_fee(
      (('2026-06-01 ' || t.entry_t)::timestamp at time zone 'Asia/Amman'),
      (('2026-06-01 ' || t.exit_t)::timestamp  at time zone 'Asia/Amman'),
      (select id from public.pricing_rules where is_active limit 1)
    ) as actual
  from (values
    -- داخل فترة الدوام => المبلغ الأساسي فقط
    ('دخول 08:00 → خروج 14:00',            '08:00', '14:00', 1.00),
    ('دخول 09:00 → خروج 15:00',            '09:00', '15:00', 1.00),
    -- فترة السماح 15 دقيقة بعد الثالثة
    ('دخول 09:00 → خروج 15:15 (سماح)',     '09:00', '15:15', 1.00),
    ('دخول 09:00 → خروج 15:16 (تجاوز)',    '09:00', '15:16', 2.00),
    ('دخول 09:00 → خروج 15:30',            '09:00', '15:30', 2.00),
    ('دخول 09:00 → خروج 16:00',            '09:00', '16:00', 2.00),
    ('دخول 09:00 → خروج 16:01',            '09:00', '16:01', 3.00),
    ('دخول 09:00 → خروج 20:00',            '09:00', '20:00', 6.00),
    -- دخول بعد الثالثة => الحساب من لحظة الدخول
    ('دخول 16:00 → خروج 17:00',            '16:00', '17:00', 2.00),
    -- دخول قبل الثامنة => يُحاسب
    ('دخول 07:00 → خروج 14:00 (مبكر)',     '07:00', '14:00', 2.00),
    ('دخول 07:30 → خروج 14:00 (مبكر)',     '07:30', '14:00', 2.00),
    ('دخول 06:00 → خروج 14:00 (مبكر)',     '06:00', '14:00', 3.00),
    ('دخول 07:00 → خروج 16:00 (مبكر+متأخر)','07:00', '16:00', 3.00)
  ) t(label, entry_t, exit_t, expected)
) q;

-- ----------------------------------------------------------------------------
-- 5) توحيد أرقام اللوحات
-- ----------------------------------------------------------------------------
select input as "المُدخل", public.normalize_plate(input) as "الموحّد"
from (values
  ('12-34567'), ('12 34567'), (' 12/34567 '),
  ('١٢-٣٤٥٦٧'), ('۱۲-۳۴۵۶۷'), ('21-abc-99')
) v(input);

-- المتوقع: أول خمس حالات تعطي 1234567 والأخيرة 21ABC99

-- ----------------------------------------------------------------------------
-- 6) سلامة البيانات — يجب أن تكون كل النتائج صفراً
-- ----------------------------------------------------------------------------
select 'سيارات لها أكثر من عملية نشطة' as "الفحص", count(*) as "يجب أن يكون صفراً"
from (
  select vehicle_id from public.parking_sessions
  where exit_time is null group by vehicle_id having count(*) > 1
) x
union all
select 'عمليات خروجها قبل دخولها', count(*)
from public.parking_sessions where exit_time is not null and exit_time < entry_time
union all
select 'اشتراكات بتواريخ غير صحيحة', count(*)
from public.subscriptions where end_date < start_date
union all
select 'اشتراكات شهرية عليها رسوم', count(*)
from public.parking_sessions where session_type = 'monthly' and amount_due <> 0
union all
select 'مبالغ سالبة', count(*)
from public.parking_sessions where amount_due < 0;

-- ----------------------------------------------------------------------------
-- 7) الدوال المتاحة للمستخدم المسجّل
-- ----------------------------------------------------------------------------
select
  p.proname as "الدالة",
  case when has_function_privilege('authenticated', p.oid, 'execute')
       then 'نعم' else 'لا' end as "متاحة للمسجّل",
  case when has_function_privilege('anon', p.oid, 'execute')
       then '⚠️ نعم' else 'لا' end as "متاحة للمجهول"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- المتوقع: عمود "متاحة للمجهول" = لا في كل الصفوف
