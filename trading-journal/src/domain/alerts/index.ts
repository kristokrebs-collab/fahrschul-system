/**
 * Vier Alarme (C2): the pure domain layer. See README.md.
 *
 *   const step = stepAlerts(memory, readings, { now, userId, params, cooldownMs, maxAgeMs, quiet });   // → fires (events), memory, skipped
 *   const plan = planDeliveries(fire, { now, tz, prefs, phoneReady, emailReady });                      // → one delivery per channel that wants it
 */
export * from "./types";
export * from "./config";
export * from "./quiet";
export * from "./engine";
export * from "./delivery";
export * from "./phone";
export * from "./sources/industry";
export * from "./sources/whale";
export * from "./sources/keylevel";
