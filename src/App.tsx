import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/hooks/useAuth'
import { isConfigured, missingEnvVars } from '@/lib/supabase'
import { LoadingBlock } from '@/components/ui'

import { ActiveParkingPage } from '@/pages/ActiveParking'
import { DashboardPage } from '@/pages/Dashboard'
import { EntryPage } from '@/pages/Entry'
import { ExitPage } from '@/pages/Exit'
import { LoginPage } from '@/pages/Login'
import { MissingConfigPage } from '@/pages/MissingConfig'
import { NoAccessPage } from '@/pages/NoAccess'
import { ReportsPage } from '@/pages/Reports'
import { SettingsPage } from '@/pages/Settings'
import { SubscriptionsPage } from '@/pages/Subscriptions'
import { VehiclesPage } from '@/pages/Vehicles'

export function App() {
  if (!isConfigured) {
    return <MissingConfigPage missing={missingEnvVars} />
  }
  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const { session, isOwner, loading } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100">
        <LoadingBlock label="جارٍ التحقق من الجلسة…" />
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // مسجّل دخول لكن بلا صلاحية المالك
  if (!isOwner) {
    return <NoAccessPage />
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/entry" element={<EntryPage />} />
        <Route path="/exit" element={<ExitPage />} />
        <Route path="/inside" element={<ActiveParkingPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
