#!/usr/bin/env node
/**
 * يبني ملف تثبيت واحد (supabase/sql/INSTALL.sql) من ملفات migrations بالترتيب.
 *
 * الهدف: تقليل احتمال الخطأ عند التثبيت اليدوي من Supabase SQL Editor —
 * لصقة واحدة بدل ثلاث، وبالترتيب الصحيح مضموناً.
 *
 * التشغيل:  npm run db:bundle
 *
 * ⚠️ الملف الناتج مُولَّد — لا تعدّله يدوياً. عدّل ملفات migrations ثم أعد التوليد.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outFile = join(root, 'supabase', 'sql', 'INSTALL.sql')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.error('لم يُعثر على أي ملف migration')
  process.exit(1)
}

const banner = (text) => {
  const line = '='.repeat(78)
  return `-- ${line}\n-- ${text}\n-- ${line}`
}

const parts = [
  `-- ${'='.repeat(78)}`,
  '-- Blue Parking — ملف التثبيت الكامل',
  `-- ${'='.repeat(78)}`,
  '--',
  '-- ⚠️  هذا الملف مُولَّد تلقائياً من supabase/migrations — لا تعدّله يدوياً.',
  '--     لإعادة توليده:  npm run db:bundle',
  '--',
  '-- طريقة الاستخدام:',
  '--   1) Supabase Dashboard > SQL Editor > New query',
  '--   2) الصق كامل محتوى هذا الملف',
  '--   3) Run',
  '--   4) ثم شغّل supabase/tests/verify.sql للتأكد',
  '--',
  '-- ملاحظة: إذا كانت القاعدة تحتوي جداول قديمة بنفس الأسماء، سيتوقف التنفيذ',
  '--         برسالة واضحة. في هذه الحالة شغّل 00_inspect.sql ثم 01_reset.sql.',
  '--',
  `-- الملفات المدمجة (${files.length}):`,
  ...files.map((f, i) => `--   ${i + 1}) ${f}`),
  `-- ${'='.repeat(78)}`,
  '',
]

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8').trimEnd()
  parts.push('', banner(`ملف: ${file}`), '', sql, '')
}

parts.push(
  '',
  banner('انتهى التثبيت'),
  '',
  'do $$',
  'begin',
  "  raise notice 'تم تثبيت Blue Parking بنجاح. شغّل supabase/tests/verify.sql للتأكد.';",
  'end $$;',
  '',
)

writeFileSync(outFile, parts.join('\n'), 'utf8')

const lines = parts.join('\n').split('\n').length
console.log(`✓ تم توليد supabase/sql/INSTALL.sql من ${files.length} ملف (${lines} سطر)`)
