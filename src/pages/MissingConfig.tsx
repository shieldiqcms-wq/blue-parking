import { Settings2 } from 'lucide-react'
import { Card } from '@/components/ui'
import { APP_NAME } from '@/lib/env'

/**
 * تُعرض عندما تكون متغيرات البيئة ناقصة — لا يوجد أي مفتاح في الكود.
 */
export function MissingConfigPage({ missing }: { missing: string[] }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <Card className="w-full max-w-xl">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <Settings2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {APP_NAME} يحتاج إعداداً أولياً
            </h1>
            <p className="text-sm text-slate-500">
              لم يتم ضبط الاتصال بقاعدة البيانات
            </p>
          </div>
        </div>

        <p className="mt-5 text-sm text-slate-700">
          المتغيرات التالية ناقصة أو غير صحيحة:
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {missing.map((name) => (
            <li
              key={name}
              className="num rounded-lg bg-rose-50 px-3 py-2 font-semibold text-rose-700"
              dir="ltr"
            >
              {name}
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
          <p className="mb-2 font-bold text-slate-300"># .env.local</p>
          <pre className="overflow-x-auto" dir="ltr">
            {`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx`}
          </pre>
        </div>

        <ol className="mt-5 list-decimal space-y-2 ps-5 text-sm leading-7 text-slate-700">
          <li>
            انسخ <code className="rounded bg-slate-100 px-1">.env.example</code>{' '}
            إلى <code className="rounded bg-slate-100 px-1">.env.local</code>
          </li>
          <li>
            خذ القيمتين من لوحة Supabase:{' '}
            <span className="font-semibold">
              Project Settings › Data API
            </span>{' '}
            و{' '}
            <span className="font-semibold">Project Settings › API Keys</span>
          </li>
          <li>أعد تشغيل خادم التطوير</li>
        </ol>

        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-xs leading-6 text-amber-900">
          استخدم <strong>المفتاح العام (Publishable / anon)</strong> فقط. لا تضع
          مفتاح <code>service_role</code> أو <code>secret</code> في الواجهة —
          هذه المفاتيح تتجاوز الحماية وتعطي صلاحية كاملة على البيانات.
        </p>

        <p className="mt-4 text-xs text-slate-500">
          عند النشر على GitHub Pages، اضبط القيمتين في{' '}
          <span className="font-semibold">
            GitHub › Settings › Secrets and variables › Actions
          </span>
          .
        </p>
      </Card>
    </div>
  )
}
