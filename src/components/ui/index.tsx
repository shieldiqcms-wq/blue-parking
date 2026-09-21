import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { cx } from '@/lib/cx'

/* -------------------------------- Button -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm disabled:bg-brand-300',
  secondary:
    'bg-white text-brand-800 border border-slate-200 hover:bg-slate-50 active:bg-slate-100 shadow-sm disabled:text-slate-400',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm disabled:bg-rose-300',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm disabled:bg-emerald-300',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-[3.25rem] px-5 text-base gap-2.5 rounded-xl',
  xl: 'h-16 px-6 text-lg gap-3 rounded-2xl',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      block = false,
      icon,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cx(
          'inline-flex select-none items-center justify-center font-semibold transition-colors',
          'disabled:cursor-not-allowed',
          VARIANTS[variant],
          SIZES[size],
          block && 'w-full',
          className,
        )}
        {...rest}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          icon
        )}
        {children}
      </button>
    )
  },
)

/* --------------------------------- Card --------------------------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cx(
        'rounded-2xl border border-slate-200/80 bg-white shadow-card',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-bold text-slate-800">{children}</h2>
      {action}
    </header>
  )
}

/* --------------------------------- Field -------------------------------- */

interface FieldProps {
  label: string
  htmlFor?: string
  hint?: string
  error?: string | null
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-semibold text-slate-700"
      >
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-xs font-medium text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

const CONTROL_BASE =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 text-slate-900 ' +
  'placeholder:text-slate-400 transition focus:border-brand-500 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        CONTROL_BASE,
        'h-11',
        invalid && 'border-rose-400 focus:border-rose-500',
        className,
      )}
      {...rest}
    />
  )
})

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(CONTROL_BASE, 'h-11 cursor-pointer', className)}
      {...rest}
    >
      {children}
    </select>
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(CONTROL_BASE, 'py-2.5 leading-6 resize-y', className)}
      {...rest}
    />
  )
})

/* --------------------------------- Badge -------------------------------- */

type BadgeTone =
  | 'blue'
  | 'sky'
  | 'green'
  | 'red'
  | 'amber'
  | 'slate'
  | 'violet'

/**
 * درجات مخفّفة عمداً: خلفية فاتحة ونص داكن بدل ألوان مشبعة.
 * الشاشة تُستخدم طوال اليوم، والألوان القوية تُتعب العين.
 * `blue` للموقف و `sky` للغسيل — يميّزان النشاطين بلا صخب.
 */
const TONES: Record<BadgeTone, string> = {
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  slate: 'bg-sand-200 text-slate-600 ring-sand-300',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export function Badge({
  tone = 'slate',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------ حالات الشاشة ----------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cx('h-5 w-5 animate-spin text-brand-600', className)}
      aria-hidden
    />
  )
}

export function LoadingBlock({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500"
      role="status"
    >
      <Spinner className="h-7 w-7" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-8 text-center"
      role="alert"
    >
      <AlertCircle className="h-8 w-8 text-rose-500" aria-hidden />
      <p className="text-sm font-semibold text-rose-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-400">
        {icon ?? <Inbox className="h-7 w-7" aria-hidden />}
      </div>
      <div>
        <p className="font-bold text-slate-700">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

/* -------------------------------- StatCard ------------------------------- */

export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = 'blue',
  hint,
}: {
  label: string
  value: ReactNode
  unit?: string
  icon?: ReactNode
  tone?: BadgeTone
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && (
          <span
            className={cx(
              'rounded-lg p-1.5 ring-1 ring-inset',
              TONES[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="num text-2xl font-bold text-slate-900">{value}</span>
        {unit && (
          <span className="text-sm font-semibold text-slate-500">{unit}</span>
        )}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={cx(
          'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop animate-fade-in sm:rounded-2xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="إغلاق"
            className="px-2"
          >
            ✕
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ------------------------------ PageHeading ------------------------------ */

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
