import { AlertTriangle, Settings2 } from 'lucide-react'
import { Card } from '@/components/ui'
import { APP_NAME, type EnvProblem } from '@/lib/env'

/**
 * تُعرض عندما تكون متغيرات البيئة ناقصة أو غير صحيحة.
 * لا يوجد أي مفتاح في الكود — كل القيم من متغيرات البيئة.
 */
export function MissingConfigPage({ problems }: { problems: EnvProblem[] }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <Card className="w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <Settings2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {APP_NAME} يحتاج إعداداً أولياً
            </h1>
            <p className="text-sm text-slate-500">
              إعدادات الاتصال بقاعدة البيانات غير صحيحة
            </p>
          </div>
        </div>

        <ul className="mt-5 flex flex-col gap-3">
          {problems.map((problem) => (
            <li
              key={problem.name}
              className="rounded-xl border border-rose-200 bg-rose-50 p-3.5"
            >
              <p
                className="num max-w-full break-all text-sm font-bold text-rose-900"
                dir="ltr"
              >
                {problem.name}
              </p>

              <p className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold text-rose-800">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden
                />
                {problem.message}
              </p>

              <div className="mt-2 text-xs text-slate-600">
                القيمة الحالية:
                <code
                  className="num mt-1 block max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-white px-1.5 py-1 text-slate-800"
                  dir="ltr"
                >
                  {problem.value}
                </code>
              </div>

              <p className="mt-1.5 text-xs leading-6 text-slate-600">
                {problem.hint}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-5 min-w-0 rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
          <p className="mb-2 font-bold text-slate-300"># القيم الصحيحة</p>
          <pre
            className="max-w-full overflow-x-auto whitespace-pre-wrap break-all"
            dir="ltr"
          >
            {`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
          </pre>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-bold text-slate-800">
              للتشغيل المحلي
            </p>
            <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-xs leading-6 text-slate-600">
              <li>
                انسخ{' '}
                <code className="rounded bg-slate-100 px-1">.env.example</code>{' '}
                إلى{' '}
                <code className="rounded bg-slate-100 px-1">.env.local</code>
              </li>
              <li>عبّي القيمتين</li>
              <li>أعد تشغيل خادم التطوير</li>
            </ol>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-800">
              للنشر على GitHub Pages
            </p>
            <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-xs leading-6 text-slate-600">
              <li>
                اضبط القيمتين في{' '}
                <span className="font-semibold">
                  Settings › Secrets and variables › Actions › Variables
                </span>
              </li>
              <li>
                <span className="font-semibold">أعد تشغيل الـ workflow</span> —
                القيم تُدمج وقت البناء، فتعديلها لا يؤثر على نسخة منشورة سابقاً
              </li>
            </ol>
          </div>
        </div>

        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-xs leading-6 text-amber-900">
          استخدم <strong>المفتاح العام (Publishable / anon)</strong> فقط. لا تضع
          مفتاح <code>service_role</code> أو <code>sb_secret_…</code> في
          الواجهة — هذه المفاتيح تتجاوز كل سياسات الحماية وتعطي صلاحية كاملة على
          البيانات.
        </p>
      </Card>
    </div>
  )
}
