/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        unergy: {
          green: '#006B33',
          light: '#4CAF50',
          dark: '#004d24'
        }
      }
    },
  },
  plugins: [],
}
