/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { copyFileSync, existsSync } from "node:fs";

/** Copies the repo's legacy static dashboard into dist so the Netlify site keeps serving /dashboard.html. */
function keepLegacyDashboard() {
  return {
    name: "keep-legacy-dashboard",
    closeBundle() {
      const src = fileURLToPath(new URL("../dashboard.html", import.meta.url));
      if (existsSync(src)) copyFileSync(src, fileURLToPath(new URL("./dist/dashboard.html", import.meta.url)));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), keepLegacyDashboard()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
