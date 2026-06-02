import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // J Group — high-end residential: muted, architectural palette.
        ink: "#1a1a1a",
        stone: {
          50: "#faf9f7",
          100: "#f1efea",
          200: "#e3dfd6",
          300: "#cdc6b8",
          500: "#8c8678",
          700: "#5a554a",
          900: "#2b2922",
        },
        brand: "#3f5a4b", // deep eucalyptus green
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
