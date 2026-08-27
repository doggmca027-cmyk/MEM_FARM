/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        farm: {
          deep: '#120924',
          bg: '#1E1035',
          card: '#2A0F45',
          edge: '#3B1566',
        },
        neon: {
          lime: '#84CC16',
          yellow: '#FACC15',
          cyan: '#06B6D4',
          pink: '#EC4899',
          purple: '#A855F7',
          violet: '#8B5CF6',
        },
      },
      fontFamily: {
        display: ['"Lilita One"', 'system-ui', 'sans-serif'],
        sans: ['Fredoka', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.15)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        floaty: 'floaty 3s ease-in-out infinite',
        pop: 'pop 0.35s ease-out',
      },
    },
  },
  plugins: [],
};
