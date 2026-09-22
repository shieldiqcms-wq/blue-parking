-- ============================================================================
-- Blue Parking — تحويل زيارة «منتهية» إلى اشتراك
-- ----------------------------------------------------------------------------
-- للسيارة التي دخلت كزيارة عادية، ثم اشتركت، ثم خرجت قبل تصحيح دخولها.
-- (داخل التطبيق التصحيح متاح للسيارات الموجودة داخل الموقف فقط.)
--
-- ماذا يفعل — بلا حذف أي شيء:
--   1) يجد آخر زيارة منتهية للسيارة، والاشتراك المرتبط بها
--      (يغطي يوم الدخول، أو أُنشئ خلال يوم من الدخول)
--   2) يضيف قيداً عكسياً لكل دفعة على الزيارة بنفس تاريخها — فيصحّ صندوق
--      ذلك اليوم، وتبقى الدفعة الأصلية والقيد العكسي ظاهرين معاً
--   3) إن كانت دفعت فعلاً (الخيار أدناه): يُنقل المبلغ إلى دفعات الاشتراك
--   4) يحوّل الزيارة إلى دخول اشتراك (بلا رسوم)
--   5) يسجّل التعديل في سجل التعديلات مع القيم قبل وبعد
--
-- آمن للتشغيل مرتين: التشغيل الثاني لا يغيّر شيئاً ويخبرك بذلك.
-- كل شيء في خطوة واحدة: أي خطأ = لا يتغير أي شيء.
--
-- الاستخدام: Supabase Dashboard > SQL Editor > الصق الملف كاملاً > Run
--   قد يطلب SQL Editor تأكيداً لأن الملف فيه UPDATE — هذا متوقع، اضغط Run.
-- ============================================================================

do $$
declare
  -- ⬇️⬇️⬇️  الإعدادات — عدّل هنا فقط  ⬇️⬇️⬇️
  c_plate       constant text    := '46-89061';
  -- false = لم تدفع فعلاً (يُلغى المبلغ من دخل الوقوف)
  -- true  = دفعت فعلاً (يُنقل المبلغ إلى دفعات الاشتراك)
  c_paid_really constant boolean := false;
  -- null = آخر زيارة منتهية · أو حدّد يوم الدخول مثل '2026-09-22'
  c_entry_date  constant date    := null;
  -- ⬆️⬆️⬆️  لا تعدّل شيئاً تحت هذا السطر  ⬆️⬆️⬆️

  v_vehicle public.vehicles%rowtype;
  v_session public.parking_sessions%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_before  jsonb;
  v_net     numeric(10,2);
  v_balance numeric(10,2);
  v_first   record;
  v_reason  text;
  p         record;
begin
  perform set_config('bp.plate', c_plate, false);
  perform set_config('bp.result', '', false);

  -- ---------------- السيارة ----------------
  select * into v_vehicle
  from public.vehicles
  where plate_normalized = public.normalize_plate(c_plate);

  if not found then
    raise exception 'السيارة % غير موجودة في النظام — تأكد من رقم اللوحة', c_plate;
  end if;

  -- ---------------- منع التكرار ----------------
  if c_entry_date is null and exists (
    select 1
    from public.session_adjustments a
    join public.parking_sessions s on s.id = a.session_id
    where s.vehicle_id = v_vehicle.id
      and a.action = 'convert_to_subscription'
      and a.after_state ->> 'after_exit' = 'true'
  ) then
    perform set_config('bp.result',
      'لم يتغير شيء: زيارة هذه السيارة صُحّحت سابقاً. لتصحيح زيارة أخرى حدّد يومها في c_entry_date',
      false);
    return;
  end if;

  -- ---------------- الزيارة ----------------
  select * into v_session
  from public.parking_sessions
  where vehicle_id = v_vehicle.id
    and exit_time is not null
    and session_type = 'one_time'
    and (c_entry_date is null or public.amman_date(entry_time) = c_entry_date)
  order by entry_time desc
  limit 1
  for update;

  if not found then
    perform set_config('bp.result',
      'لم يتغير شيء: لا توجد زيارة عادية منتهية لهذه السيارة'
      || case when c_entry_date is null then '' else ' في اليوم المحدد' end,
      false);
    return;
  end if;

  -- ---------------- الاشتراك المرتبط بها ----------------
  select * into v_sub
  from public.subscriptions sub
  where sub.vehicle_id = v_vehicle.id
    and sub.status = 'active'
    and (
      public.amman_date(v_session.entry_time) between sub.start_date and sub.end_date
      or sub.created_at between v_session.entry_time and v_session.entry_time + interval '1 day'
    )
  order by sub.created_at desc
  limit 1;

  if not found then
    perform set_config('bp.result',
      'لم يتغير شيء: لا يوجد اشتراك يغطي يوم هذه الزيارة أو أُنشئ بعدها مباشرة — أنشئ الاشتراك أولاً',
      false);
    return;
  end if;

  v_before := public.session_money_state(v_session);

  select round(coalesce(sum(amount), 0), 2) into v_net
  from public.payments
  where session_id = v_session.id;

  v_reason := case
    when c_paid_really then 'تحويل زيارة منتهية إلى اشتراك — المبلغ نُقل إلى دفعات الاشتراك'
    else 'تحويل زيارة منتهية إلى اشتراك — سُجّلت مدفوعة ولم تُدفع فعلاً'
  end;

  -- ---------------- 1) قيد عكسي لكل دفعة (لا حذف) ----------------
  for p in
    select * from public.payments
    where session_id = v_session.id
    order by paid_at, created_at
  loop
    insert into public.payments
      (session_id, amount, payment_method, paid_at, notes, kind, correction_reason, created_by)
    values
      (v_session.id, -p.amount, p.payment_method, p.paid_at, p.notes,
       'correction', v_reason, null);
  end loop;

  -- ---------------- 2) إن دفعت فعلاً: إلى دفعات الاشتراك ----------------
  if c_paid_really and v_net > 0 then
    if v_sub.monthly_amount is null then
      raise exception 'الاشتراك بلا قيمة — لا يمكن احتساب المبلغ منه. أضف قيمة للاشتراك أو اجعل c_paid_really = false';
    end if;

    v_balance := greatest(0, v_sub.monthly_amount - public.subscription_paid(v_sub.id));
    if v_net > v_balance then
      raise exception 'المبلغ المدفوع (%) أكبر من المتبقّي على الاشتراك (%) — لم يتغير شيء',
        to_char(v_net, 'FM9999990.00'), to_char(v_balance, 'FM9999990.00');
    end if;

    select paid_at, payment_method into v_first
    from public.payments
    where session_id = v_session.id and kind = 'payment'
    order by paid_at
    limit 1;

    insert into public.subscription_payments
      (subscription_id, amount, payment_method, paid_at, notes, created_by)
    values
      (v_sub.id, v_net, coalesce(v_first.payment_method, 'cash'),
       coalesce(v_first.paid_at, v_session.entry_time),
       'محوّل من زيارة سُجّلت قبل الاشتراك', null);
  end if;

  -- ---------------- 3) الزيارة تصبح دخول اشتراك ----------------
  update public.parking_sessions
  set session_type     = 'monthly',
      subscription_id  = v_sub.id,
      amount_due       = 0,
      amount_collected = null,
      adjustment       = 0,
      discount_reason  = null,
      payment_status   = 'not_required',
      payment_method   = null,
      pricing_rule_id  = null,
      prepaid_amount   = 0,
      prepaid_at       = null,
      prepaid_method   = null
  where id = v_session.id
  returning * into v_session;

  -- ---------------- 4) سجل التعديلات ----------------
  insert into public.session_adjustments
    (session_id, action, before_state, after_state, amount_change, reason, created_by)
  values
    (v_session.id, 'convert_to_subscription', v_before,
     public.session_money_state(v_session) || jsonb_build_object(
       'after_exit', true,
       'reversed_total', v_net,
       'moved_to_subscription', case when c_paid_really then v_net else 0 end
     ),
     case when c_paid_really then 0 else -v_net end,
     v_reason, null);

  perform set_config('bp.result',
    '✅ تم التصحيح — '
    || case
         when v_net = 0 then 'لم يكن عليها دفعات'
         when c_paid_really then 'نُقل ' || to_char(v_net, 'FM9999990.00') || ' د.أ إلى دفعات الاشتراك'
         else 'أُلغي ' || to_char(v_net, 'FM9999990.00') || ' د.أ من دخل الوقوف'
       end,
    false);
end $$;

-- ----------------------------------------------------------------------------
-- النتيجة — آخر 5 عمليات لهذه السيارة
-- ----------------------------------------------------------------------------
select
  coalesce(nullif(current_setting('bp.result', true), ''), '—')     as "النتيجة",
  v.plate_number                                                     as "اللوحة",
  case s.session_type when 'monthly' then 'اشتراك' else 'زيارة' end as "نوع الدخول",
  to_char(s.entry_time at time zone 'Asia/Amman', 'DD/MM/YYYY HH24:MI') as "الدخول",
  to_char(s.exit_time  at time zone 'Asia/Amman', 'DD/MM/YYYY HH24:MI') as "الخروج",
  s.amount_due                                                       as "المستحق",
  coalesce((select sum(amount) from public.payments where session_id = s.id), 0)
                                                                     as "صافي الدفعات",
  (select count(*) from public.payments where session_id = s.id)    as "قيود الدفع (كلها محفوظة)",
  (select count(*) from public.session_adjustments where session_id = s.id)
                                                                     as "تعديلات"
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id
where v.plate_normalized = public.normalize_plate(current_setting('bp.plate', true))
order by s.entry_time desc
limit 5;
