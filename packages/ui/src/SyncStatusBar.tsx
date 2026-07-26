import { syncStateHint, syncStateLabel, syncStateSeverity } from "@fahrschul/sync";
import type { SyncQueueEntry } from "@fahrschul/sync";
import { useSyncOptional } from "./SyncContext.js";

/**
 * PROMPT -1 §1 (ANZEIGEHÄLFTE) + §7 – die Statuszeile.
 *
 * Phase 1 hat die Datenbank zur einzigen Wahrheit gemacht. Diese Komponente
 * ist die andere Hälfte derselben Regel: der Benutzer muss SEHEN, wie alt der
 * angezeigte Stand ist, ob synchronisiert wird, ob er offline ist und wie
 * viele lokale Entwürfe offen sind. Ein Stand, dessen Alter man nicht sieht,
 * wird für Wahrheit gehalten – und genau daraus entstehen die Fehler, die
 * PROMPT -1 verhindern will.
 *
 * Vier Angaben, in dieser Reihenfolge:
 *   1. Synchronisationszustand (einer der neun aus §7)
 *   2. Datenalter ("vor 3 Min.")
 *   3. Offline-Status
 *   4. offene lokale Entwürfe
 *
 * Zusätzlich, weil es sonst niemand merkt: ein nicht schreibbarer lokaler
 * Speicher (Privatmodus) wird gemeldet – sonst glaubt ein Fahrlehrer, sein
 * Entwurf sei gesichert.
 */
export function SyncStatusBar({ compact = false }: { compact?: boolean }) {
  const sync = useSyncOptional();
  if (!sync) return null;

  const unbekannt = sync.summary.ausgangUnbekannt > 0;
  const severity = syncStateSeverity(sync.status, { outcomeUnknown: unbekannt });
  const label = syncStateLabel(sync.status, { outcomeUnknown: unbekannt });

  const teile: string[] = [];
  if (sync.dataAge) teile.push(`Daten ${sync.dataAge.label}`);
  else teile.push("Daten noch nicht geladen");
  if (!sync.online) teile.push("offline");
  else if (sync.realtime.mode === "polling") teile.push("Aktualisierung im Rückfallmodus");
  else if (sync.realtime.mode === "down") teile.push("keine Live-Verbindung");
  if (sync.summary.entwuerfe > 0) {
    teile.push(
      `${sync.summary.entwuerfe} lokaler Entwurf${sync.summary.entwuerfe === 1 ? "" : "e"}`,
    );
  }
  if (sync.summary.wartend > 0) teile.push(`${sync.summary.wartend} wartend`);
  if (sync.summary.konflikte > 0) teile.push(`${sync.summary.konflikte} Konflikt(e)`);
  if (sync.summary.fehlgeschlagen > 0) teile.push(`${sync.summary.fehlgeschlagen} fehlgeschlagen`);
  if (sync.summary.veraltet > 0) teile.push(`${sync.summary.veraltet} veraltet`);

  return (
    <div
      className={[
        "fahrschul-syncbar",
        `fahrschul-syncbar--${severity}`,
        compact ? "fahrschul-syncbar--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      data-sync-status={sync.status}
      data-outcome-unknown={unbekannt ? "true" : "false"}
      data-realtime-mode={sync.realtime.mode}
    >
      <span className="fahrschul-syncbar__state">{label}</span>
      <span className="fahrschul-syncbar__detail">{teile.join(" · ")}</span>
      {!sync.persistenceHealthy ? (
        <span className="fahrschul-syncbar__warn">
          Lokaler Speicher nicht verfügbar – Entwürfe können verloren gehen.
        </span>
      ) : null}
      {!compact ? (
        <span className="fahrschul-syncbar__hint">
          {syncStateHint(sync.status, { outcomeUnknown: unbekannt })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * §7 – Zustandsabzeichen für EINEN Vorgang (Entwurf, Buchung, Zahlung …).
 * Wird neben dem betroffenen Datensatz gezeigt, damit "wird übertragen" nicht
 * mit "gespeichert" verwechselt werden kann.
 */
export function SyncBadge({ entry }: { entry: SyncQueueEntry }) {
  const label = syncStateLabel(entry.status, { outcomeUnknown: entry.outcomeUnknown });
  const severity = syncStateSeverity(entry.status, { outcomeUnknown: entry.outcomeUnknown });
  return (
    <span
      className={`fahrschul-syncbadge fahrschul-syncbadge--${severity}`}
      data-sync-state={entry.status}
      data-outcome-unknown={entry.outcomeUnknown ? "true" : "false"}
      title={syncStateHint(entry.status, { outcomeUnknown: entry.outcomeUnknown })}
    >
      {label}
    </span>
  );
}

/**
 * §7/§9 – die Liste offener Vorgänge samt Prüf-Warteschlange.
 *
 * Regeln, die hier SICHTBAR werden:
 *   - Ein Konflikt wird NICHT automatisch aufgelöst: es gibt nur "erneut
 *     versuchen" oder (bei nicht-kritischen) "verwerfen", plus die
 *     Serverangaben aus der Konfliktantwort für eine Entscheidung.
 *   - Ein erschöpfter Vorgang verschwindet nicht, sondern behält seinen
 *     vollen Kontext und einen manuellen Wiederaufnahmepfad.
 *   - Ein kritischer Vorgang mit unbekanntem Ausgang lässt sich nur mit
 *     ausdrücklicher Bestätigung entfernen.
 */
export function PendingOperations() {
  const sync = useSyncOptional();
  if (!sync) return null;
  const offen = sync.entries.filter((e) => e.status !== "synced");
  if (offen.length === 0) return null;

  return (
    <section className="fahrschul-pending" aria-label="Offene Vorgänge">
      <h3 className="fahrschul-pending__title">Offene Vorgänge ({offen.length})</h3>
      <ul className="fahrschul-pending__list">
        {offen.map((entry) => (
          <li key={entry.operationId} className="fahrschul-pending__item">
            <div className="fahrschul-pending__head">
              <span className="fahrschul-pending__name">{entry.bezeichnung}</span>
              <SyncBadge entry={entry} />
            </div>
            <dl className="fahrschul-pending__meta">
              <dt>Angelegt</dt>
              <dd>{new Date(entry.createdAt).toLocaleString("de-DE")}</dd>
              <dt>Versuche</dt>
              <dd>{entry.retryCount}</dd>
              {entry.lastError ? (
                <>
                  <dt>Letzter Fehler</dt>
                  <dd>{entry.lastError}</dd>
                </>
              ) : null}
              {entry.staleReason ? (
                <>
                  <dt>Grund</dt>
                  <dd>{entry.staleReason}</dd>
                </>
              ) : null}
            </dl>

            {entry.conflict ? (
              <div className="fahrschul-pending__conflict">
                <p>
                  Konflikt: {entry.conflict.error ?? entry.conflict.errorClass}
                  {entry.conflict.currentVersion !== null
                    ? ` (Serverversion ${entry.conflict.currentVersion})`
                    : ""}
                </p>
                {entry.conflict.conflictFields.length > 0 ? (
                  <p>Betroffene Felder: {entry.conflict.conflictFields.join(", ")}</p>
                ) : null}
                {entry.conflict.message ? <p>{entry.conflict.message}</p> : null}
                <p className="fahrschul-pending__note">
                  Es wurde nichts automatisch überschrieben. Bitte entscheiden.
                </p>
              </div>
            ) : null}

            <div className="fahrschul-pending__actions">
              {entry.status === "local_draft" ? (
                <button type="button" onClick={() => sync.submitDraft(entry.operationId)}>
                  Jetzt senden
                </button>
              ) : null}
              {entry.staleReason && entry.staleReason !== "identity_mismatch" ? (
                <button type="button" onClick={() => sync.confirmStale(entry.operationId)}>
                  Prüfen &amp; trotzdem senden
                </button>
              ) : null}
              {entry.status === "failed" || entry.status === "conflict" ? (
                <button type="button" onClick={() => sync.retry(entry.operationId)}>
                  Erneut versuchen
                </button>
              ) : null}
              {entry.kind === "critical" && entry.outcomeUnknown ? (
                <button
                  type="button"
                  onClick={() => sync.discard(entry.operationId, { force: true })}
                >
                  Ausgang geprüft – entfernen
                </button>
              ) : (
                <button type="button" onClick={() => sync.discard(entry.operationId)}>
                  Verwerfen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
