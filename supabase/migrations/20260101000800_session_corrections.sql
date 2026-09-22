-- ============================================================================
-- Blue Parking — 0009 : تعديل دفع السيارات الموجودة داخل الموقف
-- ----------------------------------------------------------------------------
-- يضيف، للسيارات التي ما زالت داخل الموقف:
--   1) تحصيل مبلغ بعد الدخول وقبل الخروج
--   2) تصحيح مبلغ سُجّل بالخطأ عند الدخول (مثلاً: سُجّل مدفوعاً ولم يدفع)
--   3) تحويل دخول عادي إلى دخول اشتراك (السيارة اشتركت بعد أن دخلت)
--
-- المبدأ: لا حذف ولا تعديل لأي دفعة مسجّلة.
--   كل تصحيح يُسجَّل كقيد جديد في payments من نوع «correction» بمبلغ
--   الفرق (سالب أو موجب)، بتاريخ الدفعة الأصلية نفسه — فيصحّ صندوق ذلك
--   اليوم، وتبقى الدفعة الأصلية والقيد المصحّح ظاهرين معاً.
--   وكل تعديل يُحفظ في سجل session_adjustments: القيم قبل وبعد، والسبب،
--   ومن عدّل ومتى.
--
-- لماذا قيد عكسي لا «إلغاء» الدفعة؟ لأن كل التقارير تجمع payments.amount،
-- فالقيد العكسي يصحّح كل الأرقام تلقائياً دون المساس بدوال التقارير.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. نوع القيد في جدول الدفعات
-- ----------------------------------------------------------------------------
alter table public.payments
  add column if not exists kind              text not null default 'payment',
  add column if not exists correction_reason text;

comment on column public.payments.kind is
  'payment = دفعة فعلية (موجبة دائماً) · correction = قيد تصحيح بمبلغ الفرق (سالب أو موجب)';

alter table public.payments drop constraint if exists payments_kind_valid;
alter table public.payments
  add constraint payments_kind_valid check (kind in ('payment', 'correction'));

-- الدفعة الفعلية موجبة دائماً؛ قيد التصحيح فقط يمكن أن يكون سالباً
alter table public.payments drop constraint if exists payments_amount_valid;
alter table public.payments
  add constraint payments_amount_valid
  check ((kind = 'payment' and amount > 0) or (kind = 'correction' and amount <> 0));

-- ----------------------------------------------------------------------------
-- 2. سجل التعديلات
-- ----------------------------------------------------------------------------
create table if not exists public.session_adjustments (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.parking_sessions(id) on delete cascade,
  action        text not null,
  before_state  jsonb not null,
  after_state   jsonb not null,
  -- أثر التعديل على نقد الوقوف (موجب = زاد، سالب = نقص، صفر = نُقل للاشتراك)
  amount_change numeric(10,2) not null default 0,
  reason        text,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint session_adjustments_action_valid
    check (action in ('collect', 'correct_payment', 'convert_to_subscription', 'auto_fix'))
);

comment on table public.session_adjustments is
  'سجل كل تعديل على عملية وقوف: القيم قبل وبعد، والسبب، ومن عدّل ومتى. لا يُحذف منه شيء.';

create index if not exists session_adjustments_session_idx
  on public.session_adjustments(session_id, created_at);

alter table public.session_adjustments enable row level security;
revoke all on public.session_adjustments from anon, authenticated;
grant select on public.session_adjustments to authenticated;

drop policy if exists "session_adjustments_owner_select" on public.session_adjustments;
create policy "session_adjustments_owner_select"
  on public.session_adjustments for select to authenticated
  using (public.is_owner());

-- لقطة الحقول المالية للعملية — تُحفظ قبل التعديل وبعده
create or replace function public.session_money_state(p_session public.parking_sessions)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'session_type',    p_session.session_type,
    'subscription_id', p_session.subscription_id,
    'prepaid_amount',  p_session.prepaid_amount,
    'prepaid_method',  p_session.prepaid_method,
    'prepaid_at',      p_session.prepaid_at,
    'payment_status',  p_session.payment_status,
    'amount_collected', p_session.amount_collected,
    'adjustment',      p_session.adjustment
  );
$$;

-- داخلية: تُستدعى من دوال التعديل فقط
revoke execute on function public.session_money_state(public.parking_sessions) from authenticated;

-- ----------------------------------------------------------------------------
-- تحقق مشترك: عملية نشطة من نوع زيارة عادية
-- ----------------------------------------------------------------------------
create or replace function public.lock_active_visit(p_session_id uuid)
returns public.parking_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
begin
  perform public.assert_owner();

  select * into v_session
  from public.parking_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'العملية غير موجودة';
  end if;

  if v_session.exit_time is not null then
    raise exception 'السيارة خرجت بالفعل — التعديل متاح للسيارات الموجودة داخل الموقف فقط';
  end if;

  if v_session.session_type = 'monthly' then
    raise exception 'هذا دخول اشتراك — لا تُحتسب عليه رسوم وقوف';
  end if;

  return v_session;
end;
$$;

-- داخلية: تُستدعى من دوال التعديل فقط
revoke execute on function public.lock_active_visit(uuid) from authenticated;

-- ============================================================================
-- 3. تحصيل مبلغ بعد الدخول وقبل الخروج
-- ============================================================================
create or replace function public.collect_session_payment(
  p_session_id     uuid,
  p_amount         numeric,
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
  v_before  jsonb;
  v_amount  numeric(10,2);
  v_method  text;
begin
  v_session := public.lock_active_visit(p_session_id);
  v_before  := public.session_money_state(v_session);

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'أدخل مبلغاً أكبر من صفر';
  end if;
  if v_session.prepaid_amount + v_amount > 9999.99 then
    raise exception 'المبلغ كبير جداً';
  end if;

  v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash');
  if v_method not in ('cash', 'transfer', 'other') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  -- النقد دخل الصندوق الآن — يُعامل كدفع مسبق يُخصم عند الخروج
  insert into public.payments (session_id, amount, payment_method, paid_at, notes, kind, created_by)
  values (v_session.id, v_amount, v_method, now(), 'دفع عند الدخول', 'payment', auth.uid());

  update public.parking_sessions
  set prepaid_amount = round(prepaid_amount + v_amount, 2),
      prepaid_at     = coalesce(prepaid_at, now()),
      prepaid_method = v_method
  where id = v_session.id
  returning * into v_session;

  insert into public.session_adjustments
    (session_id, action, before_state, after_state, amount_change, reason, created_by)
  values
    (v_session.id, 'collect', v_before, public.session_money_state(v_session), v_amount,
     coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'تحصيل أثناء الوقوف'), auth.uid());

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'collected', v_amount,
    'prepaid_amount', v_session.prepaid_amount
  );
end;
$$;

grant execute on function public.collect_session_payment(uuid, numeric, text, text) to authenticated;

-- ============================================================================
-- 4. تصحيح المبلغ المسجّل عند الدخول
-- ----------------------------------------------------------------------------
-- p_new_amount = المبلغ الصحيح الذي دُفع فعلاً (صفر = لم يدفع شيئاً).
-- يُسجَّل الفرق كقيد تصحيح بتاريخ الدفعة الأصلية (أو وقت الدخول)، لأن
-- الخطأ وقع هناك — فيصحّ صندوق ذلك اليوم.
-- ============================================================================
create or replace function public.correct_session_payment(
  p_session_id     uuid,
  p_new_amount     numeric,
  p_reason         text,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
  v_before  jsonb;
  v_new     numeric(10,2);
  v_delta   numeric(10,2);
  v_method  text;
  v_reason  text;
begin
  v_session := public.lock_active_visit(p_session_id);
  v_before  := public.session_money_state(v_session);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'اكتب سبب التصحيح';
  end if;

  v_new := round(coalesce(p_new_amount, -1), 2);
  if v_new < 0 then
    raise exception 'أدخل المبلغ الصحيح (صفر إذا لم يدفع)';
  end if;
  if v_new > 9999.99 then
    raise exception 'المبلغ كبير جداً';
  end if;

  v_delta := round(v_new - v_session.prepaid_amount, 2);
  if v_delta = 0 then
    raise exception 'المبلغ الجديد يساوي المسجّل — لا يوجد ما يُصحَّح';
  end if;

  v_method := coalesce(
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    v_session.prepaid_method,
    'cash'
  );
  if v_method not in ('cash', 'transfer', 'other') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  insert into public.payments
    (session_id, amount, payment_method, paid_at, notes, kind, correction_reason, created_by)
  values
    (v_session.id, v_delta, v_method,
     coalesce(v_session.prepaid_at, v_session.entry_time),
     'دفع عند الدخول', 'correction', v_reason, auth.uid());

  update public.parking_sessions
  set prepaid_amount = v_new,
      prepaid_at     = case when v_new > 0 then coalesce(prepaid_at, entry_time) else null end,
      prepaid_method = case when v_new > 0 then v_method else null end
  where id = v_session.id
  returning * into v_session;

  insert into public.session_adjustments
    (session_id, action, before_state, after_state, amount_change, reason, created_by)
  values
    (v_session.id, 'correct_payment', v_before, public.session_money_state(v_session),
     v_delta, v_reason, auth.uid());

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'difference', v_delta,
    'prepaid_amount', v_session.prepaid_amount
  );
end;
$$;

grant execute on function public.correct_session_payment(uuid, numeric, text, text) to authenticated;

-- ============================================================================
-- 5. تحويل دخول عادي إلى دخول اشتراك
-- ----------------------------------------------------------------------------
-- للسيارة التي اشتركت بعد أن دخلت. يشترط وجود اشتراك ساري لها اليوم.
--
-- إن كان مسجّلاً عليها مبلغ عند الدخول، يختار الموظف:
--   'void'            : لم يدفع فعلاً — يُلغى المبلغ بقيد تصحيح سالب
--   'to_subscription' : دفع فعلاً — يُنقل المبلغ إلى دفعات الاشتراك
--                       (قيد سالب في الزيارات + دفعة اشتراك بنفس التاريخ،
--                        فيبقى صندوق اليوم كما هو)
-- ============================================================================
create or replace function public.convert_session_to_subscription(
  p_session_id     uuid,
  p_prepaid_action text default 'void',
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.parking_sessions%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_before  jsonb;
  v_prepaid numeric(10,2);
  v_balance numeric(10,2);
  v_paid_at timestamptz;
  v_method  text;
  v_reason  text;
  v_change  numeric(10,2) := 0;
begin
  v_session := public.lock_active_visit(p_session_id);
  v_before  := public.session_money_state(v_session);

  select * into v_sub from public.active_subscription_for(v_session.vehicle_id);
  if v_sub.id is null then
    raise exception 'لا يوجد اشتراك ساري لهذه السيارة اليوم — أنشئ الاشتراك أولاً';
  end if;

  v_prepaid := v_session.prepaid_amount;
  v_paid_at := coalesce(v_session.prepaid_at, v_session.entry_time);
  v_method  := coalesce(v_session.prepaid_method, 'cash');
  v_reason  := nullif(btrim(coalesce(p_reason, '')), '');

  if v_prepaid > 0 then
    if p_prepaid_action not in ('void', 'to_subscription') then
      raise exception 'حدّد ما يحدث للمبلغ المسجّل عند الدخول';
    end if;

    if p_prepaid_action = 'to_subscription' then
      if v_sub.monthly_amount is null then
        raise exception 'الاشتراك بلا قيمة — لا يمكن احتساب المبلغ منه. اختر «لم يدفع فعلاً» أو أضف قيمة للاشتراك';
      end if;

      v_balance := greatest(0, v_sub.monthly_amount - public.subscription_paid(v_sub.id));
      if v_prepaid > v_balance then
        raise exception 'المبلغ المدفوع (%) أكبر من المتبقّي على الاشتراك (%)',
          to_char(v_prepaid, 'FM9999990.00'), to_char(v_balance, 'FM9999990.00');
      end if;

      insert into public.payments
        (session_id, amount, payment_method, paid_at, notes, kind, correction_reason, created_by)
      values
        (v_session.id, -v_prepaid, v_method, v_paid_at, 'دفع عند الدخول', 'correction',
         coalesce(v_reason, 'تحويل الدخول إلى اشتراك — المبلغ نُقل إلى دفعات الاشتراك'),
         auth.uid());

      insert into public.subscription_payments
        (subscription_id, amount, payment_method, paid_at, notes, created_by)
      values
        (v_sub.id, v_prepaid, v_method, v_paid_at, 'محوّل من الدفع عند الدخول', auth.uid());

      v_change := 0;
    else
      insert into public.payments
        (session_id, amount, payment_method, paid_at, notes, kind, correction_reason, created_by)
      values
        (v_session.id, -v_prepaid, v_method, v_paid_at, 'دفع عند الدخول', 'correction',
         coalesce(v_reason, 'تحويل الدخول إلى اشتراك — لم يُدفع المبلغ فعلاً'),
         auth.uid());

      v_change := -v_prepaid;
    end if;
  end if;

  update public.parking_sessions
  set session_type    = 'monthly',
      subscription_id = v_sub.id,
      amount_due      = 0,
      payment_status  = 'not_required',
      payment_method  = null,
      prepaid_amount  = 0,
      prepaid_at      = null,
      prepaid_method  = null
  where id = v_session.id
  returning * into v_session;

  insert into public.session_adjustments
    (session_id, action, before_state, after_state, amount_change, reason, created_by)
  values
    (v_session.id, 'convert_to_subscription', v_before,
     public.session_money_state(v_session)
       || jsonb_build_object(
            'prepaid_action', case when v_prepaid > 0 then p_prepaid_action else null end,
            'moved_to_subscription', case when p_prepaid_action = 'to_subscription'
                                          then v_prepaid else 0 end),
     v_change, v_reason, auth.uid());

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'subscription', to_jsonb(v_sub),
    'prepaid_action', case when v_prepaid > 0 then p_prepaid_action else null end,
    'prepaid_amount', v_prepaid
  );
end;
$$;

grant execute on function public.convert_session_to_subscription(uuid, text, text) to authenticated;

-- ============================================================================
-- 6. تحصيل مبلغ عملية غير مدفوعة بعد خروجها — يحتسب المدفوع مقدماً
-- ----------------------------------------------------------------------------
-- النسخة السابقة كانت تسجّل «المحصّل» دون المدفوع عند الدخول، فيظهر خصم
-- وهمي بقيمته. المبلغ المطلوب الآن = المستحق − المدفوع مقدماً.
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
  v_remaining numeric(10,2);
  v_collected numeric(10,2);
  v_total     numeric(10,2);
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

  v_remaining := greatest(0, round(v_session.amount_due - v_session.prepaid_amount, 2));
  v_collected := round(coalesce(p_collected_amount, v_remaining), 2);

  if v_collected < 0 then
    raise exception 'المبلغ المحصّل لا يمكن أن يكون سالباً';
  end if;

  if v_collected > v_remaining then
    raise exception 'المبلغ المحصّل لا يمكن أن يتجاوز المتبقّي (%)',
      to_char(v_remaining, 'FM9999990.00');
  end if;

  v_total := round(v_session.prepaid_amount + v_collected, 2);

  update public.parking_sessions
  set payment_status   = 'paid',
      payment_method   = v_method,
      amount_collected = v_total,
      adjustment       = round(v_total - amount_due, 2),
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

-- تصحيح العمليات التي حُصّلت بالنسخة السابقة: «المحصّل» يُعاد حسابه من
-- الدفعات الفعلية (مصدر الحقيقة). لا يُحذف شيء، وكل تصحيح يُسجَّل في السجل.
with fixes as (
  select s.id,
         public.session_money_state(s) as before_state,
         p.total
  from public.parking_sessions s
  join lateral (
    select round(coalesce(sum(amount), 0), 2) as total
    from public.payments where session_id = s.id
  ) p on true
  where s.exit_time is not null
    and s.payment_status = 'paid'
    and s.prepaid_amount > 0
    and s.amount_collected is distinct from p.total
),
updated as (
  update public.parking_sessions s
  set amount_collected = f.total,
      adjustment       = round(f.total - s.amount_due, 2),
      discount_reason  = case when f.total >= s.amount_due then null else s.discount_reason end
  from fixes f
  where s.id = f.id
  returning s.*, f.before_state
)
insert into public.session_adjustments
  (session_id, action, before_state, after_state, amount_change, reason, created_by)
select u.id, 'auto_fix', u.before_state,
       jsonb_build_object('amount_collected', u.amount_collected, 'adjustment', u.adjustment),
       0,
       'تصحيح تلقائي: المحصّل لم يكن يشمل المدفوع عند الدخول (خصم وهمي)',
       null
from updated u;

-- ============================================================================
-- 7. السيارات الموجودة — مع الدفع المسبق والاشتراك الساري الآن
-- ============================================================================
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
  sub.end_date    as subscription_end_date,
  s.prepaid_amount,
  s.prepaid_method,
  s.prepaid_at,
  -- اشتراك ساري اليوم — قد يكون أُنشئ بعد دخول السيارة
  asub.id         as active_subscription_id,
  asub.end_date   as active_subscription_end,
  (select count(*) from public.session_adjustments a where a.session_id = s.id)::int
                  as adjustments_count
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id
left join public.subscriptions sub on sub.id = s.subscription_id
left join lateral public.active_subscription_for(v.id) asub on true
where s.exit_time is null;

revoke all on public.current_cars_inside from anon;
grant select on public.current_cars_inside to authenticated;

-- ============================================================================
-- 8. تفاصيل العمليات — مع عدد التعديلات
-- ============================================================================
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
  s.created_at,
  (select count(*) from public.session_adjustments a where a.session_id = s.id)::int
                                                         as adjustments_count
from public.parking_sessions s
join public.vehicles v on v.id = s.vehicle_id
left join public.subscriptions sub on sub.id = s.subscription_id;

revoke all on public.session_details from anon;
grant select on public.session_details to authenticated;

-- ============================================================================
-- 9. تشديد الصلاحيات (كما في 0008): لا شيء متاح للدور المجهول
-- ============================================================================
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
