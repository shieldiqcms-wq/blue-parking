import { useCallback, useEffect, useRef, useState } from 'react'
import { toArabicError } from '@/lib/errors'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** إعادة التحميل يدوياً */
  reload: () => Promise<void>
  /** تعديل البيانات محلياً بعد عملية ناجحة */
  setData: (updater: T | ((current: T | null) => T | null) | null) => void
}

/**
 * تحميل بيانات مع حالات (تحميل / خطأ / نجاح) ورسائل عربية جاهزة.
 * يتجاهل النتائج المتأخرة إذا تغيّر الطلب أو أُزيل المكوّن.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = [],
): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  const requestId = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)

    try {
      const result = await fnRef.current()
      if (!mounted.current || id !== requestId.current) return
      setDataState(result)
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return
      setError(toArabicError(err))
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const setData = useCallback(
    (updater: T | ((current: T | null) => T | null) | null) => {
      setDataState((current) =>
        typeof updater === 'function'
          ? (updater as (c: T | null) => T | null)(current)
          : updater,
      )
    },
    [],
  )

  return { data, loading, error, reload: run, setData }
}

/**
 * تنفيذ عملية (إرسال نموذج، تسجيل خروج…) مع حالة انتظار ورسالة خطأ عربية.
 */
export function useAction<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): {
  run: (...args: Args) => Promise<R | undefined>
  pending: boolean
  error: string | null
  clearError: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (...args: Args) => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      const message = toArabicError(err)
      if (mounted.current) setError(message)
      throw new Error(message)
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { run, pending, error, clearError }
}
