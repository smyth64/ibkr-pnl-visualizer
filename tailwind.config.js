/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f12',
        panel: '#0f1419',
        panel2: '#0b1116',
        border: '#1c2228',
        green: '#25c26e',
        red: '#ff5c5c'
      }
    }
  },
  plugins: []
}


