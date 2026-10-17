/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f4f6f5',
          100: '#e4e9e7',
          200: '#c9d3cf',
          300: '#9aada5',
          400: '#6b857b',
          500: '#4d675e',
          600: '#3b514a',
          700: '#31423d',
          800: '#293633',
          900: '#232e2b',
          950: '#121a18'
        },
        veil: {
          50: '#f0faf6',
          100: '#d9f2e8',
          200: '#b5e5d3',
          300: '#83d0b7',
          400: '#4fb595',
          500: '#2f997b',
          600: '#217b63',
          700: '#1c6351',
          800: '#194f42',
          900: '#154137'
        },
        sand: {
          50: '#faf7f2',
          100: '#f3ebe0',
          200: '#e6d5bf'
        }
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        panel: '0 18px 50px -28px rgba(18, 26, 24, 0.45)'
      },
      backgroundImage: {
        mesh: 'radial-gradient(ellipse 80% 60% at 10% 0%, rgba(47,153,123,0.18), transparent 55%), radial-gradient(ellipse 70% 50% at 90% 10%, rgba(230,213,191,0.55), transparent 50%), linear-gradient(165deg, #faf7f2 0%, #eef3f1 45%, #e4ebe8 100%)'
      }
    }
  },
  plugins: []
}
