import { forwardRef, useImperativeHandle, useRef } from 'react'
import { normalizePlate, toLatinDigits } from '@/lib/plate'
import { cx } from '@/lib/cx'

interface PlateInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  invalid?: boolean
  onEnter?: () => void
}

/**
 * حقل إدخال رقم اللوحة.
 *
 * على الجوال يفتح لوحة أرقام فقط (inputMode=numeric) — أسرع بكثير من
 * لوحة المفاتيح الكاملة، واللوحات الأردنية رقمية بالكامل.
 *
 * لوحة الأرقام في أندرويد لا تحتوي شرطة، فأضفنا زراً مستقلاً يُدرج «-»
 * في موضع المؤشر لفصل رمز المنطقة عن الرقم (15-11000).
 *
 * الشرطة للعرض فقط: البحث يتجاهلها، فـ «1511000» و «15-11000» نفس السيارة.
 */
export const PlateInput = forwardRef<HTMLInputElement, PlateInputProps>(
  function PlateInput(
    {
      value,
      onChange,
      id = 'plate',
      placeholder = '15-11000',
      autoFocus,
      disabled,
      invalid,
      onEnter,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    const normalized = normalizePlate(value)

    /** يقبل الأرقام والشرطة فقط، ويحوّل الأرقام العربية إلى لاتينية */
    const sanitize = (raw: string): string =>
      toLatinDigits(raw)
        .replace(/[–—−]/g, '-') // أي نوع شرطة ← شرطة عادية
        .replace(/[^0-9-]/g, '') // لا شيء غير الأرقام والشرطة
        .replace(/-{2,}/g, '-') // لا شرطتين متتاليتين
        .replace(/^-/, '') // لا تبدأ بشرطة

    const insertDash = () => {
      const input = inputRef.current
      if (!input || disabled) return

      // لا نضيف شرطة ثانية
      if (value.includes('-')) {
        input.focus()
        return
      }

      const start = input.selectionStart ?? value.length
      const end = input.selectionEnd ?? value.length
      const next = sanitize(value.slice(0, start) + '-' + value.slice(end))
      onChange(next)

      // إعادة المؤشر بعد الشرطة مباشرة
      requestAnimationFrame(() => {
        const pos = Math.min(start + 1, next.length)
        input.focus()
        input.setSelectionRange(pos, pos)
      })
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-stretch gap-2">
          <input
            ref={inputRef}
            id={id}
            value={value}
            onChange={(event) => onChange(sanitize(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onEnter) {
                event.preventDefault()
                onEnter()
              }
            }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            inputMode="numeric"
            // الشرطة مهرّبة: المتصفحات الحديثة تفسّر pattern بعلَم v الذي يرفض «-» غير المهرّبة
            pattern="[0-9\-]*"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-normalized`}
            className={cx(
              'num h-14 w-full min-w-0 flex-1 rounded-xl border bg-white px-3.5 text-center text-2xl font-bold tracking-widest text-slate-900',
              'placeholder:font-normal placeholder:text-slate-300 transition focus:border-brand-500',
              'disabled:cursor-not-allowed disabled:bg-slate-100',
              invalid ? 'border-rose-400' : 'border-slate-300',
            )}
          />

          <button
            type="button"
            onClick={insertDash}
            disabled={disabled || value.includes('-')}
            aria-label="إضافة شرطة"
            title="إضافة شرطة بين رمز المنطقة والرقم"
            className={cx(
              'num h-14 w-14 shrink-0 rounded-xl border-2 text-3xl font-bold leading-none transition',
              'disabled:cursor-not-allowed',
              value.includes('-')
                ? 'border-slate-200 bg-slate-50 text-slate-300'
                : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200',
            )}
          >
            −
          </button>
        </div>

        <p id={`${id}-normalized`} className="text-xs text-slate-500">
          {normalized ? (
            <>
              سيتم البحث عن:{' '}
              <span className="num font-semibold text-slate-700">
                {normalized}
              </span>
            </>
          ) : (
            <>
              اكتب رمز المنطقة، اضغط «−» ثم الرقم — مثال:{' '}
              {/* داخل نص عربي تنقلب «15-11000» إلى «11000-15» بلا عزل */}
              <span className="num font-semibold text-slate-600">15-11000</span>
            </>
          )}
        </p>
      </div>
    )
  },
)
