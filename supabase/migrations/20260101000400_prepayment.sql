-- ============================================================================
-- Blue Parking — 0005 : الدفع عند الدخول (الدفع المسبق)
-- ----------------------------------------------------------------------------
-- يضيف:
--   1) تحصيل رسوم الوقوف كاملة أو جزئياً لحظة الدخول
--   2) إضافة خدمة (غسيل/تمسيح) لحظة الدخول في نفس العملية
--   3) عند الخروج: يُحتسب المدفوع مقدماً ويُطلب الباقي فقط
--
-- تغيير مهم في احتساب الإيراد:
--   كان الإيراد يُنسب إلى **تاريخ الخروج**. مع الدفع المسبق يصبح هذا خاطئاً:
--   سيارة تدفع صباحاً وتخرج بعد يومين تُظهر دخل اليوم أقل من النقد الفعلي
--   في الصندوق، وسيارة ما زالت داخل الموقف لا يُحتسب ما دفعته أصلاً.
--
--   لذلك أصبح إيراد الوقوف يُحتسب من جدول payments حسب **تاريخ قبض النقد**.
--   هذا هو السلوك الصحيح لصندوق يومي تُدفع منه المصاريف.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. أعمدة الدفع المسبق
-- ----------------------------------------------------------------------------
alter table public.parking_sessions
  add column if not exists prepaid_amount numeric(10,2) not null default 0,
  add column if not exists prepaid_at     timestamptz,
  add column if not exists prepaid_method text;

comment on column public.parking_sessions.prepaid_amount is
  'ما دُفع من رسوم الوقوف لحظة الدخول. الباقي يُحصَّل عند الخروج.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_prepaid_valid'
      and conrelid = 'public.parking_sessions'::regclass
  ) then
    alter table public.parking_sessions
      add constraint session_prepaid_valid
      check (prepaid_amount >= 0 and prepaid_amount <= 9999.99);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'session_prepaid_method_valid'
      and conrelid = 'public.parking_sessions'::regclass
  ) then
    alter table public.parking_sessions
      add constraint session_prepaid_method_valid
      check (prepaid_method is null
             or prepaid_method in ('cash', 'transfer', 'other'));
  end if;
end $$;

create index if not exists parking_sessions_prepaid_idx
  on public.parking_sessions(prepaid_amount)
  where prepaid_amount > 0;

-- ============================================================================
-- 2. تسجيل الدخول — مع الدفع المسبق والخدمة الاختيارية
-- ============================================================================
create or replace function public.register_entry(
  p_plate           text,
  p_owner_name      text    default null,
  p_phone           text    default null,
  p_notes           text    default null,
  p_prepaid_amount  numeric default null,
  p_prepaid_method  text    default 'cash',
  p_service_type    text    default null,
  p_service_amount  numeric default null,
  p_service_notes   text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm     text;
  v_vehicle  public.vehicles%rowtype;
  v_sub      public.subscriptions%rowtype;
  v_session  public.parking_sessions%rowtype;
  v_service  public.services%rowtype;
  v_is_new   boolean := false;
  v_type     text;
  v_prepaid  numeric(10,2) := 0;
  v_method   text := null;
  v_status   text;
begin
  perform public.assert_owner();

  v_norm := public.normalize_plate(p_plate);
  if v_norm is null then
    raise exception 'رقم اللوحة مطلوب';
  end if;

  -- ---------------- التحقق من المدخلات المالية ----------------
  v_prepaid := coalesce(p_prepaid_amount, 0);

  if v_prepaid < 0 then
    raise exception 'المبلغ المدفوع مقدماً لا يمكن أن يكون سالباً';
  end if;
  if v_prepaid > 9999.99 then
    raise exception 'المبلغ المدفوع مقدماً كبير جداً';
  end if;

  if v_prepaid > 0 then
    v_method := coalesce(nullif(btrim(coalesce(p_prepaid_method, '')), ''), 'cash');
    if v_method not in ('cash', 'transfer', 'other') then
      raise exception 'طريقة الدفع غير صالحة';
    end if;
  end if;

  if p_service_type is not null
     and p_service_type not in ('wipe', 'wash', 'other') then
    raise exception 'نوع الخدمة غير صالح';
  end if;

  if p_service_type is not null
     and (p_service_amount is null or p_service_amount <= 0) then
    raise exception 'قيمة الخدمة مطلوبة ويجب أن تكون أكبر من صفر';
  end if;

  -- ---------------- السيارة ----------------
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

  -- ---------------- الاشتراك ----------------
  select * into v_sub from public.active_subscription_for(v_vehicle.id);
  v_type := case when v_sub.id is null then 'one_time' else 'monthly' end;

  -- السيارة المشتركة لا تُدفع عنها رسوم وقوف مقدماً
  if v_type = 'monthly' and v_prepaid > 0 then
    raise exception
      'السيارة مشتركة شهرياً ولا تُحتسب عليها رسوم وقوف — لا حاجة للدفع المسبق';
  end if;

  v_status := case
                when v_type = 'monthly' then 'not_required'
                else 'unpaid'
              end;

  insert into public.parking_sessions (
    vehicle_id, session_type, entry_time,
    subscription_id, amount_due, payment_status, notes, created_by,
    prepaid_amount, prepaid_at, prepaid_method
  )
  values (
    v_vehicle.id, v_type, now(), v_sub.id, 0, v_status,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(),
    v_prepaid,
    case when v_prepaid > 0 then now() else null end,
    v_method
  )
  returning * into v_session;

  -- ---------------- قيد الدفعة المسبقة ----------------
  -- تُسجَّل في payments فوراً لأن النقد دخل الصندوق الآن، لا عند الخروج.
  if v_prepaid > 0 then
    insert into public.payments (session_id, amount, payment_method, paid_at, notes, created_by)
    values (v_session.id, v_prepaid, v_method, now(), 'دفع عند الدخول', auth.uid());
  end if;

  -- ---------------- الخدمة الاختيارية ----------------
  if p_service_type is not null then
    insert into public.services (
      vehicle_id, session_id, service_type, amount,
      payment_status, payment_method, notes, created_by
    )
    values (
      v_vehicle.id, v_session.id, p_service_type, round(p_service_amount, 2),
      'paid', coalesce(v_method, 'cash'),
      nullif(btrim(coalesce(p_service_notes, '')), ''), auth.uid()
    )
    returning * into v_service;
  end if;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'subscription', case when v_sub.id is null then null else to_jsonb(v_sub) end,
    'is_new_vehicle', v_is_new,
    'prepaid_amount', v_prepaid,
    'service', case when v_service.id is null then null else to_jsonb(v_service) end
  );
end;
$$;

grant execute on function public.register_entry(
  text, text, text, text, numeric, text, text, numeric, text
) to authenticated;

drop function if exists public.register_entry(text, text, text, text);

-- ============================================================================
-- 3. معاينة الخروج — تُظهر المدفوع مقدماً والباقي
-- ============================================================================
create or replace function public.preview_exit(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session   public.parking_sessions%rowtype;
  v_vehicle   public.vehicles%rowtype;
  v_rule      public.pricing_rules%rowtype;
  v_now       timestamptz := now();
  v_due       numeric(10,2) := 0;
  v_remaining numeric(10,2) := 0;
  v_has_rule  boolean := false;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id and exit_time is null;

  if not found then
    raise exception 'لا توجد حركة دخول نشطة لهذه السيارة';
  end if;

  select * into v_vehicle from public.vehicles where id = v_session.vehicle_id;

  if v_session.session_type <> 'monthly' then
    select * into v_rule from public.active_pricing_rule();
    v_has_rule := true;
    v_due := public.calculate_parking_fee(v_session.entry_time, v_now, v_rule.id);
  end if;

  v_remaining := greatest(0, round(v_due - v_session.prepaid_amount, 2));

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'pricing_rule', case when v_has_rule then to_jsonb(v_rule) else null end,
    'amount_due', v_due,
    'prepaid_amount', v_session.prepaid_amount,
    'remaining_amount', v_remaining,
    'estimated_exit', v_now,
    'duration_minutes', round(extract(epoch from (v_now - v_session.entry_time)) / 60.0),
    'services_total', coalesce((
      select sum(amount) from public.services where session_id = v_session.id
    ), 0)::numeric(10,2)
  );
end;
$$;

grant execute on function public.preview_exit(uuid) to authenticated;

-- ============================================================================
-- 4. تسجيل الخروج — يحتسب المدفوع مقدماً
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
  v_remaining numeric(10,2) := 0;
  v_now_paid  numeric(10,2) := 0;
  v_total     numeric(10,2) := 0;
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

  -- الباقي بعد خصم ما دُفع عند الدخول
  v_remaining := greatest(0, round(v_due - v_session.prepaid_amount, 2));

  -- ---------------- ما يُحصَّل الآن ----------------
  if v_status = 'paid' then
    v_now_paid := coalesce(p_collected_amount, v_remaining);

    if v_now_paid < 0 then
      raise exception 'المبلغ المحصّل لا يمكن أن يكون سالباً';
    end if;

    if v_now_paid > v_remaining then
      raise exception
        'المبلغ المحصّل (%) لا يمكن أن يتجاوز المتبقّي (%)',
        to_char(v_now_paid, 'FM9999990.00'), to_char(v_remaining, 'FM9999990.00');
    end if;

    v_total := round(v_session.prepaid_amount + v_now_paid, 2);

  elsif v_status = 'waived' then
    v_now_paid := 0;
    v_total    := v_session.prepaid_amount;

  else
    -- غير مدفوع: ما دُفع مقدماً يبقى محصّلاً، والباقي دَيْن
    v_now_paid := 0;
    v_total    := case when v_session.prepaid_amount > 0
                       then v_session.prepaid_amount else null end;
  end if;

  update public.parking_sessions
  set exit_time        = v_exit,
      amount_due       = v_due,
      amount_collected = v_total,
      adjustment       = case when v_total is null then 0
                              else round(v_total - v_due, 2) end,
      discount_reason  = case
                           when v_total is not null and v_total < v_due
                           then nullif(btrim(coalesce(p_discount_reason, '')), '')
                           else null
                         end,
      payment_status   = v_status,
      payment_method   = coalesce(v_method, prepaid_method),
      pricing_rule_id  = v_rule_id,
      notes            = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = p_session_id
  returning * into v_session;

  -- قيد ما حُصِّل عند الخروج فقط (الدفعة المسبقة مُسجَّلة سابقاً)
  if v_now_paid > 0 then
    insert into public.payments (session_id, amount, payment_method, paid_at, created_by)
    values (v_session.id, v_now_paid, v_method, v_exit, auth.uid());
  end if;

  select * into v_vehicle from public.vehicles where id = v_session.vehicle_id;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'vehicle', to_jsonb(v_vehicle),
    'amount_due', v_due,
    'prepaid_amount', v_session.prepaid_amount,
    'collected_now', v_now_paid,
    'amount_collected', v_total,
    'adjustment', v_session.adjustment,
    'payment_status', v_status
  );
end;
$$;

grant execute on function
  public.register_exit(uuid, text, text, text, numeric, text) to authenticated;

-- ============================================================================
-- 5. تحديث عرض تفاصيل العمليات
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
  coalesce((
    select sum(sv.amount) from public.services sv where sv.session_id = s.id
  ), 0)::numeric(10,2) as services_total,
  s.created_at
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id;

revoke all on public.session_details from anon;
grant select on public.session_details to authenticated;

-- ============================================================================
-- 6. لوحة التحكم — الإيراد حسب تاريخ قبض النقد
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

  v_today       := public.amman_today();
  v_week_start  := v_today - ((extract(dow from v_today))::int);
  v_month_start := date_trunc('month', v_today)::date;

  -- إيراد الوقوف = النقد المقبوض اليوم (يشمل الدفع عند الدخول)
  select coalesce(sum(amount), 0)::numeric(10,2) into v_parking_today
  from public.payments
  where public.amman_date(paid_at) = v_today;

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

    'prepaid_today', (
      select coalesce(sum(amount), 0)::numeric(10,2) from public.payments
      where public.amman_date(paid_at) = v_today and notes = 'دفع عند الدخول'),

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
      select coalesce(sum(greatest(0, amount_due - prepaid_amount)), 0)::numeric(10,2)
      from public.parking_sessions
      where exit_time is not null and public.amman_date(exit_time) = v_today
        and payment_status = 'unpaid'),

    'revenue_week', (
      (select coalesce(sum(amount), 0) from public.payments
       where public.amman_date(paid_at) between v_week_start and v_today)
      + (select coalesce(sum(amount), 0) from public.services
         where public.amman_date(performed_at) between v_week_start and v_today
           and payment_status = 'paid')
    )::numeric(10,2),

    'revenue_month', (
      (select coalesce(sum(amount), 0) from public.payments
       where public.amman_date(paid_at) between v_month_start and v_today)
      + (select coalesce(sum(amount), 0) from public.services
         where public.amman_date(performed_at) between v_month_start and v_today
           and payment_status = 'paid')
    )::numeric(10,2),

    'expenses_month', (
      select coalesce(sum(amount), 0)::numeric(10,2) from public.expenses
      where public.amman_date(spent_at) between v_month_start and v_today),

    'unpaid_total', (
      select coalesce(sum(greatest(0, amount_due - prepaid_amount)), 0)::numeric(10,2)
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
-- 7. التقرير — الإيراد حسب تاريخ قبض النقد
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
    'parking_revenue', coalesce(pm.total, 0),
    'prepaid_total', coalesce(pm.prepaid, 0),
    'billed_total',  coalesce(s.billed_total, 0),
    'discount_total', coalesce(s.discount_total, 0),
    'unpaid_amount', coalesce(s.unpaid_amount, 0),
    'services_count', coalesce(sv.cnt, 0),
    'services_revenue', coalesce(sv.revenue, 0),
    'expenses_count', coalesce(ex.cnt, 0),
    'expenses_total', coalesce(ex.total, 0),
    'total_revenue', (coalesce(pm.total, 0) + coalesce(sv.revenue, 0))::numeric(10,2),
    'net_revenue',   (coalesce(pm.total, 0) + coalesce(sv.revenue, 0)
                      - coalesce(ex.total, 0))::numeric(10,2)
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
      (select coalesce(sum(pm.amount), 0)::numeric(10,2) from public.payments pm
        where public.amman_date(pm.paid_at) = g.day::date) as parking_revenue,
      (select coalesce(sum(sv.amount), 0)::numeric(10,2) from public.services sv
        where sv.payment_status = 'paid'
          and public.amman_date(sv.performed_at) = g.day::date) as services_revenue,
      (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
        where public.amman_date(e.spent_at) = g.day::date) as expenses_total,
      (select coalesce(sum(greatest(0, ps.amount_due - ps.prepaid_amount)), 0)::numeric(10,2)
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
