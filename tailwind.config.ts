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
        slateBlue: "#273469",
        mint: "#1b998b",
        ember: "#f46036",
        cloud: "#f6f7eb"
      }
    }
  },
  plugins: []
};

export default config;
