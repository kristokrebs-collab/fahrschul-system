import { AsyncLocalStorage } from "node:async_hooks";
import { setAmbientCorrelationProvider } from "@fahrschul/events";

/**
 * PROMPT -1 §16 – die Korrelations-ID als AMBIENTER Kontext.
 *
 * ## Das Problem, das das löst
 *
 * §16 verlangt „eine Korrelations-ID, die die ganze Kette überlebt
 * (Client → API → Worker → Outbox → Realtime)". Phase 1 hat die Spalte
 * `correlation_id` in `audit_events`, `event_outbox` und `jobs` geschaffen und
 * den DB-Trigger, der sie von der Audit-Zeile in die Outbox-Zeile trägt. Was
 * fehlte, war die ERSTE Stufe: die Audit-Zeile bekam per `buildEventRow` eine
 * FRISCHE UUID, weil kein Aufrufer eine mitgab. Damit war jede Audit-Zeile ihr
 * eigener Vorgang – die Kette begann erst nach der API.
 *
 * ## Warum ambient und nicht als Parameter
 *
 * `buildEventRow` wird an ~60 Stellen aufgerufen. Ein zusätzlicher Parameter
 * an allen 60 wäre (a) ein sehr großer Diff mit hohem Fehlerrisiko und (b)
 * dauerhaft fragil: eine NEUE Route würde ihn vergessen und wieder eine
 * eigene ID erzeugen, ohne dass es auffällt. `AsyncLocalStorage` löst genau
 * dieses Problem: die ID gilt für alles, was innerhalb eines Vorgangs läuft,
 * auch über `await`-Grenzen und in Transaktionen.
 *
 * Ein explizit übergebener `correlationId` hat weiterhin Vorrang – dort, wo
 * eine Route ihn schon setzt, bleibt es dabei.
 *
 * ## Auch für Worker
 *
 * `runWithCorrelation` wird nicht nur im HTTP-Hook benutzt, sondern auch im
 * Job-Runner: ein Job trägt seine eigene `correlation_id`, und alles, was er
 * auditiert, hängt daran. Damit ist die Kette auch auf der Worker-Seite dicht.
 */

interface CorrelationStore {
  correlationId: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** Einmalig beim Prozessstart aufrufen (geschieht in `buildApp`). */
export function installCorrelationProvider(): void {
  setAmbientCorrelationProvider(() => storage.getStore()?.correlationId ?? null);
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** Führt `fn` innerhalb eines Korrelationskontexts aus. */
export function runWithCorrelation<T>(
  context: CorrelationStore,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * Variante für Fastify-Hooks: der Kontext muss über den GESAMTEN
 * Anfragelebenszyklus gelten, nicht nur über einen Hook. Fastify hat dafür
 * keinen "wrap"-Punkt, deshalb wird `enterWith` benutzt – das ist genau der
 * dokumentierte Anwendungsfall (ein Kontext pro asynchroner Ausführungskette,
 * hier: pro Anfrage).
 */
export function enterCorrelation(context: CorrelationStore): void {
  storage.enterWith(context);
}
