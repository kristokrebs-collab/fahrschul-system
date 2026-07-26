import { setLogSink } from "../lib/observability.js";

/**
 * PROMPT -1 §16 (Phase 3) – Testaufbau.
 *
 * Das Zugriffsprotokoll bleibt in Tests AKTIV (die Redaktionstests brauchen es,
 * und ein Protokoll, das in Tests abgeschaltet ist, wird nicht getestet), aber
 * es schreibt nicht auf stdout: eine Zeile je HTTP-Anfrage über ~300 Tests
 * würde die Testausgabe unbrauchbar machen.
 *
 * Wichtig: `startLogCapture()` in `lib/observability.ts` schneidet UNABHÄNGIG
 * vom Sink mit. Die Redaktionstests sehen also weiterhin jede Zeile – sie
 * landen nur nicht im Terminal.
 */
setLogSink(() => {
  /* absichtlich still – siehe Modulkommentar */
});
