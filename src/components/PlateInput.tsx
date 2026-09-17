import { forwardRef } from 'react'
import { normalizePlate, toLatinDigits } from '@/lib/plate'
import { Input } from './ui'

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
 * يحوّل الأرقام العربية إلى لاتينية أثناء الكتابة، ويعرض الصيغة الموحّدة
 * المستخدمة في البحث حتى يرى المشغّل بالضبط بماذا سيبحث النظام.
 */
export const PlateInput = forwardRef<HTMLInputElement, PlateInputProps>(
  function PlateInput(
    {
      value,
      onChange,
      id = 'plate',
      placeholder = 'مثال: 12-34567',
      autoFocus,
      disabled,
      invalid,
      onEnter,
    },
    ref,
  ) {
    const normalized = normalizePlate(value)

    return (
      <div className="flex flex-col gap-1.5">
        <Input
          ref={ref}
          id={id}
          value={value}
          onChange={(event) => onChange(toLatinDigits(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) {
              event.preventDefault()
              onEnter()
            }
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          invalid={invalid}
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          className="num h-14 text-center text-2xl font-bold tracking-widest"
          aria-describedby={`${id}-normalized`}
        />
        <p id={`${id}-normalized`} className="text-xs text-slate-500">
          {normalized ? (
            <>
              سيتم البحث عن:{' '}
              <span className="num font-semibold text-slate-700">
                {normalized}
              </span>
            </>
          ) : (
            'أدخل رقم اللوحة — المسافات والشرطات لا تؤثر على البحث'
          )}
        </p>
      </div>
    )
  },
)
