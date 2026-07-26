import { useCallback, useEffect, useState } from "react";
import { useSyncOptional } from "./SyncContext.js";

/**
 * PROMPT -1 §18 – die Anzeige des EINGESCHRÄNKTEN BETRIEBS.
 *
 * ## Warum das eine eigene Komponente ist und nicht Teil von `SyncStatusBar`
 *
 * `SyncStatusBar` beantwortet: „wie alt ist MEIN Wissen?" (§1/§7). Diese
 * Komponente beantwortet eine andere Frage: „welche Teile des Systems arbeiten
 * gerade nicht, und was heißt das für mich?" (§18). Das ist eine andere
 * Informationsart mit einer anderen Zielgruppe: die Statuszeile richtet sich an
 * jeden Nutzer, dieses Banner vor allem an das Büro und an Fahrlehrer, die
 * wissen müssen, ob eine Benachrichtigung tatsächlich raus ist.
 *
 * ## Die vier Regeln, die §18 hier verlangt
 *
 *  1. **Der Kern wird nie als kaputt dargestellt.** Fällt eine externe
 *     Schnittstelle aus, steht hier „eingeschränkter Betrieb", nicht
 *     „Störung". Termine, Dokumente und Ausbildung funktionieren.
 *  2. **Kein falscher Erfolg.** Was auf externe Synchronisation wartet, wird
 *     als solches benannt („wartet auf externe Synchronisation"), niemals als
 *     „gesendet".
 *  3. **Keine Aktion wird gesperrt, die ohne die Schnittstelle möglich ist.**
 *     Das Banner informiert; es schaltet nichts ab. Genau deshalb liefert
 *     `GET /health/deep` auch 200 und nicht 503.
 *  4. **Der Zeitpunkt der letzten erfolgreichen Synchronisation ist sichtbar**
 *     – sonst hält man veraltete Zahlungsdaten für aktuell.
 *
 * ## Realtime-Ausfall
 *
 * Der Realtime-Teil kommt NICHT von diesem Endpunkt, sondern aus
 * `RealtimeStatus.mode` des Sync-Kerns (Phase 2). Ein Client, der auf Polling
 * zurückgefallen ist, weiß das selbst am besten – er muss den Server nicht
 * fragen.
 */

export interface IntegrationHealthView {
  integration: string;
  modus: "mock" | "sandbox" | "live";
  status: "gesund" | "eingeschraenkt" | "ausgefallen";
  breaker: "closed" | "open" | "half_open";
  letzteErfolgreicheSynchronisation: string | null;
  gepuffert: number;
  fehlerwarteschlange: number;
}

export interface DeepHealthView {
  status: "gesund" | "eingeschraenkt" | "ausgefallen";
  datenbank: string;
  kern: string;
  integrationen: IntegrationHealthView[];
  ausgefallen: string[];
  eingeschraenkt: string[];
  serverTime: string;
}

/** Menschliche Bezeichnung je Integration – „malware-scan" sagt einem Büro nichts. */
export const INTEGRATION_LABELS: Record<string, string> = {
  notifications: "Benachrichtigungen (E-Mail/Push)",
  calendar: "Kalenderexport",
  bank: "Bankabgleich",
  storage: "Dokumentenspeicher",
  crm: "Website-/Lead-Anbindung",
  "malware-scan": "Virenprüfung für Uploads",
  payments: "Zahlungsanbieter",
  transcription: "Transkription",
  "ai-suggestions": "KI-Vorschläge",
  fahrschulverwaltung: "Fahrschulverwaltung (Stammdaten)",
};

/**
 * Was ein Ausfall FÜR DEN NUTZER bedeutet. Das ist der eigentliche Inhalt von
 * §18: nicht „Dienst X ist offline", sondern „was kann ich trotzdem tun".
 */
export const DEGRADED_HINTS: Record<string, string> = {
  notifications:
    "Termine bleiben gültig. Benachrichtigungen warten auf externe Synchronisation und werden automatisch nachgesendet – bitte NICHT als versendet behandeln.",
  bank: "Ausbildung und Termine laufen normal weiter. Zahlungsdaten sind VERALTET; es werden keine Mahnungen und keine Sperren auf dieser Grundlage ausgelöst.",
  "malware-scan":
    "Uploads werden gespeichert, bleiben aber in Quarantäne, bis die Virenprüfung wieder läuft. Sie gelten NICHT als geprüft.",
  fahrschulverwaltung:
    "Diese Plattform ist die führende Quelle für Termine, Ausbildung und Dokumente. Der Stammdatenabgleich wird nachgeholt; es entsteht kein Doppelimport.",
  storage: "Neue Uploads sind derzeit nicht möglich. Bereits gespeicherte Dokumente bleiben abrufbar.",
  calendar: "Termine sind gültig. Der Kalenderexport wird nachgeholt.",
  payments: "Rechnungen sind sichtbar. Die Online-Zahlung ist derzeit nicht verfügbar.",
  transcription: "Sprachprotokolle können als Text erfasst werden; die automatische Transkription wird nachgeholt.",
  "ai-suggestions": "Vorschläge fehlen. Die manuelle Erfassung funktioniert unverändert.",
  crm: "Bestehende Leads sind bearbeitbar. Neue Website-Leads kommen verzögert an.",
};

export function degradedHint(integration: string): string {
  return (
    DEGRADED_HINTS[integration] ??
    "Der Kern des Systems bleibt nutzbar. Änderungen werden gepuffert und automatisch nachgeholt."
  );
}

export function formatLastSync(iso: string | null): string {
  if (!iso) return "noch keine erfolgreiche Synchronisation";
  const alter = Date.now() - new Date(iso).getTime();
  const minuten = Math.floor(alter / 60_000);
  if (minuten < 1) return "gerade eben";
  if (minuten < 60) return `vor ${minuten} Min.`;
  const stunden = Math.floor(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Std.`;
  return `vor ${Math.floor(stunden / 24)} Tag(en)`;
}

export interface DegradedBannerProps {
  /** Basis-URL der API. */
  apiBase: string;
  /** Abfrageintervall; 0 schaltet das Nachladen ab (Tests). */
  pollIntervalMs?: number;
  /** Vorgegebener Zustand (Tests / Server-Side-Rendering). */
  initialHealth?: DeepHealthView | null;
}

export function DegradedBanner({ apiBase, pollIntervalMs = 60_000, initialHealth = null }: DegradedBannerProps) {
  const sync = useSyncOptional();
  const [health, setHealth] = useState<DeepHealthView | null>(initialHealth);

  const laden = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/health/deep`, { credentials: "include" });
      if (!res.ok) return;
      setHealth((await res.json()) as DeepHealthView);
    } catch {
      // Ein fehlgeschlagener Gesundheitsabruf ist SELBST kein Grund für eine
      // Fehlermeldung: der Nutzer merkt einen echten Ausfall an seinen
      // eigentlichen Aktionen, und ein rotes Banner "Status unbekannt" wäre
      // reine Beunruhigung.
    }
  }, [apiBase]);

  useEffect(() => {
    if (initialHealth) return;
    void laden();
    if (pollIntervalMs <= 0) return;
    const timer = setInterval(() => void laden(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [laden, pollIntervalMs, initialHealth]);

  const realtimeEingeschraenkt = sync?.realtime.mode === "polling" || sync?.realtime.mode === "down";
  const betroffene = [...(health?.ausgefallen ?? []), ...(health?.eingeschraenkt ?? [])];
  if (!realtimeEingeschraenkt && betroffene.length === 0) return null;

  return (
    <div
      className="fahrschul-degraded"
      role="status"
      aria-live="polite"
      data-degraded="true"
      data-realtime-mode={sync?.realtime.mode ?? "unbekannt"}
    >
      <strong className="fahrschul-degraded__title">Eingeschränkter Betrieb</strong>
      <p className="fahrschul-degraded__core">
        Termine, Ausbildung und Dokumente funktionieren normal. Betroffen sind nur die unten genannten
        Schnittstellen.
      </p>

      {realtimeEingeschraenkt ? (
        <p className="fahrschul-degraded__item" data-integration="realtime">
          <span className="fahrschul-degraded__name">Live-Aktualisierung</span>
          {sync?.realtime.mode === "polling"
            ? " – Rückfallmodus: die Anzeige aktualisiert sich verzögert. Alle Aktionen funktionieren unverändert."
            : " – keine Live-Verbindung. Die Anzeige aktualisiert sich beim Neuladen; alle Aktionen funktionieren unverändert."}
        </p>
      ) : null}

      {(health?.integrationen ?? [])
        .filter((i) => i.status !== "gesund")
        .map((i) => (
          <p key={i.integration} className="fahrschul-degraded__item" data-integration={i.integration}>
            <span className="fahrschul-degraded__name">
              {INTEGRATION_LABELS[i.integration] ?? i.integration}
            </span>
            {i.status === "ausgefallen" ? " – ausgefallen. " : " – eingeschränkt. "}
            {degradedHint(i.integration)}
            <span className="fahrschul-degraded__meta">
              {` Letzte erfolgreiche Synchronisation: ${formatLastSync(i.letzteErfolgreicheSynchronisation)}.`}
              {i.gepuffert > 0 ? ` ${i.gepuffert} Vorgang/Vorgänge wartet/warten auf externe Synchronisation.` : ""}
              {i.fehlerwarteschlange > 0
                ? ` ${i.fehlerwarteschlange} Vorgang/Vorgänge braucht/brauchen eine manuelle Wiederaufnahme durch den Systemdienst.`
                : ""}
            </span>
          </p>
        ))}
    </div>
  );
}

/**
 * Kleiner Marker für EINEN Vorgang, dessen externe Zustellung noch aussteht.
 * §18: „die UI zeigt 'wartet auf externe Synchronisation'" – wörtlich, und
 * ausdrücklich NICHT „gesendet".
 */
export function ExternalSyncPending({ was = "Diese Übermittlung" }: { was?: string }) {
  return (
    <span className="fahrschul-pending-external" data-pending-external="true">
      {was} wartet auf externe Synchronisation.
    </span>
  );
}
