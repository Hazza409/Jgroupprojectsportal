import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // J Group Projects — monochrome luxury (brand: Colorplan Ebony Black).
        // Full dark mode. There is intentionally no accent hue.
        base: "#161514", // page background — warm near-black
        panel: "#1f1d1b", // cards / raised surfaces — warm ebony
        ebony: "#2d2b29", // chrome (top bar) — the brand's Ebony Black
        ink: "#f4f2ee", // PRIMARY TEXT — warm near-white
        brand: "#ffffff", // the signature white (buttons, links, active nav, focus)
        // Inverted warm-grey ramp: low number = dark surface, high = light text.
        // Lets existing `stone-*` usages read correctly on dark with no per-file churn.
        stone: {
          50: "#1f1d1b", // subtle raised surface
          100: "#2a2825", // subtle fill / hover
          200: "#393633", // hairline borders
          300: "#4a4642", // stronger borders
          400: "#736e68", // dim text
          500: "#938d85", // muted text
          600: "#c4bdb3", // muted-strong
          700: "#d3cdc4", // labels
          900: "#f1eee9", // emphasis / headings
        },
      },
      fontFamily: {
        // Ginto if licensed files are present (see globals.css @font-face), else the
        // brand book's own Helvetica Neue fallback. Neo-grotesque throughout.
        sans: ['"Ginto"', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        display: ['"Ginto Nord"', '"Ginto"', '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
  plugins: [],
};

export default config;
