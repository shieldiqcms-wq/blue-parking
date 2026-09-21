/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Noto Kufi Arabic"',
          '"Cairo"',
          '"Segoe UI"',
          'Tahoma',
          'system-ui',
          'sans-serif',
        ],
        numeric: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        /**
         * أزرق الهوية — أزرق صافٍ لا كحلي.
         * الدرجات الغامقة (800+) للنصوص فقط، لا للخلفيات الواسعة، حتى لا
         * يميل المظهر العام إلى الكحلي.
         */
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        /**
         * خلفية رملية دافئة بدل الرمادي المزرق البارد.
         * تقلّل الوهج وتريح العين تحت شمس الموقف وفي الإضاءة الليلية.
         */
        sand: {
          50: '#fbfaf8',
          100: '#f4f2ee',
          200: '#e9e5de',
          300: '#d9d3c8',
          400: '#bdb3a3',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)',
        pop: '0 10px 40px -12px rgb(15 23 42 / 0.25)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
      },
    },
  },
  plugins: [],
}
