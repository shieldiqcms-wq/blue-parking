import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './hooks/useToast'
import './index.css'

// HashRouter مطلوب للعمل الصحيح على GitHub Pages (لا يوجد SPA fallback)
const container = document.getElementById('root')
if (!container) {
  throw new Error('عنصر root غير موجود في الصفحة')
}

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
)

// تحديث تلقائي لملف الخدمة (Service Worker)
registerSW({ immediate: true })
