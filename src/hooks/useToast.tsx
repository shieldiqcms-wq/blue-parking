import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLES: Record<ToastKind, { box: string; icon: ReactNode }> = {
  success: {
    box: 'bg-emerald-600 text-white',
    icon: <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />,
  },
  error: {
    box: 'bg-rose-600 text-white',
    icon: <XCircle className="h-5 w-5 shrink-0" aria-hidden />,
  },
  warning: {
    box: 'bg-amber-500 text-white',
    icon: <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />,
  },
  info: {
    box: 'bg-slate-800 text-white',
    icon: <Info className="h-5 w-5 shrink-0" aria-hidden />,
  },
}

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++counter
      setToasts((current) => [...current.slice(-3), { id, kind, message }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 no-print"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-pop animate-fade-in ${STYLES[toast.kind].box}`}
          >
            {STYLES[toast.kind].icon}
            <span className="flex-1 leading-6">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-lg p-1 opacity-80 transition hover:bg-white/20 hover:opacity-100"
              aria-label="إغلاق التنبيه"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast يجب أن يُستخدم داخل ToastProvider')
  }
  return context
}
