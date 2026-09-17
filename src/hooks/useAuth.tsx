import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from '@/lib/supabase'
import { toArabicError } from '@/lib/errors'
import type { Profile } from '@/types/database'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** المستخدم مسجّل دخول ولكن بلا صلاحية على بيانات الموقف */
  isPending: boolean
  isOwner: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      if (mounted.current) setProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (!mounted.current) return

    if (error) {
      // فشل قراءة الملف الشخصي لا يعني فشل تسجيل الدخول —
      // الشاشة ستعرض رسالة "لا صلاحية" بدل انهيار التطبيق.
      setProfile(null)
      return
    }

    setProfile((data as Profile | null) ?? null)
  }, [])

  useEffect(() => {
    mounted.current = true

    if (!isConfigured) {
      setLoading(false)
      return () => {
        mounted.current = false
      }
    }

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted.current) return
      setSession(data.session ?? null)
      await loadProfile(data.session?.user.id)
      if (mounted.current) setLoading(false)
    })()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted.current) return
        setSession(nextSession)
        void loadProfile(nextSession?.user.id)
      },
    )

    return () => {
      mounted.current = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new Error(toArabicError(error))
    setSession(data.session)
    await loadProfile(data.session?.user.id)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(toArabicError(error))
    setSession(null)
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user.id)
  }, [loadProfile, session?.user.id])

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      isOwner: profile?.role === 'owner',
      isPending: Boolean(session) && profile?.role !== 'owner',
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth يجب أن يُستخدم داخل AuthProvider')
  }
  return context
}
