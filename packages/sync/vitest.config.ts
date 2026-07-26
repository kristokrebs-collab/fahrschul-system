import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom, weil die Offline-Outbox und der Entwurfsspeicher gegen
    // localStorage + WebCrypto laufen (§7 "Entwürfe verschlüsselt").
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    restoreMocks: true,
  },
});
