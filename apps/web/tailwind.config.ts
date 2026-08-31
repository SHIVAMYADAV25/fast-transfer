import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        paper: "#f2efe9", // warm off-white page background
        ink: "#141414", // near-black text / primary buttons
        line: "#d8d3c8", // hairline borders
        muted: "#8a8577", // secondary text
        accent: "#3f6b52", // small green accent (file icon, links) — used sparingly
        warn: "#b5482a", // errors
      },
      borderRadius: {
        none: "0px",
      },
    },
  },
  plugins: [],
};

export default config;
