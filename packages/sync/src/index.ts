/**
 * `@fahrschul/sync` – PROMPT -1 / Phase 2, Clientseite.
 *
 * Umfang: §1 (Anzeigehälfte: Datenalter/Version/Quelle), §6 (Realtime-Client
 * inkl. Polling-Fallback), §7 (die neun Synchronisationszustände, verschlüsselte
 * Entwürfe, Auflösung offener Vorgänge nach Neustart), §8 (Offline-Outbox) und
 * §9 (Clientseite der Retry-Politik – WIEDERVERWENDET aus
 * `packages/events/src/retry.ts`, kein zweites Regelwerk).
 *
 * Warum ein eigenes Paket und nicht viermal Copy-Paste in die Apps? Weil
 * apps/student, apps/office, apps/instructor und apps/finance denselben
 * Vertrag brauchen. Vier Kopien wären vier Auslegungen – genau das, was
 * PROMPT -1 an "einer Regel, die nur im Anwendungscode steht" kritisiert.
 *
 * Dieses Paket enthält bewusst KEINE React-Komponenten: die vier Apps haben
 * unterschiedliche Oberflächen (mobil/Desktop), aber identische Logik.
 */
export * from "./cache.js";
export * from "./crypto.js";
export * from "./device.js";
export * from "./hash.js";
export * from "./labels.js";
export * from "./mutations.js";
export * from "./queue.js";
export * from "./realtime.js";
export * from "./retry-client.js";
export * from "./store.js";
export * from "./transport.js";
