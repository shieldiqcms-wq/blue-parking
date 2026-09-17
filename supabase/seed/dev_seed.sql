-- ============================================================================
-- Blue Parking — بيانات تجريبية للتطوير فقط
-- ⚠️  لا تُشغّل هذا الملف على قاعدة بيانات حقيقية ⚠️
-- ----------------------------------------------------------------------------
-- هذا الملف ليس ضمن مجلد migrations عمداً، حتى لا يُطبّق تلقائياً.
-- لتشغيله: SQL Editor في Supabase > الصق المحتوى > Run
-- ----------------------------------------------------------------------------
-- الاستخدام: اختبار الواجهة والتقارير قبل استعمال النظام فعلياً.
-- للحذف لاحقاً: شغّل قسم "تنظيف" في نهاية الملف.
-- ============================================================================

do $$
declare
  v_owner uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid; v_v5 uuid;
  v_rule uuid;
  v_sid uuid;
begin
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_owner is null then
    raise exception 'لا يوجد حساب مالك بعد. أنشئ حساب أبو حمدان أولاً ثم أعد التشغيل.';
  end if;

  select id into v_rule from public.pricing_rules where is_active limit 1;

  -- ---------------- سيارات تجريبية ----------------
  insert into public.vehicles (plate_number, owner_name, phone, notes, created_by)
  values
    ('12-34567', 'أبو محمد',  '0791111111', '[بيانات تجريبية]', v_owner),
    ('10-77889', 'أم خالد',   '0792222222', '[بيانات تجريبية]', v_owner),
    ('21-55443', 'سامي',      '0793333333', '[بيانات تجريبية]', v_owner),
    ('33-90210', 'هيا',       null,          '[بيانات تجريبية]', v_owner),
    ('45-11223', 'زياد',      '0795555555', '[بيانات تجريبية]', v_owner)
  on conflict (plate_normalized) do nothing;

  select id into v_v1 from public.vehicles where plate_normalized = '1234567';
  select id into v_v2 from public.vehicles where plate_normalized = '1077889';
  select id into v_v3 from public.vehicles where plate_normalized = '2155443';
  select id into v_v4 from public.vehicles where plate_normalized = '3390210';
  select id into v_v5 from public.vehicles where plate_normalized = '4511223';

  -- ---------------- اشتراك شهري ساري ----------------
  insert into public.subscriptions
    (vehicle_id, start_date, end_date, status, monthly_amount, notes, created_by)
  values
    (v_v1, public.amman_today() - 10, public.amman_today() + 20, 'active', 25.00,
     '[بيانات تجريبية]', v_owner),
    (v_v3, public.amman_today() - 60, public.amman_today() - 30, 'active', 25.00,
     '[بيانات تجريبية - اشتراك منتهٍ]', v_owner);

  -- ---------------- عمليات مكتملة خلال آخر 7 أيام ----------------
  for i in 1..7 loop
    -- زيارة عادية مدفوعة: 09:00 -> 14:30  (1 د.أ)
    insert into public.parking_sessions
      (vehicle_id, session_type, entry_time, exit_time, pricing_rule_id,
       amount_due, payment_status, payment_method, notes, created_by)
    values
      (v_v2, 'one_time',
       ((public.amman_today() - i)::text || ' 09:00')::timestamp at time zone 'Asia/Amman',
       ((public.amman_today() - i)::text || ' 14:30')::timestamp at time zone 'Asia/Amman',
       v_rule, 1.00, 'paid', 'cash', '[بيانات تجريبية]', v_owner)
    returning id into v_sid;

    insert into public.payments (session_id, amount, payment_method, paid_at, created_by)
    values (v_sid, 1.00, 'cash',
            ((public.amman_today() - i)::text || ' 14:30')::timestamp at time zone 'Asia/Amman',
            v_owner);

    -- زيارة متأخرة: 10:00 -> 16:10  (1 + 2 = 3 د.أ)
    insert into public.parking_sessions
      (vehicle_id, session_type, entry_time, exit_time, pricing_rule_id,
       amount_due, payment_status, payment_method, notes, created_by)
    values
      (v_v4, 'one_time',
       ((public.amman_today() - i)::text || ' 10:00')::timestamp at time zone 'Asia/Amman',
       ((public.amman_today() - i)::text || ' 16:10')::timestamp at time zone 'Asia/Amman',
       v_rule, 3.00,
       case when i % 3 = 0 then 'unpaid' else 'paid' end,
       case when i % 3 = 0 then null else 'cash' end,
       '[بيانات تجريبية]', v_owner);

    -- زيارة اشتراك شهري
    insert into public.parking_sessions
      (vehicle_id, session_type, entry_time, exit_time,
       amount_due, payment_status, notes, created_by)
    values
      (v_v1, 'monthly',
       ((public.amman_today() - i)::text || ' 08:15')::timestamp at time zone 'Asia/Amman',
       ((public.amman_today() - i)::text || ' 15:40')::timestamp at time zone 'Asia/Amman',
       0, 'not_required', '[بيانات تجريبية]', v_owner);
  end loop;

  -- ---------------- سيارة ما زالت داخل الموقف ----------------
  insert into public.parking_sessions
    (vehicle_id, session_type, entry_time, amount_due, payment_status, notes, created_by)
  values
    (v_v5, 'one_time', now() - interval '2 hours', 0, 'unpaid',
     '[بيانات تجريبية]', v_owner)
  on conflict do nothing;

  raise notice 'تم إدخال البيانات التجريبية بنجاح.';
end
$$;

-- ============================================================================
-- تنظيف البيانات التجريبية — أزل التعليق وشغّل عند الحاجة
-- ============================================================================
-- delete from public.payments
--   where session_id in (
--     select id from public.parking_sessions where notes like '[بيانات تجريبية]%'
--   );
-- delete from public.parking_sessions where notes like '[بيانات تجريبية]%';
-- delete from public.subscriptions   where notes like '[بيانات تجريبية]%';
-- delete from public.vehicles        where notes like '[بيانات تجريبية]%';
