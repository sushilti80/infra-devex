/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./srcV2/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'brand-blue': '#2563eb',
        'brand-dark': '#1e293b',
        'brand-border': '#e2e8f0',
        'background-dark': '#0f172a',
      },
    },
  },
  plugins: [],
}
