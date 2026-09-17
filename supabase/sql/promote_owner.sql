-- ============================================================================
-- Blue Parking — ترقية حساب إلى مالك
-- ----------------------------------------------------------------------------
-- متى تحتاج هذا الملف؟
--   أول حساب يُنشأ في المشروع يصبح المالك تلقائياً.
--   استخدم هذا الملف فقط إذا:
--     • أنشأت حسابات قبل تطبيق الـ migrations
--     • أو تريد نقل الملكية إلى حساب آخر
--
-- التشغيل: Supabase Dashboard > SQL Editor
-- ============================================================================

-- 1) عرض كل الحسابات وصلاحياتها
select
  u.id,
  u.email,
  p.full_name,
  coalesce(p.role, '— لا يوجد ملف شخصي —') as role,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at;

-- ----------------------------------------------------------------------------
-- 2) ترقية حساب إلى مالك — بدّل البريد الإلكتروني ثم شغّل
-- ----------------------------------------------------------------------------
-- insert into public.profiles (id, full_name, role)
-- select u.id, 'أبو حمدان', 'owner'
-- from auth.users u
-- where u.email = 'ضع-البريد-هنا@example.com'
-- on conflict (id) do update set role = 'owner', full_name = excluded.full_name;

-- ----------------------------------------------------------------------------
-- 3) سحب الصلاحية من حساب (لا يحذفه، فقط يمنعه من رؤية البيانات)
-- ----------------------------------------------------------------------------
-- update public.profiles set role = 'pending'
-- where id = 'ضع-الـ-UUID-هنا';

-- ----------------------------------------------------------------------------
-- 4) التحقق من أن كل الجداول محميّة بـ RLS
-- ----------------------------------------------------------------------------
select
  c.relname   as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies pp
    where pp.schemaname = 'public' and pp.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;
