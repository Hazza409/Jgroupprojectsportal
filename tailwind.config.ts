import type { Config } from "tailwindcss";

// Semantic colour tokens resolve to CSS variables (see globals.css), so the whole
// UI flips between the dark ("night") and light ("day") palettes via a class on
// <html>. Alpha works via the `<alpha-value>` placeholder.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: v("--c-base"), // page background
        panel: v("--c-panel"), // cards / surfaces
        chrome: v("--c-chrome"), // top bar
        ebony: v("--c-chrome"), // alias kept for existing bg-ebony usages
        ink: v("--c-ink"), // primary text
        brand: v("--c-brand"), // accent (buttons, active nav, focus)
        onbrand: v("--c-onbrand"), // text/icon on a brand-coloured surface
        stone: {
          50: v("--c-stone-50"),
          100: v("--c-stone-100"),
          200: v("--c-stone-200"),
          300: v("--c-stone-300"),
          400: v("--c-stone-400"),
          500: v("--c-stone-500"),
          600: v("--c-stone-600"),
          700: v("--c-stone-700"),
          900: v("--c-stone-900"),
        },
      },
      fontFamily: {
        sans: ['"Ginto Nord"', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        display: ['"Ginto Nord"', '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      letterSpacing: { tightest: "-0.04em" },
    },
  },
  plugins: [],
};

export default config;
