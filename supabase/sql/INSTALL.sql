-- ==============================================================================
-- Blue Parking — ملف التثبيت الكامل
-- ==============================================================================
--
-- ⚠️  هذا الملف مُولَّد تلقائياً من supabase/migrations — لا تعدّله يدوياً.
--     لإعادة توليده:  npm run db:bundle
--
-- طريقة الاستخدام:
--   1) Supabase Dashboard > SQL Editor > New query
--   2) الصق كامل محتوى هذا الملف
--   3) Run
--   4) ثم شغّل supabase/tests/verify.sql للتأكد
--
-- ملاحظة: إذا كانت القاعدة تحتوي جداول قديمة بنفس الأسماء، سيتوقف التنفيذ
--         برسالة واضحة. في هذه الحالة شغّل 00_inspect.sql ثم 01_reset.sql.
--
-- الملفات المدمجة (4):
--   1) 20260101000000_schema.sql
--   2) 20260101000100_functions.sql
--   3) 20260101000200_rls.sql
--   4) 20260101000300_services_expenses.sql
-- ==============================================================================


-- ==============================================================================
-- ملف: 20260101000000_schema.sql
-- ==============================================================================

-- ============================================================================
-- Blue Parking — 0001 : المخطط الأساسي (Schema)
-- ----------------------------------------------------------------------------
-- نظام إدارة موقف سيارات — الأردن — الدينار الأردني (JOD)
-- مالك واحد فقط. كل الأوقات تُخزّن UTC وتُحسب بتوقيت Asia/Amman.
-- كل المبالغ numeric(10,2) — لا يوجد أي حساب بـ float.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. فحص أولي — يمنع رسائل خطأ مبهمة إذا كانت القاعدة تحتوي جداول قديمة
-- ----------------------------------------------------------------------------
-- ملاحظة: `create table if not exists` يتخطّى الإنشاء إذا وُجد جدول بنفس
-- الاسم، فيبقى الجدول القديم بأعمدته القديمة ويفشل أول فهرس يعتمد على عمود
-- غير موجود. هذا الفحص يحوّل ذلك إلى رسالة واضحة.
do $$
declare
  v_conflicts text[] := '{}';
  r record;
begin
  for r in
    select * from (values
      ('profiles',         'role'),
      ('vehicles',         'plate_normalized'),
      ('subscriptions',    'vehicle_id'),
      ('pricing_rules',    'base_amount'),
      ('parking_sessions', 'session_type'),
      ('payments',         'session_id'),
      ('ocr_captures',     'detected_plate'),
      ('app_settings',     'key')
    ) t(tbl, required_column)
  loop
    if to_regclass('public.' || quote_ident(r.tbl)) is not null
       and not exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = r.tbl
           and column_name = r.required_column
       )
    then
      v_conflicts := v_conflicts || r.tbl;
    end if;
  end loop;

  if array_length(v_conflicts, 1) > 0 then
    raise exception
      E'يوجد جدول/جداول قديمة بنفس الأسماء لكن ببنية مختلفة: %\n'
      'شغّل supabase/sql/00_inspect.sql لمراجعتها، ثم supabase/sql/01_reset.sql لحذفها، '
      'ثم أعد تشغيل هذا الملف.',
      array_to_string(v_conflicts, ', ');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 0b. دوال مساعدة عامة
-- ----------------------------------------------------------------------------

-- تحديث updated_at تلقائياً
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- تحويل وقت UTC إلى تاريخ محلي بتوقيت عمّان
create or replace function public.amman_date(p_ts timestamptz)
returns date
language sql
immutable
strict
as $$
  select (p_ts at time zone 'Asia/Amman')::date;
$$;

comment on function public.amman_date(timestamptz)
  is 'يحوّل طابعاً زمنياً إلى التاريخ المحلي في الأردن (Asia/Amman).';

-- ----------------------------------------------------------------------------
-- توحيد رقم اللوحة (Plate normalization)
-- ----------------------------------------------------------------------------
-- يُستخدم للبحث والمطابقة فقط. الرقم الأصلي كما أدخله المستخدم يبقى محفوظاً.
--
-- ما الذي يفعله:
--   * تحويل الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) إلى 0-9
--   * توحيد صور الألف: أ إ آ ٱ  ->  ا
--   * توحيد الألف المقصورة: ى -> ي
--   * حذف المسافات والشرطات والنقاط وأي رمز غير حرف/رقم
--   * حذف التطويل (ـ) والتشكيل
--   * تحويل الحروف اللاتينية إلى Uppercase
--
-- ما الذي لا يفعله عمداً (تفادياً لدمج لوحتين مختلفتين):
--   * لا يحوّل ة -> ه   ولا  ؤ/ئ -> و/ي
--   * لا يحذف الأصفار البادئة
-- ----------------------------------------------------------------------------
create or replace function public.normalize_plate(p_plate text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      regexp_replace(
        translate(
          coalesce(p_plate, ''),
          '٠١٢٣٤٥٦٧٨٩' || '۰۱۲۳۴۵۶۷۸۹' || 'أإآٱ' || 'ى',
          '0123456789' || '0123456789' || 'اااا' || 'ي'
        ),
        -- نبقي فقط: أرقام + حروف لاتينية + حروف عربية (ء..غ و ف..ي)
        -- المستثنى تلقائياً: التطويل U+0640 والتشكيل U+064B..U+0652
        '[^0-9A-Za-zء-غف-ي]+',
        '',
        'g'
      )
    ),
    ''
  );
$$;

comment on function public.normalize_plate(text)
  is 'يوحّد رقم اللوحة للبحث والمطابقة. الرقم الأصلي يبقى كما أُدخل.';

-- ----------------------------------------------------------------------------
-- 1. profiles — حسابات النظام
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default 'أبو حمدان',
  role        text not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_role_valid check (role in ('owner', 'staff', 'pending'))
);

comment on table public.profiles is
  'حسابات النظام. role=owner هو المالك الوحيد صاحب الصلاحية الكاملة. '
  'role=pending هو حساب مسجّل بلا أي صلاحية على بيانات الموقف.';

create index if not exists profiles_role_idx on public.profiles(role);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- تفعيل المالك تلقائياً: أول حساب يُنشأ في المشروع يصبح المالك،
-- وأي حساب لاحق يُنشأ بصلاحية pending (لا يرى أي بيانات).
-- ----------------------------------------------------------------------------
create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_exists boolean;
  v_role         text;
begin
  select exists (select 1 from public.profiles where role = 'owner')
    into v_owner_exists;

  v_role := case when v_owner_exists then 'pending' else 'owner' end;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      case when v_role = 'owner' then 'أبو حمدان' else 'مستخدم' end
    ),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- ----------------------------------------------------------------------------
-- دالة التحقق من الملكية — أساس كل سياسات RLS
-- SECURITY DEFINER لتفادي الرجوع العودي (recursion) على سياسات profiles.
-- ----------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
  );
$$;

comment on function public.is_owner()
  is 'true فقط إذا كان المستخدم الحالي هو المالك. تُستخدم في كل سياسات RLS.';

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. vehicles — السيارات
-- ----------------------------------------------------------------------------
create table if not exists public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  plate_number     text not null,
  plate_normalized text not null,
  owner_name       text,
  phone            text,
  vehicle_type     text,
  notes            text,
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint vehicles_plate_not_blank
    check (length(btrim(plate_number)) between 1 and 32),
  constraint vehicles_normalized_not_blank
    check (length(plate_normalized) between 1 and 32)
);

comment on table public.vehicles is 'السيارات المسجلة في الموقف.';

create unique index if not exists vehicles_plate_normalized_key
  on public.vehicles(plate_normalized);

create index if not exists vehicles_created_at_idx
  on public.vehicles(created_at desc);

-- توليد plate_normalized تلقائياً عند الإدخال والتعديل
create or replace function public.tg_vehicles_normalize()
returns trigger
language plpgsql
as $$
begin
  new.plate_number := btrim(new.plate_number);
  new.plate_normalized := public.normalize_plate(new.plate_number);

  if new.plate_normalized is null then
    raise exception 'رقم اللوحة غير صالح'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists vehicles_normalize on public.vehicles;
create trigger vehicles_normalize
  before insert or update of plate_number on public.vehicles
  for each row execute function public.tg_vehicles_normalize();

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. pricing_rules — قواعد التسعير
-- ----------------------------------------------------------------------------
create table if not exists public.pricing_rules (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,

  -- المبلغ الأساسي يغطي كامل فترة الدوام base_start_time -> base_end_time
  base_amount        numeric(10,2) not null default 1.00,
  base_start_time    time not null default '08:00',
  base_end_time      time not null default '15:00',

  -- بعد base_end_time: هذا المبلغ عن كل ساعة أو جزء منها
  extra_hour_amount  numeric(10,2) not null default 1.00,

  -- ceil_hour   : أي جزء من الساعة يُحسب ساعة كاملة  (المعتمد)
  -- exact_minutes: حساب دقيق بالدقائق
  rounding_mode      text not null default 'ceil_hour',

  -- فترة سماح بالدقائق بعد نهاية الدوام قبل بدء احتساب الزيادة
  grace_minutes      integer not null default 15,

  -- هل تُحتسب زيادة على الدخول قبل بداية الدوام؟
  -- المعتمد: نعم — المبلغ الأساسي يغطي فقط من دخل داخل فترة الدوام
  charge_before_start boolean not null default true,

  -- أيام الإغلاق حسب ترقيم PostgreSQL: 0=الأحد … 5=الجمعة, 6=السبت
  -- المعتمد: لا يوجد دوام الجمعة والسبت
  closed_days        smallint[] not null default '{5,6}',

  is_active          boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint pricing_amounts_valid
    check (base_amount >= 0 and extra_hour_amount >= 0),
  constraint pricing_rounding_valid
    check (rounding_mode in ('ceil_hour', 'exact_minutes')),
  constraint pricing_time_valid
    check (base_end_time > base_start_time),
  constraint pricing_grace_valid
    check (grace_minutes between 0 and 240),
  constraint pricing_name_not_blank
    check (length(btrim(name)) > 0),
  constraint pricing_closed_days_valid
    check (
      closed_days <@ array[0,1,2,3,4,5,6]::smallint[]
      and array_length(closed_days, 1) is distinct from 7
    )
);

comment on table public.pricing_rules is
  'قواعد التسعير. تُحفظ هوية القاعدة داخل كل عملية وقوف حتى لا تتأثر الفواتير القديمة بأي تعديل لاحق.';

-- قاعدة تسعير واحدة فعّالة في كل وقت
create unique index if not exists pricing_rules_single_active
  on public.pricing_rules((is_active))
  where is_active;

drop trigger if exists pricing_rules_set_updated_at on public.pricing_rules;
create trigger pricing_rules_set_updated_at
  before update on public.pricing_rules
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. subscriptions — الاشتراكات الشهرية
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  start_date      date not null default (public.amman_date(now())),
  end_date        date not null,
  status          text not null default 'active',
  monthly_amount  numeric(10,2),
  notes           text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint subscriptions_dates_valid check (end_date >= start_date),
  constraint subscriptions_status_valid check (status in ('active', 'cancelled')),
  constraint subscriptions_amount_valid
    check (monthly_amount is null or monthly_amount >= 0)
);

comment on table public.subscriptions is
  'الاشتراكات الشهرية. الاشتراك ساري إذا كان status=active وتاريخ اليوم ضمن المدة. '
  'الانتهاء يُحسب من التواريخ ولا يحتاج تحديثاً يدوياً.';

create index if not exists subscriptions_vehicle_idx
  on public.subscriptions(vehicle_id);
create index if not exists subscriptions_range_idx
  on public.subscriptions(status, start_date, end_date);

-- منع تداخل اشتراكين ساريين لنفس السيارة
create index if not exists subscriptions_active_vehicle_idx
  on public.subscriptions(vehicle_id, end_date desc)
  where status = 'active';

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. parking_sessions — عمليات الدخول والخروج
-- ----------------------------------------------------------------------------
create table if not exists public.parking_sessions (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles(id) on delete restrict,
  session_type    text not null,
  entry_time      timestamptz not null default now(),
  exit_time       timestamptz,
  pricing_rule_id uuid references public.pricing_rules(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_due      numeric(10,2) not null default 0,
  payment_status  text not null default 'unpaid',
  payment_method  text,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint session_type_valid
    check (session_type in ('one_time', 'monthly')),

  constraint payment_status_valid
    check (payment_status in ('not_required', 'unpaid', 'paid', 'waived')),

  constraint payment_method_valid
    check (payment_method is null
           or payment_method in ('cash', 'transfer', 'other')),

  -- لا يمكن أن يكون الخروج قبل الدخول
  constraint session_time_valid
    check (exit_time is null or exit_time >= entry_time),

  constraint session_amount_valid
    check (amount_due >= 0),

  -- اشتراك شهري = بلا رسوم زيارة
  constraint session_monthly_free
    check (session_type <> 'monthly'
           or (amount_due = 0 and payment_status = 'not_required'))
);

comment on table public.parking_sessions is
  'كل عملية وقوف. exit_time = null تعني أن السيارة ما زالت داخل الموقف.';

create index if not exists parking_sessions_vehicle_idx
  on public.parking_sessions(vehicle_id, entry_time desc);
create index if not exists parking_sessions_entry_idx
  on public.parking_sessions(entry_time desc);
create index if not exists parking_sessions_exit_idx
  on public.parking_sessions(exit_time desc) where exit_time is not null;
create index if not exists parking_sessions_unpaid_idx
  on public.parking_sessions(payment_status) where payment_status = 'unpaid';

-- سيارة واحدة = عملية وقوف نشطة واحدة فقط
create unique index if not exists parking_sessions_one_active_per_vehicle
  on public.parking_sessions(vehicle_id)
  where exit_time is null;

drop trigger if exists parking_sessions_set_updated_at on public.parking_sessions;
create trigger parking_sessions_set_updated_at
  before update on public.parking_sessions
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. payments — المدفوعات
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.parking_sessions(id) on delete cascade,
  amount         numeric(10,2) not null,
  payment_method text not null default 'cash',
  paid_at        timestamptz not null default now(),
  notes          text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),

  constraint payments_amount_valid check (amount > 0),
  constraint payments_method_valid
    check (payment_method in ('cash', 'transfer', 'other'))
);

comment on table public.payments is 'سجل المدفوعات الفعلية المرتبطة بعمليات الوقوف.';

create index if not exists payments_session_idx on public.payments(session_id);
create index if not exists payments_paid_at_idx on public.payments(paid_at desc);

-- ----------------------------------------------------------------------------
-- 7. ocr_captures — سجل قراءات اللوحة
-- ----------------------------------------------------------------------------
create table if not exists public.ocr_captures (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references public.parking_sessions(id) on delete set null,
  image_path      text,
  detected_plate  text,
  corrected_plate text,
  confidence      numeric(5,4),
  engine          text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),

  constraint ocr_confidence_valid
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

comment on table public.ocr_captures is
  'سجل محاولات قراءة اللوحة آلياً — للقياس والتحسين. لا يُعتمد عليه في أي حساب.';

create index if not exists ocr_captures_session_idx on public.ocr_captures(session_id);
create index if not exists ocr_captures_created_idx on public.ocr_captures(created_at desc);

-- ----------------------------------------------------------------------------
-- 8. app_settings — إعدادات التطبيق
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now()
);

comment on table public.app_settings is 'إعدادات عامة للتطبيق بصيغة مفتاح/قيمة.';

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. القيم الافتراضية
-- ----------------------------------------------------------------------------
insert into public.pricing_rules (
  name, base_amount, base_start_time, base_end_time,
  extra_hour_amount, rounding_mode, grace_minutes,
  charge_before_start, closed_days, is_active, created_by
)
select
  'التسعيرة الأساسية',
  1.00, '08:00', '15:00',
  1.00, 'ceil_hour', 15,
  true, '{5,6}'::smallint[], true, null
where not exists (select 1 from public.pricing_rules);

insert into public.app_settings (key, value, description, updated_by)
values
  ('parking_name', '"موقف أبو حمدان"'::jsonb, 'اسم الموقف الظاهر في التطبيق', null),
  ('currency',     '"JOD"'::jsonb,             'عملة النظام', null),
  ('timezone',     '"Asia/Amman"'::jsonb,      'المنطقة الزمنية المعتمدة في الحسابات', null),
  ('contact_phone','""'::jsonb,                'رقم تواصل يظهر في التقارير', null)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 10. تعيين المالك للحسابات الموجودة مسبقاً
-- ----------------------------------------------------------------------------
-- الـ trigger أعلاه يعمل على الحسابات الجديدة فقط. إذا كان حساب أبو حمدان
-- أُنشئ قبل تشغيل هذا الملف فلن يكون له ملف شخصي — نعوّض ذلك هنا.
--
-- القاعدة: أقدم حساب في المشروع يصبح المالك، وأي حساب آخر يأخذ pending.
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    case when u.created_at = (select min(created_at) from auth.users)
         then 'أبو حمدان' else 'مستخدم' end
  ),
  case when u.created_at = (select min(created_at) from auth.users)
       then 'owner' else 'pending' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- تقرير نهائي: من هو المالك؟
do $$
declare
  v_owner text;
  v_count int;
begin
  select count(*) into v_count from public.profiles where role = 'owner';

  if v_count = 0 then
    raise notice 'لا يوجد حساب مالك بعد. أنشئ حساب أبو حمدان من Authentication > Users '
                 'وسيصبح المالك تلقائياً.';
  else
    select u.email into v_owner
    from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'owner' limit 1;
    raise notice 'حساب المالك: %  (عدد حسابات المالك: %)', v_owner, v_count;
  end if;
end $$;


-- ==============================================================================
-- ملف: 20260101000100_functions.sql
-- ==============================================================================

-- ============================================================================
-- Blue Parking — 0002 : منطق العمل (Business Logic)
-- ----------------------------------------------------------------------------
-- كل الحسابات المالية تتم هنا داخل قاعدة البيانات.
-- الواجهة لا تُرسل المبالغ أبداً — تُرسل الأمر فقط، والمبلغ يُحسب هنا.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- تاريخ اليوم بتوقيت عمّان
-- ----------------------------------------------------------------------------
create or replace function public.amman_today()
returns date
language sql
stable
as $$
  select public.amman_date(now());
$$;

-- ----------------------------------------------------------------------------
-- حارس الصلاحية — يُستدعى في بداية كل دالة عمل
-- ----------------------------------------------------------------------------
create or replace function public.assert_owner()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً' using errcode = '42501';
  end if;

  if not public.is_owner() then
    raise exception 'ليس لديك صلاحية للوصول إلى بيانات الموقف' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_owner() from public;
grant execute on function public.assert_owner() to authenticated;

-- ----------------------------------------------------------------------------
-- هل هذا اليوم يوم إغلاق؟ (الجمعة والسبت في الإعداد المعتمد)
-- ----------------------------------------------------------------------------
create or replace function public.is_closed_day(p_date date default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (extract(dow from coalesce(p_date, public.amman_today()))::smallint
       = any (r.closed_days)),
    false
  )
  from public.pricing_rules r
  where r.is_active
  limit 1;
$$;

comment on function public.is_closed_day(date)
  is 'هل التاريخ ضمن أيام إغلاق الموقف حسب التسعيرة الفعّالة.';

grant execute on function public.is_closed_day(date) to authenticated;

-- ============================================================================
-- محرك حساب الرسوم
-- ----------------------------------------------------------------------------
-- القاعدة المعتمدة (التسعيرة الافتراضية):
--   • المبلغ الأساسي 1 د.أ يغطي فترة الدوام 08:00 → 15:00
--   • فترة سماح 15 دقيقة بعد الثالثة بلا رسوم إضافية
--   • بعد ذلك: 1 د.أ عن كل ساعة أو جزء من ساعة، محسوبة من 15:00
--       خروج 15:00 → 1 د.أ
--       خروج 15:10 → 1 د.أ   (داخل فترة السماح)
--       خروج 15:20 → 2 د.أ   (تجاوز السماح → ساعة كاملة من 15:00)
--       خروج 16:00 → 2 د.أ
--       خروج 16:01 → 3 د.أ
--   • الدخول قبل 08:00 يُحاسب أيضاً: ساعة أو جزء منها لكل ساعة قبل الثامنة
--       دخول 07:00 → خروج 14:00 = 1 + 1 = 2 د.أ
--     لأن المبلغ الأساسي يغطي فقط من دخل داخل فترة الدوام.
--
-- ملاحظات تصميمية مهمة:
--   • نهاية الفترة الأساسية تُحتسب على **تاريخ الدخول** وليس تاريخ الخروج،
--     حتى لا تُفلت أي سيارة تتجاوز منتصف الليل من الحساب.
--   • إذا دخلت السيارة بعد 15:00 يبدأ احتساب الزيادة من لحظة الدخول،
--     فلا تُحاسب على ساعات لم تكن فيها داخل الموقف.
--   • المبلغ الأساسي يمثّل الحد الأدنى لأي زيارة.
-- ============================================================================
create or replace function public.calculate_parking_fee(
  p_entry_time      timestamptz,
  p_exit_time       timestamptz,
  p_pricing_rule_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare
  v_rule            public.pricing_rules%rowtype;
  v_entry_local     timestamp;
  v_exit_local      timestamp;
  v_base_start      timestamp;
  v_base_end        timestamp;
  v_grace_end       timestamp;
  v_billable_from   timestamp;
  v_extra_minutes   numeric;
  v_extra_units     numeric;
  v_pre_minutes     numeric;
  v_amount          numeric;
begin
  if p_entry_time is null then
    raise exception 'وقت الدخول مطلوب';
  end if;

  if p_exit_time is null then
    raise exception 'وقت الخروج مطلوب';
  end if;

  if p_exit_time < p_entry_time then
    raise exception 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول';
  end if;

  select * into v_rule
  from public.pricing_rules
  where id = p_pricing_rule_id;

  if not found then
    raise exception 'قاعدة التسعير غير موجودة';
  end if;

  v_entry_local := p_entry_time at time zone 'Asia/Amman';
  v_exit_local  := p_exit_time  at time zone 'Asia/Amman';

  -- فترة الدوام محسوبة على تاريخ الدخول
  v_base_start := date_trunc('day', v_entry_local) + v_rule.base_start_time;
  v_base_end   := date_trunc('day', v_entry_local) + v_rule.base_end_time;
  v_grace_end  := v_base_end + make_interval(mins => v_rule.grace_minutes);

  v_amount := v_rule.base_amount;

  -- زيادة اختيارية على الدخول قبل بداية الدوام (معطّلة افتراضياً)
  if v_rule.charge_before_start and v_entry_local < v_base_start then
    v_pre_minutes := extract(epoch from (
      least(v_exit_local, v_base_start) - v_entry_local
    )) / 60.0;

    if v_pre_minutes > 0 then
      if v_rule.rounding_mode = 'ceil_hour' then
        v_amount := v_amount + ceil(v_pre_minutes / 60.0) * v_rule.extra_hour_amount;
      else
        v_amount := v_amount + (v_pre_minutes / 60.0) * v_rule.extra_hour_amount;
      end if;
    end if;
  end if;

  -- الخروج ضمن فترة الدوام (أو ضمن فترة السماح) → المبلغ الأساسي فقط
  if v_exit_local <= v_grace_end then
    return round(v_amount, 2);
  end if;

  -- بداية احتساب الزيادة: نهاية الدوام، أو لحظة الدخول إن كانت بعدها
  v_billable_from := greatest(v_base_end, v_entry_local);

  v_extra_minutes := extract(epoch from (v_exit_local - v_billable_from)) / 60.0;

  if v_extra_minutes <= 0 then
    return round(v_amount, 2);
  end if;

  if v_rule.rounding_mode = 'ceil_hour' then
    v_extra_units := ceil(v_extra_minutes / 60.0);
  else
    v_extra_units := v_extra_minutes / 60.0;
  end if;

  v_amount := v_amount + (v_extra_units * v_rule.extra_hour_amount);

  return round(v_amount, 2);
end;
$$;

comment on function public.calculate_parking_fee(timestamptz, timestamptz, uuid)
  is 'يحسب رسوم الوقوف حسب قاعدة تسعير محددة. المرجع الوحيد للحساب في النظام.';

grant execute on function public.calculate_parking_fee(timestamptz, timestamptz, uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- قاعدة التسعير الفعّالة حالياً
-- ----------------------------------------------------------------------------
create or replace function public.active_pricing_rule()
returns public.pricing_rules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.pricing_rules%rowtype;
begin
  select * into v_rule
  from public.pricing_rules
  where is_active
  order by updated_at desc
  limit 1;

  if not found then
    raise exception 'لا توجد قاعدة تسعير فعّالة. اضبط التسعيرة من الإعدادات أولاً.';
  end if;

  return v_rule;
end;
$$;

grant execute on function public.active_pricing_rule() to authenticated;

-- ----------------------------------------------------------------------------
-- الاشتراك الساري لسيارة في تاريخ معيّن
-- ----------------------------------------------------------------------------
create or replace function public.active_subscription_for(
  p_vehicle_id uuid,
  p_on_date    date default null
)
returns public.subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.subscriptions s
  where s.vehicle_id = p_vehicle_id
    and s.status = 'active'
    and s.start_date <= coalesce(p_on_date, public.amman_today())
    and s.end_date   >= coalesce(p_on_date, public.amman_today())
  order by s.end_date desc
  limit 1;
$$;

grant execute on function public.active_subscription_for(uuid, date) to authenticated;

-- ============================================================================
-- البحث عن سيارة برقم اللوحة
-- ============================================================================
create or replace function public.lookup_plate(p_plate text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm    text;
  v_vehicle public.vehicles%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_session public.parking_sessions%rowtype;
begin
  perform public.assert_owner();

  v_norm := public.normalize_plate(p_plate);
  if v_norm is null then
    raise exception 'رقم اللوحة مطلوب';
  end if;

  select * into v_vehicle
  from public.vehicles
  where plate_normalized = v_norm;

  if not found then
    return jsonb_build_object(
      'found', false,
      'normalized', v_norm,
      'vehicle', null,
      'subscription', null,
      'active_session', null,
      'is_closed_day', public.is_closed_day()
    );
  end if;

  select * into v_sub from public.active_subscription_for(v_vehicle.id);

  select * into v_session
  from public.parking_sessions
  where vehicle_id = v_vehicle.id and exit_time is null;

  return jsonb_build_object(
    'found', true,
    'normalized', v_norm,
    'vehicle', to_jsonb(v_vehicle),
    'subscription', case when v_sub.id is null then null else to_jsonb(v_sub) end,
    'active_session', case when v_session.id is null then null else to_jsonb(v_session) end,
    'is_closed_day', public.is_closed_day()
  );
end;
$$;

grant execute on function public.lookup_plate(text) to authenticated;

-- ============================================================================
-- تسجيل دخول سيارة
-- ============================================================================
create or replace function public.register_entry(
  p_plate      text,
  p_owner_name text default null,
  p_phone      text default null,
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm      text;
  v_vehicle   public.vehicles%rowtype;
  v_sub       public.subscriptions%rowtype;
  v_session   public.parking_sessions%rowtype;
  v_is_new    boolean := false;
  v_type      text;
begin
  perform public.assert_owner();

  v_norm := public.normalize_plate(p_plate);
  if v_norm is null then
    raise exception 'رقم اللوحة مطلوب';
  end if;

  select * into v_vehicle
  from public.vehicles
  where plate_normalized = v_norm
  for update;

  if not found then
    insert into public.vehicles (plate_number, owner_name, phone, notes, created_by)
    values (btrim(p_plate), nullif(btrim(coalesce(p_owner_name, '')), ''),
            nullif(btrim(coalesce(p_phone, '')), ''), null, auth.uid())
    returning * into v_vehicle;
    v_is_new := true;
  else
    if not v_vehicle.is_active then
      raise exception 'هذه السيارة موقوفة في النظام';
    end if;

    -- تحديث بيانات المالك إن أُرسلت ولم تكن مسجّلة
    if nullif(btrim(coalesce(p_owner_name, '')), '') is not null
       and coalesce(v_vehicle.owner_name, '') = '' then
      update public.vehicles
      set owner_name = btrim(p_owner_name)
      where id = v_vehicle.id
      returning * into v_vehicle;
    end if;
  end if;

  -- منع الدخول المزدوج
  if exists (
    select 1 from public.parking_sessions
    where vehicle_id = v_vehicle.id and exit_time is null
  ) then
    raise exception 'السيارة % موجودة بالفعل داخل الموقف', v_vehicle.plate_number;
  end if;

  select * into v_sub from public.active_subscription_for(v_vehicle.id);

  v_type := case when v_sub.id is null then 'one_time' else 'monthly' end;

  insert into public.parking_sessions (
    vehicle_id, session_type, entry_time,
    subscription_id, amount_due, payment_status, notes, created_by
  )
  values (
    v_vehicle.id,
    v_type,
    now(),
    v_sub.id,
    0,
    case when v_type = 'monthly' then 'not_required' else 'unpaid' end,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_session;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'subscription', case when v_sub.id is null then null else to_jsonb(v_sub) end,
    'is_new_vehicle', v_is_new
  );
end;
$$;

grant execute on function public.register_entry(text, text, text, text) to authenticated;

-- ============================================================================
-- معاينة الرسوم قبل تأكيد الخروج
-- ============================================================================
create or replace function public.preview_exit(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_rule    public.pricing_rules%rowtype;
  v_now     timestamptz := now();
  v_amount  numeric(10,2) := 0;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id and exit_time is null;

  if not found then
    raise exception 'لا توجد حركة دخول نشطة لهذه السيارة';
  end if;

  select * into v_vehicle from public.vehicles where id = v_session.vehicle_id;

  if v_session.session_type = 'monthly' then
    return jsonb_build_object(
      'session', to_jsonb(v_session),
      'vehicle', to_jsonb(v_vehicle),
      'pricing_rule', null,
      'amount_due', 0,
      'estimated_exit', v_now,
      'duration_minutes', round(extract(epoch from (v_now - v_session.entry_time)) / 60.0)
    );
  end if;

  select * into v_rule from public.active_pricing_rule();
  v_amount := public.calculate_parking_fee(v_session.entry_time, v_now, v_rule.id);

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'pricing_rule', to_jsonb(v_rule),
    'amount_due', v_amount,
    'estimated_exit', v_now,
    'duration_minutes', round(extract(epoch from (v_now - v_session.entry_time)) / 60.0)
  );
end;
$$;

grant execute on function public.preview_exit(uuid) to authenticated;

-- ============================================================================
-- تسجيل خروج سيارة
-- ----------------------------------------------------------------------------
-- المبلغ يُحسب هنا فقط. الواجهة لا تستطيع تمرير مبلغ.
-- ============================================================================
create or replace function public.register_exit(
  p_session_id     uuid,
  p_payment_status text default 'paid',
  p_payment_method text default 'cash',
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_rule    public.pricing_rules%rowtype;
  v_rule_id uuid := null;
  v_exit    timestamptz := now();
  v_amount  numeric(10,2) := 0;
  v_status  text;
  v_method  text;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id and exit_time is null
  for update;

  if not found then
    raise exception 'لا توجد حركة دخول نشطة لهذه السيارة';
  end if;

  if v_exit < v_session.entry_time then
    raise exception 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول';
  end if;

  if v_session.session_type = 'monthly' then
    -- اشتراك شهري: تسجيل الخروج فقط بلا رسوم
    v_amount  := 0;
    v_status  := 'not_required';
    v_method  := null;
    v_rule_id := null;
  else
    select * into v_rule from public.active_pricing_rule();
    v_rule_id := v_rule.id;
    v_amount  := public.calculate_parking_fee(v_session.entry_time, v_exit, v_rule_id);

    v_status := coalesce(nullif(btrim(coalesce(p_payment_status, '')), ''), 'unpaid');
    if v_status not in ('paid', 'unpaid', 'waived') then
      raise exception 'حالة الدفع غير صالحة';
    end if;

    if v_status = 'paid' then
      v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
      if v_method not in ('cash', 'transfer', 'other') then
        raise exception 'طريقة الدفع غير صالحة';
      end if;
    else
      v_method := null;
    end if;

    if v_status = 'waived' then
      v_amount := 0;
    end if;
  end if;

  update public.parking_sessions
  set exit_time       = v_exit,
      amount_due      = v_amount,
      payment_status  = v_status,
      payment_method  = v_method,
      pricing_rule_id = v_rule_id,
      notes           = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = p_session_id
  returning * into v_session;

  -- تسجيل الدفعة الفعلية
  if v_status = 'paid' and v_amount > 0 then
    insert into public.payments (session_id, amount, payment_method, paid_at, created_by)
    values (v_session.id, v_amount, v_method, v_exit, auth.uid());
  end if;

  select * into v_vehicle from public.vehicles where id = v_session.vehicle_id;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'amount_due', v_amount,
    'payment_status', v_status
  );
end;
$$;

grant execute on function public.register_exit(uuid, text, text, text) to authenticated;

-- ============================================================================
-- تحصيل مبلغ عملية غير مدفوعة (لاحقاً)
-- ============================================================================
create or replace function public.settle_session(
  p_session_id     uuid,
  p_payment_method text default 'cash',
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
  v_method  text;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'العملية غير موجودة';
  end if;

  if v_session.payment_status <> 'unpaid' then
    raise exception 'هذه العملية ليست بحالة غير مدفوع';
  end if;

  if v_session.exit_time is null then
    raise exception 'لا يمكن تحصيل مبلغ قبل تسجيل الخروج';
  end if;

  v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'transfer', 'other') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  update public.parking_sessions
  set payment_status = 'paid',
      payment_method = v_method,
      notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = p_session_id
  returning * into v_session;

  if v_session.amount_due > 0 then
    insert into public.payments (session_id, amount, payment_method, created_by)
    values (v_session.id, v_session.amount_due, v_method, auth.uid());
  end if;

  return jsonb_build_object('session', to_jsonb(v_session));
end;
$$;

grant execute on function public.settle_session(uuid, text, text) to authenticated;

-- ============================================================================
-- تسجيل قراءة OCR
-- ============================================================================
create or replace function public.log_ocr_capture(
  p_detected_plate  text,
  p_corrected_plate text,
  p_confidence      numeric default null,
  p_engine          text default null,
  p_session_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_owner();

  insert into public.ocr_captures (
    session_id, detected_plate, corrected_plate, confidence, engine, created_by
  )
  values (
    p_session_id,
    nullif(btrim(coalesce(p_detected_plate, '')), ''),
    nullif(btrim(coalesce(p_corrected_plate, '')), ''),
    case when p_confidence is null then null
         else greatest(0, least(1, p_confidence)) end,
    nullif(btrim(coalesce(p_engine, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_ocr_capture(text, text, numeric, text, uuid)
  to authenticated;

-- ============================================================================
-- إحصائيات لوحة التحكم
-- ============================================================================
create or replace function public.get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today       date;
  v_week_start  date;
  v_month_start date;
  v_result      jsonb;
begin
  perform public.assert_owner();

  v_today       := public.amman_today();
  -- الأسبوع يبدأ يوم الأحد (العُرف في الأردن)
  v_week_start  := v_today - ((extract(dow from v_today))::int);
  v_month_start := date_trunc('month', v_today)::date;

  select jsonb_build_object(
    'today', v_today,
    'is_closed_day', public.is_closed_day(v_today),
    'cars_inside', (
      select count(*) from public.parking_sessions where exit_time is null
    ),
    'entries_today', (
      select count(*) from public.parking_sessions
      where public.amman_date(entry_time) = v_today
    ),
    'exits_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
    ),
    'one_time_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) = v_today
        and session_type = 'one_time'
    ),
    'monthly_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) = v_today
        and session_type = 'monthly'
    ),
    'revenue_today', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) = v_today
        and payment_status = 'paid'
    ),
    'unpaid_today', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) = v_today
        and payment_status = 'unpaid'
    ),
    'revenue_week', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) between v_week_start and v_today
        and payment_status = 'paid'
    ),
    'revenue_month', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null
        and public.amman_date(exit_time) between v_month_start and v_today
        and payment_status = 'paid'
    ),
    'unpaid_total', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where payment_status = 'unpaid' and exit_time is not null
    ),
    'unpaid_count', (
      select count(*) from public.parking_sessions
      where payment_status = 'unpaid' and exit_time is not null
    ),
    'active_subscriptions', (
      select count(*) from public.subscriptions
      where status = 'active' and start_date <= v_today and end_date >= v_today
    ),
    'expiring_subscriptions', (
      select count(*) from public.subscriptions
      where status = 'active'
        and start_date <= v_today
        and end_date between v_today and (v_today + 7)
    ),
    'total_vehicles', (
      select count(*) from public.vehicles where is_active
    )
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_dashboard() to authenticated;

-- ============================================================================
-- تقرير حسب فترة
-- ============================================================================
create or replace function public.get_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals jsonb;
  v_days   jsonb;
begin
  perform public.assert_owner();

  if p_from is null or p_to is null then
    raise exception 'يجب تحديد تاريخ البداية والنهاية';
  end if;

  if p_to < p_from then
    raise exception 'تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية';
  end if;

  if (p_to - p_from) > 366 then
    raise exception 'المدة المطلوبة طويلة جداً — الحد الأقصى سنة واحدة';
  end if;

  select jsonb_build_object(
    'sessions',      count(*),
    'one_time',      count(*) filter (where session_type = 'one_time'),
    'monthly',       count(*) filter (where session_type = 'monthly'),
    'paid_count',    count(*) filter (where payment_status = 'paid'),
    'unpaid_count',  count(*) filter (where payment_status = 'unpaid'),
    'waived_count',  count(*) filter (where payment_status = 'waived'),
    'revenue_paid',  coalesce(sum(amount_due) filter (where payment_status = 'paid'), 0)::numeric(10,2),
    'unpaid_amount', coalesce(sum(amount_due) filter (where payment_status = 'unpaid'), 0)::numeric(10,2),
    'total_due',     coalesce(sum(amount_due), 0)::numeric(10,2)
  )
  into v_totals
  from public.parking_sessions
  where exit_time is not null
    and public.amman_date(exit_time) between p_from and p_to;

  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
  into v_days
  from (
    select
      g.day::date                                                as day,
      count(s.id)                                                as sessions,
      count(s.id) filter (where s.session_type = 'one_time')     as one_time,
      count(s.id) filter (where s.session_type = 'monthly')      as monthly,
      coalesce(sum(s.amount_due) filter (where s.payment_status = 'paid'), 0)::numeric(10,2)   as revenue_paid,
      coalesce(sum(s.amount_due) filter (where s.payment_status = 'unpaid'), 0)::numeric(10,2) as unpaid_amount
    from generate_series(p_from, p_to, interval '1 day') as g(day)
    left join public.parking_sessions s
      on s.exit_time is not null
     and public.amman_date(s.exit_time) = g.day::date
    group by g.day
  ) d;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', v_totals,
    'days', v_days
  );
end;
$$;

grant execute on function public.get_report(date, date) to authenticated;

-- ============================================================================
-- عروض (Views)
-- ============================================================================

-- السيارات الموجودة حالياً
drop view if exists public.current_cars_inside cascade;
create view public.current_cars_inside
with (security_invoker = true)
as
select
  s.id            as session_id,
  v.id            as vehicle_id,
  v.plate_number,
  v.plate_normalized,
  v.owner_name,
  v.phone,
  s.session_type,
  s.entry_time,
  s.notes,
  sub.end_date    as subscription_end_date
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id
left join public.subscriptions sub on sub.id = s.subscription_id
where s.exit_time is null;

-- تفاصيل كل العمليات — تُستخدم في التقارير وتصدير CSV
drop view if exists public.session_details cascade;
create view public.session_details
with (security_invoker = true)
as
select
  s.id,
  v.plate_number,
  v.owner_name,
  v.phone,
  s.session_type,
  s.entry_time,
  s.exit_time,
  public.amman_date(coalesce(s.exit_time, s.entry_time)) as business_date,
  case
    when s.exit_time is null then null
    else round(extract(epoch from (s.exit_time - s.entry_time)) / 60.0)::int
  end as duration_minutes,
  s.amount_due,
  s.payment_status,
  s.payment_method,
  s.notes,
  s.created_at
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id;

-- حالة الاشتراكات محسوبة من التواريخ
drop view if exists public.subscription_status cascade;
create view public.subscription_status
with (security_invoker = true)
as
select
  sub.id,
  sub.vehicle_id,
  v.plate_number,
  v.plate_normalized,
  v.owner_name,
  v.phone,
  sub.start_date,
  sub.end_date,
  sub.monthly_amount,
  sub.notes,
  sub.status                                  as raw_status,
  case
    when sub.status = 'cancelled' then 'cancelled'
    when sub.end_date   < public.amman_today() then 'expired'
    when sub.start_date > public.amman_today() then 'upcoming'
    else 'active'
  end                                         as computed_status,
  (sub.end_date - public.amman_today())       as days_left,
  sub.created_at
from public.subscriptions sub
join public.vehicles v on v.id = sub.vehicle_id;

grant select on public.current_cars_inside to authenticated;
grant select on public.session_details to authenticated;
grant select on public.subscription_status to authenticated;


-- ==============================================================================
-- ملف: 20260101000200_rls.sql
-- ==============================================================================

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


-- ==============================================================================
-- ملف: 20260101000300_services_expenses.sql
-- ==============================================================================

-- ============================================================================
-- Blue Parking — 0004 : الخدمات والمصاريف وتعديل المبلغ المحصّل
-- ----------------------------------------------------------------------------
-- يضيف:
--   1) إمكانية تعديل المبلغ المحصّل عند الدفع (خصم عند عدم توفر صرافة)
--   2) خدمات إضافية بقيمة يدوية (تمسيح / غسيل / أخرى)
--   3) المصاريف اليومية (ماء / كهرباء / موظف / صيانة / أخرى)
--   4) صافي الدخل = المحصّل من الوقوف + الخدمات − المصاريف
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. تتبّع المبلغ: المحسوب مقابل المحصّل
-- ----------------------------------------------------------------------------
-- amount_due       : ما يحسبه محرك التسعير (الفاتورة)
-- amount_collected : ما تم تحصيله فعلاً — قد يقل عن الفاتورة عند الخصم
-- adjustment       : amount_collected − amount_due  (سالب = خصم)
--
-- الفصل مهم: التقارير تعرض الفاتورة والخصم والمحصّل كلاً على حدة، فلا
-- يضيع أثر الخصومات في الحساب.
alter table public.parking_sessions
  add column if not exists amount_collected numeric(10,2),
  add column if not exists adjustment       numeric(10,2) not null default 0,
  add column if not exists discount_reason  text;

comment on column public.parking_sessions.amount_collected is
  'المبلغ المحصّل فعلاً. null قبل الخروج. قد يقل عن amount_due عند الخصم.';
comment on column public.parking_sessions.adjustment is
  'amount_collected − amount_due. قيمة سالبة تعني خصماً.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_collected_valid'
      and conrelid = 'public.parking_sessions'::regclass
  ) then
    alter table public.parking_sessions
      add constraint session_collected_valid
      check (amount_collected is null or amount_collected >= 0);
  end if;
end $$;

-- تعبئة السجلات السابقة: المحصّل = الفاتورة
update public.parking_sessions
set amount_collected = amount_due
where exit_time is not null
  and amount_collected is null
  and payment_status = 'paid';

create index if not exists parking_sessions_collected_idx
  on public.parking_sessions(amount_collected)
  where amount_collected is not null;

-- ----------------------------------------------------------------------------
-- 2. الخدمات الإضافية (غسيل / تمسيح)
-- ----------------------------------------------------------------------------
-- منفصلة تماماً عن رسوم الوقوف حتى لا يختلط الحسابان، ولتمكين تسجيل غسيل
-- لسيارة مشتركة شهرياً أو لسيارة تأتي للغسيل فقط بلا وقوف.
create table if not exists public.services (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  session_id     uuid references public.parking_sessions(id) on delete set null,
  service_type   text not null,
  amount         numeric(10,2) not null,
  payment_status text not null default 'paid',
  payment_method text,
  notes          text,
  performed_at   timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),

  constraint services_type_valid
    check (service_type in ('wipe', 'wash', 'other')),
  constraint services_amount_valid
    check (amount > 0 and amount <= 9999.99),
  constraint services_payment_status_valid
    check (payment_status in ('unpaid', 'paid', 'waived')),
  constraint services_payment_method_valid
    check (payment_method is null
           or payment_method in ('cash', 'transfer', 'other'))
);

comment on table public.services is
  'خدمات إضافية بقيمة يدوية (تمسيح/غسيل). منفصلة عن رسوم الوقوف.';

create index if not exists services_performed_idx  on public.services(performed_at desc);
create index if not exists services_vehicle_idx    on public.services(vehicle_id);
create index if not exists services_session_idx    on public.services(session_id);
create index if not exists services_unpaid_idx     on public.services(payment_status)
  where payment_status = 'unpaid';

-- ----------------------------------------------------------------------------
-- 3. المصاريف اليومية
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,
  amount     numeric(10,2) not null,
  notes      text,
  spent_at   timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint expenses_category_valid
    check (category in ('water', 'electricity', 'staff', 'maintenance', 'other')),
  constraint expenses_amount_valid
    check (amount > 0 and amount <= 99999.99)
);

comment on table public.expenses is
  'المصاريف المدفوعة من حصيلة الموقف — تُخصم من صافي الدخل.';

create index if not exists expenses_spent_idx    on public.expenses(spent_at desc);
create index if not exists expenses_category_idx on public.expenses(category);

-- ----------------------------------------------------------------------------
-- 4. تحديث updated_at غير مطلوب هنا (سجلات غير قابلة للتعديل بعد الإنشاء)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 5. تسجيل الخروج — مع إمكانية تعديل المبلغ المحصّل
-- ============================================================================
create or replace function public.register_exit(
  p_session_id       uuid,
  p_payment_status   text    default 'paid',
  p_payment_method   text    default 'cash',
  p_notes            text    default null,
  p_collected_amount numeric default null,
  p_discount_reason  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.parking_sessions%rowtype;
  v_vehicle   public.vehicles%rowtype;
  v_rule      public.pricing_rules%rowtype;
  v_rule_id   uuid := null;
  v_exit      timestamptz := now();
  v_due       numeric(10,2) := 0;
  v_collected numeric(10,2) := 0;
  v_status    text;
  v_method    text;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id and exit_time is null
  for update;

  if not found then
    raise exception 'لا توجد حركة دخول نشطة لهذه السيارة';
  end if;

  if v_exit < v_session.entry_time then
    raise exception 'وقت الخروج لا يمكن أن يكون قبل وقت الدخول';
  end if;

  -- ---------------- المبلغ المستحق ----------------
  if v_session.session_type = 'monthly' then
    v_due     := 0;
    v_status  := 'not_required';
    v_method  := null;
    v_rule_id := null;
  else
    select * into v_rule from public.active_pricing_rule();
    v_rule_id := v_rule.id;
    v_due     := public.calculate_parking_fee(v_session.entry_time, v_exit, v_rule_id);

    v_status := coalesce(nullif(btrim(coalesce(p_payment_status, '')), ''), 'unpaid');
    if v_status not in ('paid', 'unpaid', 'waived') then
      raise exception 'حالة الدفع غير صالحة';
    end if;

    if v_status = 'paid' then
      v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
      if v_method not in ('cash', 'transfer', 'other') then
        raise exception 'طريقة الدفع غير صالحة';
      end if;
    else
      v_method := null;
    end if;
  end if;

  -- ---------------- المبلغ المحصّل ----------------
  -- الواجهة لا تستطيع تمرير مبلغ أكبر من الفاتورة — الخصم فقط مسموح،
  -- والفاتورة نفسها تُحسب هنا ولا تُرسل من الواجهة إطلاقاً.
  if v_status = 'paid' then
    v_collected := coalesce(p_collected_amount, v_due);

    if v_collected < 0 then
      raise exception 'المبلغ المحصّل لا يمكن أن يكون سالباً';
    end if;

    if v_collected > v_due then
      raise exception
        'المبلغ المحصّل (%) لا يمكن أن يتجاوز المبلغ المستحق (%)',
        to_char(v_collected, 'FM9999990.00'), to_char(v_due, 'FM9999990.00');
    end if;
  elsif v_status = 'waived' then
    v_collected := 0;
  else
    v_collected := null;  -- غير مدفوع
  end if;

  update public.parking_sessions
  set exit_time        = v_exit,
      amount_due       = v_due,
      amount_collected = v_collected,
      adjustment       = case when v_collected is null then 0
                              else round(v_collected - v_due, 2) end,
      discount_reason  = case
                           when v_collected is not null and v_collected < v_due
                           then nullif(btrim(coalesce(p_discount_reason, '')), '')
                           else null
                         end,
      payment_status   = v_status,
      payment_method   = v_method,
      pricing_rule_id  = v_rule_id,
      notes            = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = p_session_id
  returning * into v_session;

  -- تسجيل الدفعة الفعلية بالمبلغ المحصّل
  if v_status = 'paid' and coalesce(v_collected, 0) > 0 then
    insert into public.payments (session_id, amount, payment_method, paid_at, created_by)
    values (v_session.id, v_collected, v_method, v_exit, auth.uid());
  end if;

  select * into v_vehicle from public.vehicles where id = v_session.vehicle_id;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'amount_due', v_due,
    'amount_collected', v_collected,
    'adjustment', v_session.adjustment,
    'payment_status', v_status
  );
end;
$$;

grant execute on function
  public.register_exit(uuid, text, text, text, numeric, text) to authenticated;

-- النسخة القديمة بأربعة معاملات لم تعد مستخدمة
drop function if exists public.register_exit(uuid, text, text, text);

-- ============================================================================
-- 6. تحصيل عملية غير مدفوعة — مع إمكانية الخصم
-- ============================================================================
create or replace function public.settle_session(
  p_session_id       uuid,
  p_payment_method   text    default 'cash',
  p_notes            text    default null,
  p_collected_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.parking_sessions%rowtype;
  v_method    text;
  v_collected numeric(10,2);
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'العملية غير موجودة';
  end if;

  if v_session.payment_status <> 'unpaid' then
    raise exception 'هذه العملية ليست بحالة غير مدفوع';
  end if;

  if v_session.exit_time is null then
    raise exception 'لا يمكن تحصيل مبلغ قبل تسجيل الخروج';
  end if;

  v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'transfer', 'other') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  v_collected := coalesce(p_collected_amount, v_session.amount_due);

  if v_collected < 0 then
    raise exception 'المبلغ المحصّل لا يمكن أن يكون سالباً';
  end if;

  if v_collected > v_session.amount_due then
    raise exception 'المبلغ المحصّل لا يمكن أن يتجاوز المبلغ المستحق';
  end if;

  update public.parking_sessions
  set payment_status   = 'paid',
      payment_method   = v_method,
      amount_collected = v_collected,
      adjustment       = round(v_collected - amount_due, 2),
      notes            = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = p_session_id
  returning * into v_session;

  if v_collected > 0 then
    insert into public.payments (session_id, amount, payment_method, created_by)
    values (v_session.id, v_collected, v_method, auth.uid());
  end if;

  return jsonb_build_object('session', to_jsonb(v_session));
end;
$$;

grant execute on function
  public.settle_session(uuid, text, text, numeric) to authenticated;
drop function if exists public.settle_session(uuid, text, text);

-- ============================================================================
-- 7. الخدمات
-- ============================================================================
create or replace function public.add_service(
  p_service_type   text,
  p_amount         numeric,
  p_vehicle_id     uuid    default null,
  p_session_id     uuid    default null,
  p_payment_status text    default 'paid',
  p_payment_method text    default 'cash',
  p_notes          text    default null,
  p_plate          text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid := p_vehicle_id;
  v_norm       text;
  v_service    public.services%rowtype;
  v_status     text;
  v_method     text;
begin
  perform public.assert_owner();

  if p_service_type not in ('wipe', 'wash', 'other') then
    raise exception 'نوع الخدمة غير صالح';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'قيمة الخدمة مطلوبة ويجب أن تكون أكبر من صفر';
  end if;

  if p_amount > 9999.99 then
    raise exception 'قيمة الخدمة كبيرة جداً';
  end if;

  -- تحديد السيارة: من المعرّف، أو من العملية، أو من رقم اللوحة
  if v_vehicle_id is null and p_session_id is not null then
    select vehicle_id into v_vehicle_id
    from public.parking_sessions where id = p_session_id;
  end if;

  if v_vehicle_id is null and nullif(btrim(coalesce(p_plate, '')), '') is not null then
    v_norm := public.normalize_plate(p_plate);
    select id into v_vehicle_id
    from public.vehicles where plate_normalized = v_norm;

    if v_vehicle_id is null then
      insert into public.vehicles (plate_number, created_by)
      values (btrim(p_plate), auth.uid())
      returning id into v_vehicle_id;
    end if;
  end if;

  v_status := coalesce(nullif(btrim(coalesce(p_payment_status, '')), ''), 'paid');
  if v_status not in ('paid', 'unpaid', 'waived') then
    raise exception 'حالة الدفع غير صالحة';
  end if;

  if v_status = 'paid' then
    v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
    if v_method not in ('cash', 'transfer', 'other') then
      raise exception 'طريقة الدفع غير صالحة';
    end if;
  else
    v_method := null;
  end if;

  insert into public.services (
    vehicle_id, session_id, service_type, amount,
    payment_status, payment_method, notes, created_by
  )
  values (
    v_vehicle_id, p_session_id, p_service_type, round(p_amount, 2),
    v_status, v_method, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  returning * into v_service;

  return jsonb_build_object('service', to_jsonb(v_service));
end;
$$;

grant execute on function
  public.add_service(text, numeric, uuid, uuid, text, text, text, text)
  to authenticated;

create or replace function public.delete_service(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_owner();
  delete from public.services where id = p_id;
  if not found then
    raise exception 'الخدمة غير موجودة';
  end if;
end;
$$;

grant execute on function public.delete_service(uuid) to authenticated;

-- ============================================================================
-- 8. المصاريف
-- ============================================================================
create or replace function public.add_expense(
  p_category text,
  p_amount   numeric,
  p_notes    text        default null,
  p_spent_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
begin
  perform public.assert_owner();

  if p_category not in ('water', 'electricity', 'staff', 'maintenance', 'other') then
    raise exception 'نوع المصروف غير صالح';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'قيمة المصروف مطلوبة ويجب أن تكون أكبر من صفر';
  end if;

  if p_amount > 99999.99 then
    raise exception 'قيمة المصروف كبيرة جداً';
  end if;

  insert into public.expenses (category, amount, notes, spent_at, created_by)
  values (
    p_category, round(p_amount, 2),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_spent_at, now()),
    auth.uid()
  )
  returning * into v_expense;

  return jsonb_build_object('expense', to_jsonb(v_expense));
end;
$$;

grant execute on function
  public.add_expense(text, numeric, text, timestamptz) to authenticated;

create or replace function public.delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_owner();
  delete from public.expenses where id = p_id;
  if not found then
    raise exception 'المصروف غير موجود';
  end if;
end;
$$;

grant execute on function public.delete_expense(uuid) to authenticated;

-- ============================================================================
-- 9. العروض
-- ============================================================================
drop view if exists public.service_details cascade;
create view public.service_details
with (security_invoker = true)
as
select
  s.id,
  s.service_type,
  s.amount,
  s.payment_status,
  s.payment_method,
  s.notes,
  s.performed_at,
  public.amman_date(s.performed_at) as business_date,
  s.session_id,
  s.vehicle_id,
  v.plate_number,
  v.owner_name,
  s.created_at
from public.services s
left join public.vehicles v on v.id = s.vehicle_id;

drop view if exists public.expense_details cascade;
create view public.expense_details
with (security_invoker = true)
as
select
  e.id,
  e.category,
  e.amount,
  e.notes,
  e.spent_at,
  public.amman_date(e.spent_at) as business_date,
  e.created_at
from public.expenses e;

-- تحديث عرض تفاصيل العمليات ليشمل المحصّل والخصم
drop view if exists public.session_details cascade;
create view public.session_details
with (security_invoker = true)
as
select
  s.id,
  v.plate_number,
  v.owner_name,
  v.phone,
  s.session_type,
  s.entry_time,
  s.exit_time,
  public.amman_date(coalesce(s.exit_time, s.entry_time)) as business_date,
  case
    when s.exit_time is null then null
    else round(extract(epoch from (s.exit_time - s.entry_time)) / 60.0)::int
  end as duration_minutes,
  s.amount_due,
  s.amount_collected,
  s.adjustment,
  s.discount_reason,
  s.payment_status,
  s.payment_method,
  s.notes,
  s.vehicle_id,
  coalesce((
    select sum(sv.amount) from public.services sv where sv.session_id = s.id
  ), 0)::numeric(10,2) as services_total,
  s.created_at
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id;

alter table public.services enable row level security;
alter table public.expenses enable row level security;

revoke all on public.services from anon, authenticated;
revoke all on public.expenses from anon, authenticated;
grant select on public.services to authenticated;
grant select on public.expenses to authenticated;

drop policy if exists "services_owner_select" on public.services;
create policy "services_owner_select"
  on public.services for select to authenticated
  using (public.is_owner());

drop policy if exists "expenses_owner_select" on public.expenses;
create policy "expenses_owner_select"
  on public.expenses for select to authenticated
  using (public.is_owner());

revoke all on public.service_details from anon;
revoke all on public.expense_details from anon;
revoke all on public.session_details from anon;
grant select on public.service_details to authenticated;
grant select on public.expense_details to authenticated;
grant select on public.session_details to authenticated;

-- ============================================================================
-- 10. لوحة التحكم — مع الخدمات والمصاريف والصافي
-- ============================================================================
create or replace function public.get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today          date;
  v_week_start     date;
  v_month_start    date;
  v_parking_today  numeric(10,2);
  v_services_today numeric(10,2);
  v_expenses_today numeric(10,2);
begin
  perform public.assert_owner();

  v_today      := public.amman_today();
  v_week_start := v_today - ((extract(dow from v_today))::int);
  v_month_start := date_trunc('month', v_today)::date;

  select coalesce(sum(amount_collected), 0)::numeric(10,2) into v_parking_today
  from public.parking_sessions
  where exit_time is not null
    and public.amman_date(exit_time) = v_today
    and payment_status = 'paid';

  select coalesce(sum(amount), 0)::numeric(10,2) into v_services_today
  from public.services
  where public.amman_date(performed_at) = v_today and payment_status = 'paid';

  select coalesce(sum(amount), 0)::numeric(10,2) into v_expenses_today
  from public.expenses
  where public.amman_date(spent_at) = v_today;

  return jsonb_build_object(
    'today', v_today,
    'is_closed_day', public.is_closed_day(v_today),

    'cars_inside', (
      select count(*) from public.parking_sessions where exit_time is null),
    'entries_today', (
      select count(*) from public.parking_sessions
      where public.amman_date(entry_time) = v_today),
    'exits_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today),
    'one_time_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
        and session_type = 'one_time'),
    'monthly_today', (
      select count(*) from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
        and session_type = 'monthly'),

    'parking_today',  v_parking_today,
    'services_today', v_services_today,
    'expenses_today', v_expenses_today,
    'revenue_today',  (v_parking_today + v_services_today)::numeric(10,2),
    'net_today',      (v_parking_today + v_services_today - v_expenses_today)::numeric(10,2),

    'services_count_today', (
      select count(*) from public.services
      where public.amman_date(performed_at) = v_today),
    'expenses_count_today', (
      select count(*) from public.expenses
      where public.amman_date(spent_at) = v_today),

    'discount_today', (
      select coalesce(sum(-adjustment), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
        and adjustment < 0),

    'unpaid_today', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
        and payment_status = 'unpaid'),

    'revenue_week', (
      (select coalesce(sum(amount_collected), 0) from public.parking_sessions
       where exit_time is not null
         and public.amman_date(exit_time) between v_week_start and v_today
         and payment_status = 'paid')
      + (select coalesce(sum(amount), 0) from public.services
         where public.amman_date(performed_at) between v_week_start and v_today
           and payment_status = 'paid')
    )::numeric(10,2),

    'revenue_month', (
      (select coalesce(sum(amount_collected), 0) from public.parking_sessions
       where exit_time is not null
         and public.amman_date(exit_time) between v_month_start and v_today
         and payment_status = 'paid')
      + (select coalesce(sum(amount), 0) from public.services
         where public.amman_date(performed_at) between v_month_start and v_today
           and payment_status = 'paid')
    )::numeric(10,2),

    'expenses_month', (
      select coalesce(sum(amount), 0)::numeric(10,2) from public.expenses
      where public.amman_date(spent_at) between v_month_start and v_today),

    'unpaid_total', (
      select coalesce(sum(amount_due), 0)::numeric(10,2)
      from public.parking_sessions
      where payment_status = 'unpaid' and exit_time is not null),
    'unpaid_count', (
      select count(*) from public.parking_sessions
      where payment_status = 'unpaid' and exit_time is not null),

    'active_subscriptions', (
      select count(*) from public.subscriptions
      where status = 'active' and start_date <= v_today and end_date >= v_today),
    'expiring_subscriptions', (
      select count(*) from public.subscriptions
      where status = 'active' and start_date <= v_today
        and end_date between v_today and (v_today + 7)),
    'total_vehicles', (
      select count(*) from public.vehicles where is_active)
  );
end;
$$;

grant execute on function public.get_dashboard() to authenticated;

-- ============================================================================
-- 11. التقرير — مع الخدمات والمصاريف والخصومات والصافي
-- ============================================================================
create or replace function public.get_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals jsonb;
  v_days   jsonb;
begin
  perform public.assert_owner();

  if p_from is null or p_to is null then
    raise exception 'يجب تحديد تاريخ البداية والنهاية';
  end if;
  if p_to < p_from then
    raise exception 'تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية';
  end if;
  if (p_to - p_from) > 366 then
    raise exception 'المدة المطلوبة طويلة جداً — الحد الأقصى سنة واحدة';
  end if;

  select jsonb_build_object(
    'sessions',      coalesce(s.sessions, 0),
    'one_time',      coalesce(s.one_time, 0),
    'monthly',       coalesce(s.monthly, 0),
    'paid_count',    coalesce(s.paid_count, 0),
    'unpaid_count',  coalesce(s.unpaid_count, 0),
    'waived_count',  coalesce(s.waived_count, 0),
    'parking_revenue', coalesce(s.parking_revenue, 0),
    'billed_total',  coalesce(s.billed_total, 0),
    'discount_total', coalesce(s.discount_total, 0),
    'unpaid_amount', coalesce(s.unpaid_amount, 0),
    'services_count', coalesce(sv.cnt, 0),
    'services_revenue', coalesce(sv.revenue, 0),
    'expenses_count', coalesce(ex.cnt, 0),
    'expenses_total', coalesce(ex.total, 0),
    'total_revenue', (coalesce(s.parking_revenue, 0) + coalesce(sv.revenue, 0))::numeric(10,2),
    'net_revenue',   (coalesce(s.parking_revenue, 0) + coalesce(sv.revenue, 0)
                      - coalesce(ex.total, 0))::numeric(10,2)
  )
  into v_totals
  from
    (select
       count(*)                                                   as sessions,
       count(*) filter (where session_type = 'one_time')          as one_time,
       count(*) filter (where session_type = 'monthly')           as monthly,
       count(*) filter (where payment_status = 'paid')            as paid_count,
       count(*) filter (where payment_status = 'unpaid')          as unpaid_count,
       count(*) filter (where payment_status = 'waived')          as waived_count,
       coalesce(sum(amount_collected) filter (where payment_status = 'paid'), 0)::numeric(10,2) as parking_revenue,
       coalesce(sum(amount_due), 0)::numeric(10,2)                as billed_total,
       coalesce(sum(-adjustment) filter (where adjustment < 0), 0)::numeric(10,2) as discount_total,
       coalesce(sum(amount_due) filter (where payment_status = 'unpaid'), 0)::numeric(10,2) as unpaid_amount
     from public.parking_sessions
     where exit_time is not null
       and public.amman_date(exit_time) between p_from and p_to) s
  cross join
    (select count(*) as cnt,
            coalesce(sum(amount) filter (where payment_status = 'paid'), 0)::numeric(10,2) as revenue
     from public.services
     where public.amman_date(performed_at) between p_from and p_to) sv
  cross join
    (select count(*) as cnt, coalesce(sum(amount), 0)::numeric(10,2) as total
     from public.expenses
     where public.amman_date(spent_at) between p_from and p_to) ex;

  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
  into v_days
  from (
    select
      g.day::date as day,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null
          and public.amman_date(ps.exit_time) = g.day::date) as sessions,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null and ps.session_type = 'one_time'
          and public.amman_date(ps.exit_time) = g.day::date) as one_time,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null and ps.session_type = 'monthly'
          and public.amman_date(ps.exit_time) = g.day::date) as monthly,
      (select coalesce(sum(ps.amount_collected), 0)::numeric(10,2)
         from public.parking_sessions ps
        where ps.exit_time is not null and ps.payment_status = 'paid'
          and public.amman_date(ps.exit_time) = g.day::date) as parking_revenue,
      (select coalesce(sum(sv.amount), 0)::numeric(10,2) from public.services sv
        where sv.payment_status = 'paid'
          and public.amman_date(sv.performed_at) = g.day::date) as services_revenue,
      (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
        where public.amman_date(e.spent_at) = g.day::date) as expenses_total,
      (select coalesce(sum(ps.amount_due), 0)::numeric(10,2)
         from public.parking_sessions ps
        where ps.exit_time is not null and ps.payment_status = 'unpaid'
          and public.amman_date(ps.exit_time) = g.day::date) as unpaid_amount
    from generate_series(p_from, p_to, interval '1 day') as g(day)
  ) d;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', v_totals, 'days', v_days
  );
end;
$$;

grant execute on function public.get_report(date, date) to authenticated;


-- ==============================================================================
-- انتهى التثبيت
-- ==============================================================================

do $$
begin
  raise notice 'تم تثبيت Blue Parking بنجاح. شغّل supabase/tests/verify.sql للتأكد.';
end $$;
