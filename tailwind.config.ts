import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#05070a",
          panel: "#0b0f14",
          card: "#0f1520",
          border: "#1c2531",
        },
        accent: {
          DEFAULT: "#3ddc97",
          dim: "#1f8f5c",
        },
        danger: "#ef4444",
        warn: "#f59e0b",
        info: "#3b82f6",
        muted: "#7d8b9c",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
