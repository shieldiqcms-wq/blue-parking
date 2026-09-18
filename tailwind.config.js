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
         * أزرق الهوية — مخفّف قليلاً عن الأزرق القياسي ومائل للرمادي،
         * فالأزرق المشبع على مساحات واسعة يُتعب العين في الاستخدام الطويل.
         */
        brand: {
          50: '#f1f5fb',
          100: '#e2eaf6',
          200: '#c5d6ed',
          300: '#9bb8de',
          400: '#6d95cb',
          500: '#4a76b4',
          600: '#375d98',
          700: '#2d4b7c',
          800: '#274067',
          900: '#233757',
          950: '#17233a',
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
