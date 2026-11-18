/** Squeeze-Beobachtung (F07) – market side: reading the archive and the alert. See `src/market/README.md`. */
export { SQUEEZE_DAYS, loadSqueezeData, type SqueezeSnapshot } from "./read";
export { ALERT_COOLDOWN_MS, SQUEEZE_ALERTS_KEY, alertText, boxContextOf, createAlertRunner, startSqueezeAlerts, type AlertRunner } from "./alerts";
