/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefdf4",
          100: "#d7f9e4",
          500: "#10b981",
          600: "#0ea371",
          700: "#0b815b",
          900: "#064e3b"
        }
      }
    }
  },
  plugins: []
};
