import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// اسم مستودع GitHub — يُستخدم كمسار أساسي عند النشر على GitHub Pages.
// عند التطوير المحلي يبقى المسار "/".
const REPO_BASE = '/blue-parking/'

export default defineConfig(({ command, isPreview }) => ({
  // البناء والمعاينة يستخدمان مسار GitHub Pages، وخادم التطوير يبقى على '/'.
  // ملاحظة: `vite preview` يعمل بـ command='serve'، فبدون isPreview كانت
  // المعاينة تُخدَم على '/' بينما الأصول مبنيّة على REPO_BASE فتفشل بـ 404.
  base: command === 'build' || isPreview ? REPO_BASE : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: REPO_BASE,
        name: 'Blue Parking — بلو باركنج',
        short_name: 'Blue Parking',
        description: 'نظام إدارة موقف السيارات',
        lang: 'ar',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f1f5f9',
        theme_color: '#2563eb',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // حجم أكبر لأن محرك OCR يُحمّل عند الطلب فقط
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // خطوط جوجل — تخزين طويل المدى
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // بيانات Supabase لا تُخزّن إطلاقاً — دائماً من الشبكة
            urlPattern: /^https:\/\/.*\.supabase\.(co|in)\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
}))
