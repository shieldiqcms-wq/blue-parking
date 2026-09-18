-- ============================================================================
-- Blue Parking — 0006 : مراكز التكلفة ومقارنة الأسابيع
-- ----------------------------------------------------------------------------
-- يضيف:
--   1) تخصيص كل مصروف: على الموقف أم على غسيل السيارات أم مشترك
--   2) حساب أرباح كل نشاط على حدة
--   3) عدد السيارات الداخلة يومياً للرسم البياني
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. مركز التكلفة للمصاريف
-- ----------------------------------------------------------------------------
-- parking : مصروف يخص الموقف (كهرباء الإنارة، حارس…)
-- wash    : مصروف يخص غسيل السيارات (ماء، مواد تنظيف…)
-- shared  : مصروف مشترك بين النشاطين (إيجار، كهرباء عامة…)
alter table public.expenses
  add column if not exists cost_center text not null default 'shared';

comment on column public.expenses.cost_center is
  'على أي نشاط يُحمّل المصروف: parking أو wash أو shared.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_cost_center_valid'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_cost_center_valid
      check (cost_center in ('parking', 'wash', 'shared'));
  end if;
end $$;

create index if not exists expenses_cost_center_idx
  on public.expenses(cost_center);

-- المصاريف السابقة: نُرجّح حسب التصنيف
-- الماء يخص الغسيل غالباً، والباقي يبقى مشتركاً حتى يصحّحه المالك.
update public.expenses
set cost_center = case
                    when category = 'water' then 'wash'
                    when category = 'staff' then 'parking'
                    else 'shared'
                  end
where cost_center = 'shared'
  and created_at < now();

-- ----------------------------------------------------------------------------
-- 2. إضافة مصروف — مع مركز التكلفة
-- ----------------------------------------------------------------------------
create or replace function public.add_expense(
  p_category    text,
  p_amount      numeric,
  p_notes       text        default null,
  p_spent_at    timestamptz default null,
  p_cost_center text        default 'shared'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
  v_center  text;
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

  v_center := coalesce(nullif(btrim(coalesce(p_cost_center, '')), ''), 'shared');
  if v_center not in ('parking', 'wash', 'shared') then
    raise exception 'مركز التكلفة غير صالح';
  end if;

  insert into public.expenses (category, amount, notes, spent_at, cost_center, created_by)
  values (
    p_category, round(p_amount, 2),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_spent_at, now()),
    v_center,
    auth.uid()
  )
  returning * into v_expense;

  return jsonb_build_object('expense', to_jsonb(v_expense));
end;
$$;

grant execute on function
  public.add_expense(text, numeric, text, timestamptz, text) to authenticated;
drop function if exists public.add_expense(text, numeric, text, timestamptz);

-- ----------------------------------------------------------------------------
-- 3. عرض المصاريف — مع مركز التكلفة
-- ----------------------------------------------------------------------------
drop view if exists public.expense_details cascade;
create view public.expense_details
with (security_invoker = true)
as
select
  e.id,
  e.category,
  e.cost_center,
  e.amount,
  e.notes,
  e.spent_at,
  public.amman_date(e.spent_at) as business_date,
  e.created_at
from public.expenses e;

revoke all on public.expense_details from anon;
grant select on public.expense_details to authenticated;

-- ============================================================================
-- 4. التقرير — أرباح كل نشاط + عدد الداخلين يومياً
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
  v_units  jsonb;
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

  -- ---------------------------- الإجماليات ----------------------------
  select jsonb_build_object(
    'sessions',      coalesce(s.sessions, 0),
    'entries',       coalesce(en.cnt, 0),
    'one_time',      coalesce(s.one_time, 0),
    'monthly',       coalesce(s.monthly, 0),
    'paid_count',    coalesce(s.paid_count, 0),
    'unpaid_count',  coalesce(s.unpaid_count, 0),
    'waived_count',  coalesce(s.waived_count, 0),
    'parking_revenue', coalesce(pm.total, 0),
    'prepaid_total', coalesce(pm.prepaid, 0),
    'billed_total',  coalesce(s.billed_total, 0),
    'discount_total', coalesce(s.discount_total, 0),
    'unpaid_amount', coalesce(s.unpaid_amount, 0),
    'services_count', coalesce(sv.cnt, 0),
    'services_revenue', coalesce(sv.revenue, 0),
    'expenses_count', coalesce(ex.cnt, 0),
    'expenses_total', coalesce(ex.total, 0),
    'expenses_parking', coalesce(ex.parking, 0),
    'expenses_wash',    coalesce(ex.wash, 0),
    'expenses_shared',  coalesce(ex.shared, 0),
    'total_revenue', (coalesce(pm.total, 0) + coalesce(sv.revenue, 0))::numeric(10,2),
    'net_revenue',   (coalesce(pm.total, 0) + coalesce(sv.revenue, 0)
                      - coalesce(ex.total, 0))::numeric(10,2),
    -- صافي كل نشاط قبل توزيع المصاريف المشتركة
    'parking_net',   (coalesce(pm.total, 0) - coalesce(ex.parking, 0))::numeric(10,2),
    'wash_net',      (coalesce(sv.revenue, 0) - coalesce(ex.wash, 0))::numeric(10,2)
  )
  into v_totals
  from
    (select
       count(*)                                          as sessions,
       count(*) filter (where session_type = 'one_time') as one_time,
       count(*) filter (where session_type = 'monthly')  as monthly,
       count(*) filter (where payment_status = 'paid')   as paid_count,
       count(*) filter (where payment_status = 'unpaid') as unpaid_count,
       count(*) filter (where payment_status = 'waived') as waived_count,
       coalesce(sum(amount_due), 0)::numeric(10,2)       as billed_total,
       coalesce(sum(-adjustment) filter (where adjustment < 0), 0)::numeric(10,2) as discount_total,
       coalesce(sum(greatest(0, amount_due - prepaid_amount))
                filter (where payment_status = 'unpaid'), 0)::numeric(10,2) as unpaid_amount
     from public.parking_sessions
     where exit_time is not null
       and public.amman_date(exit_time) between p_from and p_to) s
  cross join
    (select count(*) as cnt from public.parking_sessions
     where public.amman_date(entry_time) between p_from and p_to) en
  cross join
    (select coalesce(sum(amount), 0)::numeric(10,2) as total,
            coalesce(sum(amount) filter (where notes = 'دفع عند الدخول'), 0)::numeric(10,2) as prepaid
     from public.payments
     where public.amman_date(paid_at) between p_from and p_to) pm
  cross join
    (select count(*) as cnt,
            coalesce(sum(amount) filter (where payment_status = 'paid'), 0)::numeric(10,2) as revenue
     from public.services
     where public.amman_date(performed_at) between p_from and p_to) sv
  cross join
    (select count(*) as cnt,
            coalesce(sum(amount), 0)::numeric(10,2) as total,
            coalesce(sum(amount) filter (where cost_center = 'parking'), 0)::numeric(10,2) as parking,
            coalesce(sum(amount) filter (where cost_center = 'wash'), 0)::numeric(10,2) as wash,
            coalesce(sum(amount) filter (where cost_center = 'shared'), 0)::numeric(10,2) as shared
     from public.expenses
     where public.amman_date(spent_at) between p_from and p_to) ex;

  -- ------------------------------ الأيام ------------------------------
  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
  into v_days
  from (
    select
      g.day::date as day,
      (select count(*) from public.parking_sessions ps
        where public.amman_date(ps.entry_time) = g.day::date) as entries,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null
          and public.amman_date(ps.exit_time) = g.day::date) as sessions,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null and ps.session_type = 'one_time'
          and public.amman_date(ps.exit_time) = g.day::date) as one_time,
      (select count(*) from public.parking_sessions ps
        where ps.exit_time is not null and ps.session_type = 'monthly'
          and public.amman_date(ps.exit_time) = g.day::date) as monthly,
      (select coalesce(sum(pm.amount), 0)::numeric(10,2) from public.payments pm
        where public.amman_date(pm.paid_at) = g.day::date) as parking_revenue,
      (select coalesce(sum(sv.amount), 0)::numeric(10,2) from public.services sv
        where sv.payment_status = 'paid'
          and public.amman_date(sv.performed_at) = g.day::date) as services_revenue,
      (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
        where public.amman_date(e.spent_at) = g.day::date) as expenses_total,
      (select coalesce(sum(ps.amount_due - ps.prepaid_amount), 0)::numeric(10,2)
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

-- ============================================================================
-- 5. مقارنة الأسبوع الحالي بالسابق — للرسم البياني
-- ============================================================================
create or replace function public.get_weekly_comparison()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today       date;
  v_this_start  date;
  v_last_start  date;
  v_days        jsonb;
begin
  perform public.assert_owner();

  v_today      := public.amman_today();
  -- الأسبوع يبدأ يوم الأحد (العُرف في الأردن)
  v_this_start := v_today - ((extract(dow from v_today))::int);
  v_last_start := v_this_start - 7;

  select coalesce(jsonb_agg(x order by x.day_index), '[]'::jsonb)
  into v_days
  from (
    select
      i as day_index,
      (v_this_start + i)                                as this_date,
      (v_last_start + i)                                as last_date,
      -- مستقبلاً: الأيام التي لم تأتِ بعد تُعاد null لا صفر،
      -- حتى لا يبدو الرسم البياني وكأن الحركة انهارت.
      case when (v_this_start + i) <= v_today then (
        select count(*) from public.parking_sessions ps
        where public.amman_date(ps.entry_time) = (v_this_start + i)
      ) else null end                                   as this_count,
      (select count(*) from public.parking_sessions ps
        where public.amman_date(ps.entry_time) = (v_last_start + i)) as last_count,
      case when (v_this_start + i) <= v_today then (
        select coalesce(sum(pm.amount), 0)::numeric(10,2) from public.payments pm
        where public.amman_date(pm.paid_at) = (v_this_start + i)
      ) else null end                                   as this_revenue,
      (select coalesce(sum(pm.amount), 0)::numeric(10,2) from public.payments pm
        where public.amman_date(pm.paid_at) = (v_last_start + i)) as last_revenue
    from generate_series(0, 6) as g(i)
  ) x;

  return jsonb_build_object(
    'this_week_start', v_this_start,
    'last_week_start', v_last_start,
    'today', v_today,
    'this_week_total', (
      select count(*) from public.parking_sessions
      where public.amman_date(entry_time) between v_this_start and v_today),
    'last_week_total', (
      select count(*) from public.parking_sessions
      where public.amman_date(entry_time) between v_last_start and (v_last_start + 6)),
    -- نفس عدد الأيام المنقضية من الأسبوع، للمقارنة العادلة
    'last_week_same_period', (
      select count(*) from public.parking_sessions
      where public.amman_date(entry_time)
            between v_last_start and (v_last_start + (v_today - v_this_start))),
    'days', v_days
  );
end;
$$;

grant execute on function public.get_weekly_comparison() to authenticated;
