/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1fb',
          100: '#ffd7f4',
          200: '#ffb0eb',
          300: '#ff86df',
          400: '#f46ed8',
          500: '#dd56ca',
          600: '#b641a9',
          700: '#8f3184',
          800: '#61225c',
          900: '#341330',
        },
        surface: {
          0: '#14071f',
          1: '#1b0c2a',
          2: '#251236',
          3: '#311846',
          4: '#42215c',
        },
      },
      fontFamily: {
        sans: ['Golos Text', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.45s ease-out',
        'slide-up': 'slideUp 0.45s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(18px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      boxShadow: {
        brand: '0 22px 60px rgba(221, 86, 202, 0.24)',
      },
    },
  },
  plugins: [],
}
