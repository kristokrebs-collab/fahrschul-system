import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Fester Port: die API listet 5173–5176 in ihrer CORS-Allowlist (app.ts).
  // strictPort, damit ein besetzter Port laut scheitert statt still auf einen
  // nicht gelisteten Port zu wechseln – dort blockiert der Browser die
  // Session-Cookies und der Fehler sieht wie ein Login-Bug aus.
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    restoreMocks: true,
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
