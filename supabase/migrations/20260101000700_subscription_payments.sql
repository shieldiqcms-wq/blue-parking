-- ============================================================================
-- Blue Parking — 0008 : دفع الاشتراكات والتذكير بالمتأخر
-- ----------------------------------------------------------------------------
-- يضيف:
--   1) إنشاء اشتراك لسيارة غير مسجّلة (يشترك ويمشي بلا دخول)
--   2) ثلاثة خيارات دفع عند الاشتراك: الآن كاملاً / جزئياً / لاحقاً
--   3) سجل دفعات للاشتراك — يُدفع على دفعات متى شاء
--   4) الرصيد المتبقّي يظهر كتذكير في كل مرة تدخل فيها السيارة
--   5) دفعات الاشتراك تُحتسب في إيراد يوم قبضها وشهره
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. دفعات الاشتراكات
-- ----------------------------------------------------------------------------
create table if not exists public.subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  amount          numeric(10,2) not null,
  payment_method  text not null default 'cash',
  paid_at         timestamptz not null default now(),
  notes           text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),

  constraint sub_payments_amount_valid check (amount > 0 and amount <= 99999.99),
  constraint sub_payments_method_valid
    check (payment_method in ('cash', 'transfer', 'other'))
);

comment on table public.subscription_payments is
  'دفعات الاشتراكات الشهرية. تُحتسب في إيراد الموقف بتاريخ قبضها.';

create index if not exists sub_payments_subscription_idx
  on public.subscription_payments(subscription_id);
create index if not exists sub_payments_paid_idx
  on public.subscription_payments(paid_at desc);

alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;
grant select on public.subscription_payments to authenticated;

drop policy if exists "sub_payments_owner_select" on public.subscription_payments;
create policy "sub_payments_owner_select"
  on public.subscription_payments for select to authenticated
  using (public.is_owner());

-- ----------------------------------------------------------------------------
-- 2. رصيد الاشتراك
-- ----------------------------------------------------------------------------
-- security invoker: تخضع لسياسات RLS على الدفعات (المالك فقط)،
-- فلا يقرأ بها غير المالك أي مبلغ حتى لو عرف معرّف الاشتراك.
create or replace function public.subscription_paid(p_subscription_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(10,2)
  from public.subscription_payments
  where subscription_id = p_subscription_id;
$$;

grant execute on function public.subscription_paid(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. عرض حالة الاشتراكات — مع المدفوع والمتبقّي
-- ----------------------------------------------------------------------------
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
  coalesce(p.paid, 0)::numeric(10,2)          as paid_amount,
  greatest(0, coalesce(sub.monthly_amount, 0) - coalesce(p.paid, 0))::numeric(10,2)
                                              as balance,
  case
    when coalesce(sub.monthly_amount, 0) = 0 then 'no_amount'
    when coalesce(p.paid, 0) >= sub.monthly_amount then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                         as payment_state,
  p.last_paid_at,
  sub.created_at
from public.subscriptions sub
join public.vehicles v on v.id = sub.vehicle_id
left join lateral (
  select sum(sp.amount) as paid, max(sp.paid_at) as last_paid_at
  from public.subscription_payments sp
  where sp.subscription_id = sub.id
) p on true;

revoke all on public.subscription_status from anon;
grant select on public.subscription_status to authenticated;

-- ============================================================================
-- 4. إنشاء اشتراك — مع سيارة جديدة وخيار الدفع
-- ============================================================================
-- p_pay_mode:
--   'now'     : دُفع المبلغ كاملاً الآن
--   'partial' : دُفع جزء الآن والباقي لاحقاً
--   'later'   : لم يُدفع شيء الآن — يظهر تذكير عند كل دخول
create or replace function public.create_subscription(
  p_start_date     date,
  p_end_date       date,
  p_monthly_amount numeric default null,
  p_pay_mode       text    default 'later',
  p_paid_amount    numeric default null,
  p_payment_method text    default 'cash',
  p_vehicle_id     uuid    default null,
  p_plate          text    default null,
  p_owner_name     text    default null,
  p_phone          text    default null,
  p_notes          text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle   public.vehicles%rowtype;
  v_sub       public.subscriptions%rowtype;
  v_norm      text;
  v_is_new    boolean := false;
  v_amount    numeric(10,2);
  v_paid      numeric(10,2) := 0;
  v_method    text;
begin
  perform public.assert_owner();

  -- ---------------- التواريخ ----------------
  if p_start_date is null or p_end_date is null then
    raise exception 'تاريخ البداية والنهاية مطلوبان';
  end if;
  if p_end_date < p_start_date then
    raise exception 'تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية';
  end if;

  -- ---------------- المبلغ ----------------
  v_amount := case when p_monthly_amount is null or p_monthly_amount <= 0
                   then null else round(p_monthly_amount, 2) end;

  if p_pay_mode not in ('now', 'partial', 'later') then
    raise exception 'خيار الدفع غير صالح';
  end if;

  if p_pay_mode in ('now', 'partial') and v_amount is null then
    raise exception 'أدخل قيمة الاشتراك قبل تسجيل الدفع';
  end if;

  if p_pay_mode = 'now' then
    v_paid := v_amount;
  elsif p_pay_mode = 'partial' then
    v_paid := round(coalesce(p_paid_amount, 0), 2);
    if v_paid <= 0 then
      raise exception 'أدخل المبلغ المدفوع الآن';
    end if;
    if v_paid >= v_amount then
      raise exception 'المبلغ المدفوع يساوي قيمة الاشتراك أو أكثر — اختر «دفع كامل»';
    end if;
  end if;

  if v_paid > 0 then
    v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
    if v_method not in ('cash', 'transfer', 'other') then
      raise exception 'طريقة الدفع غير صالحة';
    end if;
  end if;

  -- ---------------- السيارة ----------------
  -- إما سيارة مسجّلة (بالمعرّف أو بالرقم)، أو تُنشأ الآن — لأن المشترك
  -- قد يشترك ويمشي دون أن يدخل الموقف.
  if p_vehicle_id is not null then
    select * into v_vehicle from public.vehicles where id = p_vehicle_id;
    if not found then
      raise exception 'السيارة غير موجودة';
    end if;
  else
    v_norm := public.normalize_plate(p_plate);
    if v_norm is null then
      raise exception 'رقم اللوحة مطلوب';
    end if;

    select * into v_vehicle from public.vehicles where plate_normalized = v_norm;

    if not found then
      insert into public.vehicles (plate_number, owner_name, phone, created_by)
      values (
        btrim(p_plate),
        nullif(btrim(coalesce(p_owner_name, '')), ''),
        nullif(btrim(coalesce(p_phone, '')), ''),
        auth.uid()
      )
      returning * into v_vehicle;
      v_is_new := true;
    else
      -- استكمال البيانات الناقصة فقط، دون الكتابة فوق الموجود
      update public.vehicles
      set owner_name = coalesce(owner_name, nullif(btrim(coalesce(p_owner_name, '')), '')),
          phone      = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), ''))
      where id = v_vehicle.id
      returning * into v_vehicle;
    end if;
  end if;

  if not v_vehicle.is_active then
    raise exception 'هذه السيارة موقوفة في النظام';
  end if;

  -- ---------------- الاشتراك ----------------
  insert into public.subscriptions (
    vehicle_id, start_date, end_date, status, monthly_amount, notes, created_by
  )
  values (
    v_vehicle.id, p_start_date, p_end_date, 'active', v_amount,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  )
  returning * into v_sub;

  if v_paid > 0 then
    insert into public.subscription_payments (subscription_id, amount, payment_method, notes, created_by)
    values (
      v_sub.id, v_paid, v_method,
      case when p_pay_mode = 'partial' then 'دفعة أولى' else 'دفع عند الاشتراك' end,
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'subscription', to_jsonb(v_sub),
    'vehicle', to_jsonb(v_vehicle),
    'is_new_vehicle', v_is_new,
    'paid_amount', v_paid,
    'balance', greatest(0, coalesce(v_amount, 0) - v_paid)
  );
end;
$$;

grant execute on function public.create_subscription(
  date, date, numeric, text, numeric, text, uuid, text, text, text, text
) to authenticated;

-- ============================================================================
-- 5. تحصيل دفعة لاحقة على اشتراك
-- ============================================================================
create or replace function public.pay_subscription(
  p_subscription_id uuid,
  p_amount          numeric default null,
  p_payment_method  text    default 'cash',
  p_notes           text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub     public.subscriptions%rowtype;
  v_paid    numeric(10,2);
  v_balance numeric(10,2);
  v_amount  numeric(10,2);
  v_method  text;
begin
  perform public.assert_owner();

  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'الاشتراك غير موجود';
  end if;

  if coalesce(v_sub.monthly_amount, 0) <= 0 then
    raise exception 'لا توجد قيمة محددة لهذا الاشتراك — عدّل الاشتراك وأضف القيمة أولاً';
  end if;

  v_paid    := public.subscription_paid(v_sub.id);
  v_balance := greatest(0, v_sub.monthly_amount - v_paid);

  if v_balance <= 0 then
    raise exception 'الاشتراك مدفوع بالكامل';
  end if;

  -- بلا مبلغ = تحصيل كامل المتبقّي
  v_amount := round(coalesce(p_amount, v_balance), 2);

  if v_amount <= 0 then
    raise exception 'المبلغ يجب أن يكون أكبر من صفر';
  end if;
  if v_amount > v_balance then
    raise exception 'المبلغ (%) أكبر من المتبقّي (%)',
      to_char(v_amount, 'FM9999990.00'), to_char(v_balance, 'FM9999990.00');
  end if;

  v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'transfer', 'other') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  insert into public.subscription_payments (subscription_id, amount, payment_method, notes, created_by)
  values (v_sub.id, v_amount, v_method, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid());

  return jsonb_build_object(
    'subscription_id', v_sub.id,
    'paid_now', v_amount,
    'paid_total', v_paid + v_amount,
    'balance', v_balance - v_amount
  );
end;
$$;

grant execute on function public.pay_subscription(uuid, numeric, text, text) to authenticated;

-- ============================================================================
-- 6. البحث عن لوحة — مع رصيد الاشتراك للتذكير
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
  v_paid    numeric(10,2) := 0;
begin
  perform public.assert_owner();

  v_norm := public.normalize_plate(p_plate);
  if v_norm is null then
    raise exception 'رقم اللوحة مطلوب';
  end if;

  select * into v_vehicle from public.vehicles where plate_normalized = v_norm;

  if not found then
    return jsonb_build_object(
      'found', false, 'normalized', v_norm,
      'vehicle', null, 'subscription', null, 'active_session', null,
      'subscription_paid', 0, 'subscription_balance', 0,
      'is_closed_day', public.is_closed_day()
    );
  end if;

  select * into v_sub from public.active_subscription_for(v_vehicle.id);
  select * into v_session
  from public.parking_sessions
  where vehicle_id = v_vehicle.id and exit_time is null;

  if v_sub.id is not null then
    v_paid := public.subscription_paid(v_sub.id);
  end if;

  return jsonb_build_object(
    'found', true,
    'normalized', v_norm,
    'vehicle', to_jsonb(v_vehicle),
    'subscription', case when v_sub.id is null then null else to_jsonb(v_sub) end,
    'active_session', case when v_session.id is null then null else to_jsonb(v_session) end,
    'subscription_paid', v_paid,
    'subscription_balance', case
      when v_sub.id is null then 0
      else greatest(0, coalesce(v_sub.monthly_amount, 0) - v_paid)
    end,
    'is_closed_day', public.is_closed_day()
  );
end;
$$;

grant execute on function public.lookup_plate(text) to authenticated;

-- ============================================================================
-- 7. تفاصيل العمليات — مع بيانات الاشتراك (لتقرير PDF)
-- ============================================================================
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
  public.amman_date(s.entry_time)                        as entry_date,
  case
    when s.exit_time is null then null
    else round(extract(epoch from (s.exit_time - s.entry_time)) / 60.0)::int
  end as duration_minutes,
  s.amount_due,
  s.amount_collected,
  s.prepaid_amount,
  s.adjustment,
  s.discount_reason,
  s.payment_status,
  s.payment_method,
  s.notes,
  s.vehicle_id,
  s.subscription_id,
  sub.monthly_amount                                     as subscription_amount,
  case when sub.id is null then null
       else greatest(0, coalesce(sub.monthly_amount, 0)
                        - public.subscription_paid(sub.id))
  end::numeric(10,2)                                     as subscription_balance,
  coalesce((
    select sum(sv.amount) from public.services sv where sv.session_id = s.id
  ), 0)::numeric(10,2) as services_total,
  s.created_at
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id
left join public.subscriptions sub on sub.id = s.subscription_id;

revoke all on public.session_details from anon;
grant select on public.session_details to authenticated;

-- دفعات الاشتراكات مع اللوحة وتاريخ القبض بتوقيت الأردن — لتقرير PDF
drop view if exists public.subscription_payment_details cascade;
create view public.subscription_payment_details
with (security_invoker = true)
as
select
  p.id,
  p.subscription_id,
  p.amount,
  p.payment_method,
  p.paid_at,
  public.amman_date(p.paid_at) as business_date,
  p.notes,
  sub.vehicle_id,
  sub.monthly_amount           as subscription_amount,
  sub.start_date,
  sub.end_date,
  v.plate_number,
  v.owner_name
from public.subscription_payments p
join public.subscriptions sub on sub.id = p.subscription_id
join public.vehicles v on v.id = sub.vehicle_id;

revoke all on public.subscription_payment_details from anon;
grant select on public.subscription_payment_details to authenticated;

-- ============================================================================
-- 8. لوحة التحكم — دفعات الاشتراكات ضمن إيراد اليوم والشهر
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
  v_visits_today   numeric(10,2);
  v_subs_today     numeric(10,2);
  v_parking_today  numeric(10,2);
  v_services_today numeric(10,2);
  v_expenses_today numeric(10,2);
begin
  perform public.assert_owner();

  v_today       := public.amman_today();
  v_week_start  := v_today - ((extract(dow from v_today))::int);
  v_month_start := date_trunc('month', v_today)::date;

  select coalesce(sum(amount), 0)::numeric(10,2) into v_visits_today
  from public.payments where public.amman_date(paid_at) = v_today;

  select coalesce(sum(amount), 0)::numeric(10,2) into v_subs_today
  from public.subscription_payments where public.amman_date(paid_at) = v_today;

  v_parking_today := v_visits_today + v_subs_today;

  select coalesce(sum(amount), 0)::numeric(10,2) into v_services_today
  from public.services
  where public.amman_date(performed_at) = v_today and payment_status = 'paid';

  select coalesce(sum(amount), 0)::numeric(10,2) into v_expenses_today
  from public.expenses where public.amman_date(spent_at) = v_today;

  return jsonb_build_object(
    'today', v_today,
    'is_closed_day', public.is_closed_day(v_today),

    'cars_inside', (select count(*) from public.parking_sessions where exit_time is null),
    'entries_today', (select count(*) from public.parking_sessions
                      where public.amman_date(entry_time) = v_today),
    'exits_today', (select count(*) from public.parking_sessions
                    where exit_time is not null and public.amman_date(exit_time) = v_today),
    'one_time_today', (select count(*) from public.parking_sessions
                       where exit_time is not null and public.amman_date(exit_time) = v_today
                         and session_type = 'one_time'),
    'monthly_today', (select count(*) from public.parking_sessions
                      where exit_time is not null and public.amman_date(exit_time) = v_today
                        and session_type = 'monthly'),

    'parking_today',       v_parking_today,
    'subscriptions_today', v_subs_today,
    'services_today',      v_services_today,
    'expenses_today',      v_expenses_today,
    'revenue_today',       (v_parking_today + v_services_today)::numeric(10,2),
    'net_today',           (v_parking_today + v_services_today - v_expenses_today)::numeric(10,2),

    'prepaid_today', (select coalesce(sum(amount), 0)::numeric(10,2) from public.payments
                      where public.amman_date(paid_at) = v_today and notes = 'دفع عند الدخول'),
    'services_count_today', (select count(*) from public.services
                             where public.amman_date(performed_at) = v_today),
    'expenses_count_today', (select count(*) from public.expenses
                             where public.amman_date(spent_at) = v_today),
    'discount_today', (select coalesce(sum(-adjustment), 0)::numeric(10,2)
                       from public.parking_sessions
                       where exit_time is not null and public.amman_date(exit_time) = v_today
                         and adjustment < 0),
    'unpaid_today', (select coalesce(sum(greatest(0, amount_due - prepaid_amount)), 0)::numeric(10,2)
                     from public.parking_sessions
                     where exit_time is not null and public.amman_date(exit_time) = v_today
                       and payment_status = 'unpaid'),

    'revenue_week', (
      (select coalesce(sum(amount), 0) from public.payments
        where public.amman_date(paid_at) between v_week_start and v_today)
      + (select coalesce(sum(amount), 0) from public.subscription_payments
          where public.amman_date(paid_at) between v_week_start and v_today)
      + (select coalesce(sum(amount), 0) from public.services
          where public.amman_date(performed_at) between v_week_start and v_today
            and payment_status = 'paid')
    )::numeric(10,2),

    'revenue_month', (
      (select coalesce(sum(amount), 0) from public.payments
        where public.amman_date(paid_at) between v_month_start and v_today)
      + (select coalesce(sum(amount), 0) from public.subscription_payments
          where public.amman_date(paid_at) between v_month_start and v_today)
      + (select coalesce(sum(amount), 0) from public.services
          where public.amman_date(performed_at) between v_month_start and v_today
            and payment_status = 'paid')
    )::numeric(10,2),

    'subscriptions_month', (select coalesce(sum(amount), 0)::numeric(10,2)
                            from public.subscription_payments
                            where public.amman_date(paid_at) between v_month_start and v_today),

    'expenses_month', (select coalesce(sum(amount), 0)::numeric(10,2) from public.expenses
                       where public.amman_date(spent_at) between v_month_start and v_today),

    'unpaid_total', (select coalesce(sum(greatest(0, amount_due - prepaid_amount)), 0)::numeric(10,2)
                     from public.parking_sessions
                     where payment_status = 'unpaid' and exit_time is not null),
    'unpaid_count', (select count(*) from public.parking_sessions
                     where payment_status = 'unpaid' and exit_time is not null),

    -- اشتراكات سارية عليها مبالغ متأخرة
    'subscriptions_due_count', (select count(*) from public.subscription_status
                                where computed_status = 'active' and balance > 0),
    'subscriptions_due_total', (select coalesce(sum(balance), 0)::numeric(10,2)
                                from public.subscription_status
                                where computed_status = 'active' and balance > 0),

    'active_subscriptions', (select count(*) from public.subscriptions
                             where status = 'active' and start_date <= v_today and end_date >= v_today),
    'expiring_subscriptions', (select count(*) from public.subscriptions
                               where status = 'active' and start_date <= v_today
                                 and end_date between v_today and (v_today + 7)),
    'total_vehicles', (select count(*) from public.vehicles where is_active)
  );
end;
$$;

grant execute on function public.get_dashboard() to authenticated;

-- ============================================================================
-- 9. التقرير — دفعات الاشتراكات ضمن إيراد الموقف
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
    'entries',       coalesce(en.cnt, 0),
    'one_time',      coalesce(s.one_time, 0),
    'monthly',       coalesce(s.monthly, 0),
    'paid_count',    coalesce(s.paid_count, 0),
    'unpaid_count',  coalesce(s.unpaid_count, 0),
    'waived_count',  coalesce(s.waived_count, 0),
    -- إيراد الموقف = دفعات الزيارات + دفعات الاشتراكات
    'visits_revenue',        coalesce(pm.total, 0),
    'subscription_revenue',  coalesce(sp.total, 0),
    'subscription_payments_count', coalesce(sp.cnt, 0),
    'parking_revenue', (coalesce(pm.total, 0) + coalesce(sp.total, 0))::numeric(10,2),
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
    'total_revenue', (coalesce(pm.total, 0) + coalesce(sp.total, 0)
                      + coalesce(sv.revenue, 0))::numeric(10,2),
    'net_revenue',   (coalesce(pm.total, 0) + coalesce(sp.total, 0)
                      + coalesce(sv.revenue, 0) - coalesce(ex.total, 0))::numeric(10,2),
    'parking_net',   (coalesce(pm.total, 0) + coalesce(sp.total, 0)
                      - coalesce(ex.parking, 0))::numeric(10,2),
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
    (select count(*) as cnt, coalesce(sum(amount), 0)::numeric(10,2) as total
     from public.subscription_payments
     where public.amman_date(paid_at) between p_from and p_to) sp
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

  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
  into v_days
  from (
    select
      x.day,
      x.entries, x.sessions, x.one_time, x.monthly,
      x.visits_revenue,
      x.subscription_revenue,
      (x.visits_revenue + x.subscription_revenue)::numeric(10,2) as parking_revenue,
      x.expenses_parking,
      x.services_count, x.services_revenue, x.expenses_wash,
      x.expenses_shared, x.expenses_total, x.unpaid_amount
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
          where public.amman_date(pm.paid_at) = g.day::date) as visits_revenue,
        (select coalesce(sum(sp.amount), 0)::numeric(10,2) from public.subscription_payments sp
          where public.amman_date(sp.paid_at) = g.day::date) as subscription_revenue,
        (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
          where e.cost_center = 'parking'
            and public.amman_date(e.spent_at) = g.day::date) as expenses_parking,
        (select count(*) from public.services sv
          where public.amman_date(sv.performed_at) = g.day::date) as services_count,
        (select coalesce(sum(sv.amount), 0)::numeric(10,2) from public.services sv
          where sv.payment_status = 'paid'
            and public.amman_date(sv.performed_at) = g.day::date) as services_revenue,
        (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
          where e.cost_center = 'wash'
            and public.amman_date(e.spent_at) = g.day::date) as expenses_wash,
        (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
          where e.cost_center = 'shared'
            and public.amman_date(e.spent_at) = g.day::date) as expenses_shared,
        (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
          where public.amman_date(e.spent_at) = g.day::date) as expenses_total,
        (select coalesce(sum(greatest(0, ps.amount_due - ps.prepaid_amount)), 0)::numeric(10,2)
           from public.parking_sessions ps
          where ps.exit_time is not null and ps.payment_status = 'unpaid'
            and public.amman_date(ps.exit_time) = g.day::date) as unpaid_amount
      from generate_series(p_from, p_to, interval '1 day') as g(day)
    ) x
  ) d;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', v_totals, 'days', v_days
  );
end;
$$;

grant execute on function public.get_report(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. مسح البيانات يشمل دفعات الاشتراكات (المرجع: supabase/sql/02_clear_data.sql)
-- ----------------------------------------------------------------------------
-- ON DELETE CASCADE على subscription_id يكفي: حذف الاشتراك يحذف دفعاته.

-- ============================================================================
-- 11. تشديد الصلاحيات: لا شيء متاح للدور المجهول (anon)
-- ----------------------------------------------------------------------------
-- Supabase يمنح EXECUTE تلقائياً لكل دالة جديدة في public — بما فيها الدور
-- المجهول. الدوال المضافة بعد ملف الحماية (0003 وما بعده) ورثت هذا المنح.
-- كل دوال التطبيق تتحقق من المالك داخلياً (assert_owner)، لكننا نسحب المنح
-- من الأساس كطبقة حماية ثانية. الدوال كلها ممنوحة صراحةً لـ authenticated.
-- ============================================================================
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- والدوال التي قد تُضاف مستقبلاً لا تُمنح للمجهول تلقائياً
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
