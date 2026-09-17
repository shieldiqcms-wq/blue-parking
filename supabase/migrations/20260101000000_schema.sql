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

create trigger vehicles_normalize
  before insert or update of plate_number on public.vehicles
  for each row execute function public.tg_vehicles_normalize();

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
