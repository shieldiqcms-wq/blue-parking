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

// تحديث تلقائي لملف الخدمة (Service Worker).
// التسجيل يفشل في بعض البيئات (متصفح بلا HTTPS، متصفحات مدمجة، وضع التصفح
// الخاص). هذا يعطّل العمل دون اتصال فقط — التطبيق نفسه يظل يعمل بشكل كامل،
// لذلك نتعامل مع الفشل بهدوء بدل تركه وعداً مرفوضاً بلا معالجة.
registerSW({
  immediate: true,
  onRegisterError(error) {
    console.warn(
      '[Blue Parking] تعذّر تسجيل ملف الخدمة — التطبيق يعمل لكن بدون دعم العمل دون اتصال.',
      error,
    )
  },
})
