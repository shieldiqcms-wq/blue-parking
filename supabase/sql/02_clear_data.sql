-- ============================================================================
-- Blue Parking — مسح بيانات التجربة قبل الاستخدام الفعلي
-- ============================================================================
--
--   ⚠️⚠️  يحذف كل حركات الموقف نهائياً ولا يمكن التراجع  ⚠️⚠️
--
-- ----------------------------------------------------------------------------
-- ما يُحذف:
--   • كل عمليات الدخول والخروج
--   • كل المدفوعات
--   • كل الخدمات (غسيل/تمسيح)
--   • كل المصاريف
--   • كل الاشتراكات
--   • كل السيارات
--   • سجل قراءات الكاميرا
--   • سجل تعديلات العمليات
--
-- ما يبقى كما هو:
--   • حسابك وصلاحيتك (profiles / auth.users)
--   • التسعيرة وإعداداتها (pricing_rules)
--   • إعدادات التطبيق (app_settings)
--   • بنية قاعدة البيانات كاملة — لا حاجة لإعادة تشغيل INSTALL.sql
--
-- ----------------------------------------------------------------------------
-- الاستخدام: Supabase Dashboard > SQL Editor > الصق > Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ما هو موجود الآن؟ (قبل الحذف)
-- ----------------------------------------------------------------------------
select 'قبل الحذف' as "الحالة",
       (select count(*) from public.parking_sessions) as "عمليات",
       (select count(*) from public.payments)         as "مدفوعات",
       (select count(*) from public.services)         as "خدمات",
       (select count(*) from public.expenses)         as "مصاريف",
       (select count(*) from public.subscriptions)    as "اشتراكات",
       (select count(*) from public.vehicles)         as "سيارات";

-- ⚠️ راجع الأرقام أعلاه. إن كان فيها بيانات حقيقية تحتاجها، صدّرها من
--    صفحة «التقارير» قبل المتابعة.

-- ----------------------------------------------------------------------------
-- 2) الحذف — بالترتيب الصحيح للعلاقات
-- ----------------------------------------------------------------------------
begin;

delete from public.session_adjustments;
delete from public.payments;
delete from public.subscription_payments;
delete from public.ocr_captures;
delete from public.services;
delete from public.expenses;
delete from public.parking_sessions;
delete from public.subscriptions;
delete from public.vehicles;

commit;

-- ----------------------------------------------------------------------------
-- 3) التحقق — كل الأرقام يجب أن تكون صفراً
-- ----------------------------------------------------------------------------
select 'بعد الحذف' as "الحالة",
       (select count(*) from public.parking_sessions) as "عمليات",
       (select count(*) from public.payments)         as "مدفوعات",
       (select count(*) from public.services)         as "خدمات",
       (select count(*) from public.expenses)         as "مصاريف",
       (select count(*) from public.subscriptions)    as "اشتراكات",
       (select count(*) from public.vehicles)         as "سيارات";

-- ----------------------------------------------------------------------------
-- 4) ما بقي سليماً
-- ----------------------------------------------------------------------------
select 'الحساب والإعدادات' as "الفحص",
       (select count(*) from public.profiles where role = 'owner') as "حساب المالك",
       (select count(*) from public.pricing_rules where is_active) as "تسعيرة فعّالة",
       (select count(*) from public.app_settings)                  as "إعدادات";

-- المتوقع: 1 / 1 / 4 على الأقل — النظام جاهز للاستخدام الفعلي.
