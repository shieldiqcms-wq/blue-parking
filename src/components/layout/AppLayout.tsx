import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, Menu, WifiOff, X } from 'lucide-react'
import { NAV_ITEMS, PRIMARY_NAV } from './navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOnline } from '@/hooks/useOnline'
import { useToast } from '@/hooks/useToast'
import { Button } from '@/components/ui'
import { cx } from '@/lib/cx'
import { APP_NAME } from '@/lib/env'

export function AppLayout() {
  const { profile, session, signOut } = useAuth()
  const online = useOnline()
  const toast = useToast()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'تعذر تسجيل الخروج',
      )
    }
  }

  const userLabel = profile?.full_name || session?.user.email || 'المالك'

  return (
    <div className="flex min-h-full flex-col bg-sand-100">
      {/* ------------------------------ الهيدر ------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-600 transition hover:bg-sand-100 lg:hidden"
            aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </button>

          <NavLink to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">
              P
            </span>
            <span className="text-base font-bold text-brand-900">
              {APP_NAME}
            </span>
          </NavLink>

          <div className="flex-1" />

          {!online && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              لا يوجد اتصال
            </span>
          )}

          <span className="hidden text-sm font-medium text-slate-600 sm:inline">
            {userLabel}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSignOut()}
            icon={<LogOut className="h-4 w-4" aria-hidden />}
            aria-label="تسجيل الخروج"
          >
            <span className="hidden sm:inline">خروج</span>
          </Button>
        </div>
      </header>

      {!online && (
        <div className="bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white no-print">
          لا يوجد اتصال بالإنترنت — لا يمكن تسجيل الدخول أو الخروج حتى يعود
          الاتصال
        </div>
      )}

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-5 px-3 py-4 sm:px-4 sm:py-5">
        {/* ------------------------ القائمة الجانبية ------------------------ */}
        <aside className="hidden w-56 shrink-0 lg:block no-print">
          <nav className="sticky top-20 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                    isActive
                      ? 'bg-brand-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white hover:text-brand-800',
                  )
                }
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* --------------------- قائمة الموبايل المنسدلة --------------------- */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden no-print"
          onClick={() => setMenuOpen(false)}
        >
          <nav
            className="absolute inset-y-0 start-0 flex w-64 flex-col gap-1 bg-white p-3 shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 py-2 text-xs font-bold uppercase text-slate-400">
              القائمة
            </p>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition',
                    isActive
                      ? 'bg-brand-700 text-white'
                      : 'text-slate-600 hover:bg-sand-100',
                  )
                }
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* --------------------- الشريط السفلي (موبايل) --------------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden no-print"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="التنقل السريع"
      >
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center justify-center gap-1 px-1 py-2.5 text-[11px] font-semibold transition',
                isActive ? 'text-brand-700' : 'text-slate-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cx('h-5 w-5', isActive && 'stroke-[2.5]')}
                  aria-hidden
                />
                <span className="text-center leading-tight">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
