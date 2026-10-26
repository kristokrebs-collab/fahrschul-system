/**
 * The states of the section „E-Mail-Alarm bei geschlossener App“ (F21), decided in one pure function so every state has
 * a test and a reason: no cloud · not signed in · 2FA code missing · plan · server status loading / unreachable · server
 * not set up · address missing / unconfirmed · cloud sync off · off · on. The order is the order of the preconditions –
 * the first one that fails is what the card says. Turning the alarm OFF is possible in every state.
 */
import type { SyncPhase } from "@/cloud/sync/status";
import type { ServerAlertsCfg } from "@/domain/keylevels";
import type { AlertHeartbeat, AlertStatus } from "./emailAlertApi";
import { EMAIL } from "./emailStrings";

export type EmailAlertKind = "nocloud" | "signedout" | "mfa" | "upgrade" | "loading" | "unavailable" | "setup" | "address" | "unconfirmed" | "sync" | "off" | "on";

export type StatusState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: AlertStatus };

export interface EmailAlertInput {
  cloud: boolean;
  signedIn: boolean;
  needsMfa: boolean;
  /** the client's plan view (`useEntitlement("boxScanner")`) */
  entitled: boolean;
  status: StatusState;
  /** this device syncs while signed in (Konto → Datenschutz) */
  syncOn: boolean;
  syncPhase: SyncPhase;
  cfg: Pick<ServerAlertsCfg, "email">;
}

export interface EmailAlertView {
  kind: EmailAlertKind;
  head: string;
  note: string;
  /** the first thing standing in the way is a problem the user can read as a warning, not just "off" */
  tone: "mute" | "warn" | "win";
  /** the switch may be turned ON */
  canEnable: boolean;
  /** the test mail may be sent (the server is set up, the plan and the address are fine) */
  testable: boolean;
}

/** Sync phases in which the server cannot get the rules. */
const NO_SYNC: readonly SyncPhase[] = ["off", "paused", "locked"];

export function emailAlertView(i: EmailAlertInput): EmailAlertView {
  const make = (kind: EmailAlertKind, tone: EmailAlertView["tone"], flags: { canEnable?: boolean; testable?: boolean } = {}): EmailAlertView => ({
    kind,
    head: EMAIL.state[kind].head,
    note: EMAIL.state[kind].note,
    tone,
    canEnable: flags.canEnable ?? false,
    testable: flags.testable ?? false,
  });
  if (!i.cloud) return make("nocloud", "mute");
  if (!i.signedIn) return make("signedout", "mute");
  if (i.needsMfa) return make("mfa", "warn");
  const server = i.status.kind === "ok" ? i.status.data : null;
  if (!i.entitled || (server && !server.entitled)) return make("upgrade", "warn");
  if (i.status.kind === "loading") return make("loading", "mute");
  if (!server) return make("unavailable", "warn");
  if (!server.configured) return make("setup", "warn");
  if (!server.hasEmail) return make("address", "warn");
  if (!server.emailConfirmed) return make("unconfirmed", "warn");
  if (!i.syncOn || NO_SYNC.includes(i.syncPhase)) return make("sync", "warn", { testable: true });
  return i.cfg.email ? make("on", "win", { canEnable: true, testable: true }) : make("off", "mute", { canEnable: true, testable: true });
}

/** `true` once the server has the switch: the sync is live and nothing waits to be uploaded. */
export const reachedServer = (phase: SyncPhase, pending: number): boolean => phase === "live" && pending === 0;

/** German „vor 3 Min“ for a time (ms) at `now`. */
export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

/** „26.10. 14:05“ (device clock). */
export function stampText(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The schedule stands still if it did not report for this long (it runs every 5 minutes). */
export const STALE_AFTER_MS = 20 * 60_000;

export interface RunLine {
  text: string;
  tone: "mute" | "warn";
}

/** The „Zuletzt geprüft“ line from the server's heartbeat. */
export function runLine(run: AlertHeartbeat | null, now: number): RunLine {
  if (!run) return { text: EMAIL.noRun, tone: "warn" };
  const when = EMAIL.runAt(stampText(run.at), agoText(run.at, now));
  if (!run.ok) return { text: `${when} – ${EMAIL.runFailed[run.code ?? ""] ?? EMAIL.runFailedUnknown}`, tone: "warn" };
  if (now - run.at > STALE_AFTER_MS) return { text: `${when} – ${EMAIL.runStale(agoText(run.at, now).replace(/^vor /, ""))}`, tone: "warn" };
  return { text: when, tone: "mute" };
}

/** Mails sent today, by the device's day when the server's day string is today's. */
export function mailsToday(cfg: Pick<ServerAlertsCfg, "mails">, now: number): number {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return cfg.mails.day === `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` ? cfg.mails.n : 0;
}
