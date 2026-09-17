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
create or replace view public.current_cars_inside
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
create or replace view public.session_details
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
create or replace view public.subscription_status
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
