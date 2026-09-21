import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/hooks/useAuth'
import { envProblems, isConfigured } from '@/lib/supabase'
import { LoadingBlock } from '@/components/ui'

import { ActiveParkingPage } from '@/pages/ActiveParking'
import { CashbookPage } from '@/pages/Cashbook'
import { DashboardPage } from '@/pages/Dashboard'
import { GatePage } from '@/pages/Gate'
import { LoginPage } from '@/pages/Login'
import { MissingConfigPage } from '@/pages/MissingConfig'
import { NoAccessPage } from '@/pages/NoAccess'
import { ParkingPrintPage } from '@/pages/ParkingPrint'
import { ReportsPage } from '@/pages/Reports'
import { SettingsPage } from '@/pages/Settings'
import { SubscriptionsPage } from '@/pages/Subscriptions'
import { VehiclesPage } from '@/pages/Vehicles'

export function App() {
  if (!isConfigured) {
    return <MissingConfigPage problems={envProblems} />
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
      {/* تقرير الطباعة / PDF — خارج الإطار حتى لا تُطبع القوائم */}
      <Route path="/reports/print" element={<ParkingPrintPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/gate" element={<GatePage />} />
        {/* المساران القديمان محفوظان: روابط أو إشارات مرجعية سابقة */}
        <Route path="/entry" element={<Navigate to="/gate" replace />} />
        <Route path="/exit" element={<Navigate to="/gate" replace />} />
        <Route path="/inside" element={<ActiveParkingPage />} />
        <Route path="/cashbook" element={<CashbookPage />} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
