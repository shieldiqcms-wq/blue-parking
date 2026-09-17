import {
  BarChart3,
  Car,
  CarFront,
  LayoutDashboard,
  Settings,
  Ticket,
  Wallet,
  ArrowLeftRight,
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
  { to: '/gate', label: 'دخول / خروج', icon: ArrowLeftRight, primary: true },
  { to: '/inside', label: 'السيارات الموجودة', icon: CarFront, primary: true },
  { to: '/cashbook', label: 'الصندوق', icon: Wallet, primary: true },
  { to: '/vehicles', label: 'السيارات', icon: Car },
  { to: '/subscriptions', label: 'الاشتراكات', icon: Ticket },
  { to: '/reports', label: 'التقارير', icon: BarChart3 },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
]

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary)
