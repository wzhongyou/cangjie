/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ds: {
          bg:      '#fafbfc',
          sidebar: '#f3f4f6',
          border:  '#e5e7eb',
          text:    '#1a1a2e',
          muted:   '#6b7280',
          subtle:  '#9ca3af',
          accent:  '#4f6ef7',
          accentLight: '#eef1ff',
        },
      },
    },
  },
  plugins: [],
}
