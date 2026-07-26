import { defineConfig } from "vitest/config";

// Tests teilen sich eine Postgres-Testdatenbank (siehe __tests__/helpers.ts,
// truncateAll). Datei-Parallelität wird daher deaktiviert, damit sich
// Testdateien nicht gegenseitig die Tabellen leeren.
export default defineConfig({
  test: {
    // Phase 3 (§16): setzt einen stillen Log-Sink, damit das Zugriffsprotokoll
    // aktiv bleibt, ohne die Testausgabe zu fluten (siehe __tests__/setup.ts).
    setupFiles: ["./src/__tests__/setup.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
