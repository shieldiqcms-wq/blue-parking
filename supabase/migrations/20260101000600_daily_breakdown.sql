-- ============================================================================
-- Blue Parking — 0007 : تفصيل يومي لكل نشاط
-- ----------------------------------------------------------------------------
-- يضيف إلى التقرير اليومي: عدد الخدمات، ومصاريف كل مركز تكلفة على حدة،
-- ليتمكّن التطبيق من عرض جدول مستقل للموقف وآخر لغسيل السيارات.
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
  -- كل يوم يحمل أرقام النشاطين منفصلة، فيبني التطبيق جدولاً لكل نشاط
  -- بلا حسابات إضافية في الواجهة.
  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
  into v_days
  from (
    select
      g.day::date as day,

      -- ---- الموقف ----
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
      (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
        where e.cost_center = 'parking'
          and public.amman_date(e.spent_at) = g.day::date) as expenses_parking,

      -- ---- غسيل السيارات ----
      (select count(*) from public.services sv
        where public.amman_date(sv.performed_at) = g.day::date) as services_count,
      (select coalesce(sum(sv.amount), 0)::numeric(10,2) from public.services sv
        where sv.payment_status = 'paid'
          and public.amman_date(sv.performed_at) = g.day::date) as services_revenue,
      (select coalesce(sum(e.amount), 0)::numeric(10,2) from public.expenses e
        where e.cost_center = 'wash'
          and public.amman_date(e.spent_at) = g.day::date) as expenses_wash,

      -- ---- مشترك وإجمالي ----
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
  ) d;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', v_totals, 'days', v_days
  );
end;
$$;

grant execute on function public.get_report(date, date) to authenticated;
