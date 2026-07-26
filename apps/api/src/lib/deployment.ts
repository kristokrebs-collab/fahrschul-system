import { randomUUID } from "node:crypto";

/**
 * PROMPT -1 §15 (Phase 4) – Deployment-Identität.
 *
 * §15 verlangt: "Deployment-ID in Logs und Fehlerberichten". Der Grund ist
 * betrieblich, nicht kosmetisch: nach einem Rollout will man eine Fehlerwelle
 * einem KONKRETEN Artefakt zuordnen können, und bei einem Rollback muss man
 * belegen können, welche Instanz noch die alte Fassung ausliefert. Ohne eine
 * ID im Log ist beides Rätselraten.
 *
 * ## Drei Angaben, drei verschiedene Fragen
 *
 * | Feld | Frage, die es beantwortet | Quelle |
 * |---|---|---|
 * | `deploymentId` | "welcher Rollout läuft hier?" | `DEPLOYMENT_ID`, sonst `GIT_COMMIT`, sonst generiert |
 * | `instanceId`   | "welcher PROZESS hat das protokolliert?" | immer neu je Prozessstart |
 * | `releaseChannel` | "ist das Produktion oder Staging?" | `RELEASE_CHANNEL` |
 *
 * `instanceId` ist nicht redundant: bei einem Rolling-Deployment laufen zwei
 * Prozesse mit DERSELBEN `deploymentId` (zwei Repliken) oder mit
 * verschiedenen (alt/neu parallel). Nur beide Felder zusammen erlauben die
 * Unterscheidung "eine Replik ist krank" von "das Release ist krank".
 *
 * ## Warum ein generierter Wert statt eines Fehlers
 *
 * Eine fehlende `DEPLOYMENT_ID` ist kein Grund, den Prozess nicht zu starten –
 * ein Entwicklungslauf hat keine. Die generierte ID trägt deshalb das Präfix
 * `dev-`, damit sie in einer Auswertung sofort als "nicht aus einer
 * Auslieferungskette" erkennbar ist und nicht mit einer echten Release-ID
 * verwechselt wird. `releaseChannel` fällt auf `unknown` zurück – ausdrücklich
 * NICHT auf `production`, weil ein falsches "production" in einer Auswertung
 * schlimmer ist als ein ehrliches "unbekannt".
 */

export type ReleaseChannel = "production" | "staging" | "pilot" | "development" | "unknown";

export interface DeploymentIdentity {
  /** Fachlich: dieser Rollout. Stabil über alle Repliken eines Release. */
  deploymentId: string;
  /** Technisch: dieser Prozess. Neu bei jedem Start, auch beim Neustart derselben Fassung. */
  instanceId: string;
  releaseChannel: ReleaseChannel;
  /** Commit-SHA, falls die Auslieferungskette ihn mitgibt. */
  gitCommit: string | null;
  /** Anwendungsversion aus `package.json`/Umgebung. */
  version: string;
  /** Prozessstart – Grundlage für `uptimeSeconds` in den Health-Antworten. */
  startedAt: string;
}

const CHANNELS: readonly ReleaseChannel[] = ["production", "staging", "pilot", "development", "unknown"];

function readChannel(raw: string | undefined): ReleaseChannel {
  const value = (raw ?? "").trim().toLowerCase();
  return (CHANNELS as readonly string[]).includes(value) ? (value as ReleaseChannel) : "unknown";
}

let identity: DeploymentIdentity | null = null;

/**
 * Die Identität dieses Prozesses. Einmal berechnet und danach konstant – eine
 * Deployment-ID, die sich zur Laufzeit ändert, wäre in einem Log wertlos.
 */
export function deploymentIdentity(): DeploymentIdentity {
  if (identity) return identity;
  const gitCommit = process.env.GIT_COMMIT?.trim() || null;
  const explicit = process.env.DEPLOYMENT_ID?.trim();
  identity = {
    deploymentId: explicit || (gitCommit ? gitCommit.slice(0, 12) : `dev-${randomUUID().slice(0, 8)}`),
    instanceId: `${process.pid}-${randomUUID().slice(0, 8)}`,
    releaseChannel: readChannel(process.env.RELEASE_CHANNEL),
    gitCommit,
    version: process.env.APP_VERSION?.trim() || "0.1.0",
    startedAt: new Date().toISOString(),
  };
  return identity;
}

/** Nur für Tests: erzwingt eine Neuberechnung aus der aktuellen Umgebung. */
export function resetDeploymentIdentity(): void {
  identity = null;
}

export function uptimeSeconds(now: number = Date.now()): number {
  return Math.max(0, Math.round((now - Date.parse(deploymentIdentity().startedAt)) / 1000));
}

/**
 * Die Felder, die an JEDE Logzeile und JEDE Fehlerantwort gehängt werden.
 *
 * Bewusst flach und kurz: drei zusätzliche Felder je Zeile sind vertretbar,
 * ein verschachteltes Objekt wäre in jedem Log-Kollektor lästiger zu
 * indexieren. `instanceId` gehört dazu, weil die Unterscheidung
 * "eine Replik" vs. "das Release" sonst nicht möglich ist.
 */
export function deploymentLogFields(): Record<string, string> {
  const id = deploymentIdentity();
  return {
    deploymentId: id.deploymentId,
    instanceId: id.instanceId,
    releaseChannel: id.releaseChannel,
  };
}
