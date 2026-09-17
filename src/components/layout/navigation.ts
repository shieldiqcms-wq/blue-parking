import {
  BarChart3,
  Car,
  CarFront,
  LayoutDashboard,
  LogIn,
  LogOut,
  Settings,
  Ticket,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** يظهر في الشريط السفلي على الموبايل */
  primary?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'الرئيسية', icon: LayoutDashboard, primary: true },
  { to: '/entry', label: 'دخول سيارة', icon: LogIn, primary: true },
  { to: '/exit', label: 'خروج سيارة', icon: LogOut, primary: true },
  { to: '/inside', label: 'السيارات الموجودة', icon: CarFront, primary: true },
  { to: '/vehicles', label: 'السيارات', icon: Car },
  { to: '/subscriptions', label: 'الاشتراكات', icon: Ticket },
  { to: '/reports', label: 'التقارير', icon: BarChart3 },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
]

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary)
