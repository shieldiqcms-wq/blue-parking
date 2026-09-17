import { useEffect, useState } from 'react'

/** يراقب حالة الاتصال بالإنترنت لمنع العمليات غير الآمنة عند الانقطاع. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}

/** مؤقّت يعيد التصيير كل فترة — لتحديث مدة الوقوف الظاهرة على الشاشة */
export function useTicker(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return tick
}
