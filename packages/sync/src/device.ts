import type { KeyValueStore } from "./store.js";

/**
 * PROMPT -1 §8 – Pflichtfeld "Device-ID".
 *
 * Zweck ist NICHT Wiedererkennung/Tracking, sondern Nachvollziehbarkeit: wenn
 * derselbe Entwurf auf zwei Geräten existiert (Fahrlehrer mit Tablet und
 * Telefon), muss unterscheidbar bleiben, welches Gerät ihn erzeugt hat – sonst
 * lässt sich ein doppelter Bericht nicht erklären.
 *
 * Die ID ist deshalb bewusst ein GERÄTE-lokaler Zufallswert ohne Bezug zu
 * Hardware, Fingerprint oder Benutzer; sie verlässt das Gerät nur als
 * Metadatum eines Vorgangs, den der Benutzer ausgelöst hat.
 */
const DEVICE_KEY = "deviceId";

export function loadDeviceId(store: KeyValueStore): string {
  const vorhanden = store.get(DEVICE_KEY);
  if (vorhanden && vorhanden.length > 0) return vorhanden;
  const c = globalThis.crypto;
  const neu =
    c && typeof c.randomUUID === "function"
      ? c.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  store.set(DEVICE_KEY, neu);
  return neu;
}
