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
