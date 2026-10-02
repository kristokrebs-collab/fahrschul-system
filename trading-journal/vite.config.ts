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
    rollupOptions: {
      output: {
        // Chart libraries in their own chunks: lightweight-charts is only reached through lazy imports,
        // recharts is a parallel-loaded vendor chunk so the main chunk stays small (Plan 9.4).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(lightweight-charts|fancy-canvas)\//.test(id)) return "lwc";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return "motion";
          if (/node_modules\/(recharts|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light|@reduxjs|immer|reselect|react-redux|redux|eventemitter3|es-toolkit|tiny-invariant)\//.test(id)) return "recharts";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
