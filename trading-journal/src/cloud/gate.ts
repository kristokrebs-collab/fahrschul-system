/**
 * Konto-Pflicht (entry gate): in a build with the cloud (`cloudEnabled()`, a web build, not inside claude.ai, not the share edition) a
 * signed-out visitor sees the login / registration window as a full page BEFORE the app. Light module (zustand + storage only, no
 * Supabase): `App` asks `useEntryGate()` on every render and either mounts the shell or the gate chunk (`src/app/gate/EntryGate.tsx`).
 *
 * | state     | when                                                                                         | shows                         |
 * |-----------|----------------------------------------------------------------------------------------------|-------------------------------|
 * | `off`     | no cloud in this build (local / dev / default e2e build, file builds, claude.ai, share edition) | the app – nothing changes     |
 * | `open`    | signed in (2FA satisfied), or the public share view `#share/<token>`                           | the app                       |
 * | `pending` | a stored login or an auth callback (`?code=` of a confirmation / magic / reset link) is being read | a quiet splash, then app/gate |
 * | `pricing` | signed out on `#preise`                                                                      | the public pricing page (read only, every buy button leads to the registration) |
 * | `gate`    | signed out (or 2FA code missing) anywhere else                                               | the entry gate                |
 *
 * Public without a login, on top of the gate page (each a sheet with its own deep link): Impressum, Datenschutz, AGB, Widerruf, Hinweise
 * (`?rechtliches=<doc>`), „Verträge hier kündigen“ (`?kuendigen`, § 312k BGB) and „Vertrag widerrufen“ (`?widerruf`, § 356a BGB) incl. the
 * token links of their confirmation mails. The return of an e-mail link (confirmation, magic link, password reset) is `pending` until the
 * client has read it; a failed link lands on the gate with the reason.
 *
 * First visit vs. returning: the gate opens on „Konto erstellen“; once this browser had a session (`<prefix>cloud-known`, written at every
 * sign-in, or a stored – maybe expired – session) it opens on „Anmelden“.
 */
import { IS_SHARE } from "@/edition";
import { hasClaudeRuntime } from "@/store/capability";
import { useShareRoute } from "@/store/router";
import { readRaw, storageKey, writeRaw } from "@/store/storage";
import { useUi, type Page } from "@/store/uiStore";
import { cloudEnabled } from "./env";
import { hasAuthCallback, hasStoredSession } from "./hint";
import { useCloudSession, type CloudPhase } from "./session";
import type { AuthView } from "./types";

export type GateState = "off" | "open" | "pending" | "pricing" | "gate";

/** The pages a signed-out visitor may see (read only). Everything else is behind the gate. */
export const PUBLIC_PAGES: readonly Page[] = ["preise"];

export interface GateInput {
  /** Konto-Pflicht applies to this build (`gateApplies()`). */
  enabled: boolean;
  phase: CloudPhase;
  needsMfa: boolean;
  /** A login is about to be restored (stored session or an auth callback in the URL). */
  restoring: boolean;
  /** `#share/<token>` is on screen (the public view of a share link). */
  share: boolean;
  page: Page;
}

/** Pure routing of the gate (see the table above). */
export function gateOf(i: GateInput): GateState {
  if (!i.enabled) return "off";
  if (i.share) return "open";
  if (i.phase === "signedIn") return i.needsMfa ? "gate" : "open";
  if (i.phase === "loading" || (i.phase === "idle" && i.restoring)) return "pending";
  return (PUBLIC_PAGES as readonly string[]).includes(i.page) ? "pricing" : "gate";
}

/** Konto-Pflicht applies: cloud configured, a web build of the personal edition, not inside claude.ai. */
export function gateApplies(): boolean {
  return cloudEnabled() && !IS_SHARE && !hasClaudeRuntime();
}

export const KNOWN_KEY = storageKey("cloud-known");

/** This browser had a session before (returning visitor): the gate opens on „Anmelden“ instead of „Konto erstellen“. */
export function knownVisitor(): boolean {
  return readRaw(KNOWN_KEY) !== null || hasStoredSession();
}

/** Remembers that this browser had a session (written once per sign-in; storage errors are ignored). */
export function markKnownVisitor(): void {
  if (readRaw(KNOWN_KEY) === null) writeRaw(KNOWN_KEY, "1");
}

/** The view the gate opens on. */
export function gateEntryView(known: boolean = knownVisitor()): "signup" | "signin" {
  return known ? "signin" : "signup";
}

/** The steps the gate shows on its own (signed out); the account panel, the welcome and the new password belong to a session (the app). */
export const GATE_VIEWS: ReadonlySet<AuthView> = new Set<AuthView>(["signin", "magic", "signup", "reset", "sent"]);

/**
 * The view of the gate window: the 2FA code while it is missing; else the step the person is on (Passwort vergessen, Postfach, a failed
 * e-mail link's sign-in …) when the sheet is open on one; else the entry view (first visit: „Konto erstellen“, returning: „Anmelden“).
 */
export function gateViewOf(sheet: { open: boolean; view: AuthView }, needsMfa: boolean, known: boolean): AuthView {
  if (needsMfa) return "mfa";
  if (sheet.open && GATE_VIEWS.has(sheet.view)) return sheet.view;
  return gateEntryView(known);
}

/** The current gate state (re-renders on phase / 2FA / share / page changes). */
export function useEntryGate(): GateState {
  const enabled = gateApplies();
  const phase = useCloudSession((s) => s.phase);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const share = useShareRoute((s) => s.token !== null);
  const page = useUi((s) => s.page);
  return gateOf({ enabled, phase, needsMfa, restoring: enabled && (hasStoredSession() || hasAuthCallback()), share, page });
}
