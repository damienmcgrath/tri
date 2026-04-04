import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "var(--color-surface)",
        raised: "var(--color-surface-raised)",
        overlay: "var(--color-surface-overlay)",
        accent: "var(--color-accent)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        info: "var(--color-info)",
        run: "var(--color-run)",
        swim: "var(--color-swim)",
        bike: "var(--color-bike)",
        strength: "var(--color-strength)",
        // Intensity zone colours
        "zone-endurance": "var(--zone-endurance, hsl(210, 50%, 52%))",
        "zone-tempo": "var(--zone-tempo, hsl(40, 85%, 55%))",
        "zone-threshold": "var(--zone-threshold, hsl(25, 90%, 55%))",
        "zone-vo2max": "var(--zone-vo2max, hsl(5, 80%, 55%))",
        "zone-strength": "var(--zone-strength, hsl(260, 40%, 55%))"
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"]
      },
      spacing: {
        18: "72px",
        22: "88px"
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px"
      }
    }
  },
  plugins: []
};

export default config;
