import { SESSION_COOKIE_NAME, hashSessionToken } from "@fahrschul/auth";
import { sessions } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { recordStepUpChallenge } from "./metrics.js";

/**
 * PROMPT -1 §17 – Step-up-Authentisierung für kritische Verwaltungsaktionen.
 *
 * ## Was "step-up" hier bedeutet
 *
 * Mitarbeitende haben seit Phase 0 TOTP-MFA (`STAFF_ROLES_REQUIRING_MFA`), aber
 * die MFA-Prüfung passiert EINMAL beim Anmelden und gilt dann für die ganze
 * Sitzungsdauer. Ein unbeaufsichtigter Rechner im Büro ist damit ein
 * Vollzugriff. Step-up schließt genau diese Lücke: für eine kurze Liste
 * hochwirksamer Aktionen muss eine FRISCHE Wiederanmeldung vorliegen
 * (Passwort + TOTP, maximal `STEP_UP_TTL_MS` alt).
 *
 * ## Die Liste – geschlossen, begründet, versioniert
 *
 * Aufgenommen wird eine Aktion nur, wenn sie mindestens eines erfüllt:
 * (a) sie bewegt Geld, (b) sie hebt eine Sicherheitssperre auf,
 * (c) sie verändert, wer was darf, (d) sie gibt personenbezogene Daten aus dem
 * System heraus. Alles andere bleibt bewusst OHNE Step-up – eine zu lange
 * Liste führt dazu, dass Menschen ihr Gerät entsperrt liegen lassen, um
 * arbeiten zu können.
 *
 * NICHT auf der Liste (und das ist Absicht): die Prüfungsfreigabe selbst.
 * Es gibt keine automatische Prüfungsfreigabe (Non-Negotiable), und die
 * REGULÄRE Freigabe ist die alltägliche Arbeit eines Fahrlehrers. Auf der
 * Liste steht nur die ÜBERSTEUERUNG (`exam.clearance.override`) – der Sprung
 * über eine unvollständige Voraussetzungskette hinweg.
 */

export const STEP_UP_ACTIONS = {
  /** (b) Übersteuerung der Prüfungsfreigabekette trotz fehlender Voraussetzungen. */
  examClearanceOverride: "exam.clearance.override",
  /** (a) Zahlung einer anderen Rechnung zuordnen / Zuordnung umbuchen. */
  paymentReassignment: "finance.payment.reassign",
  /** (b) Ein gesperrtes Fahrzeug wieder freigeben. */
  vehicleUnblock: "resources.vehicle.unblock",
  /** (c) Rolle oder Kontostatus eines Benutzers ändern. */
  roleChange: "users.role.change",
  /** (d) Export mit personenbezogenen Daten. */
  sensitiveExport: "finance.export.sensitive",
  /** (b) Entsperren eines durch Brute-Force-Schutz gesperrten Kontos/IP. */
  authUnlock: "auth.throttle.unlock",
  /** (c) Feature-Flag, das eine Sicherheits-/Freigaberegel beeinflusst. */
  securityFlagChange: "system.security_flag.change",
} as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[keyof typeof STEP_UP_ACTIONS];

export const STEP_UP_ACTION_VALUES: readonly string[] = Object.values(STEP_UP_ACTIONS);

/**
 * Gültigkeitsdauer einer frischen Wiederanmeldung. Fünf Minuten: lang genug,
 * um mehrere zusammenhängende Zuordnungen hintereinander zu erledigen, kurz
 * genug, dass ein verlassener Arbeitsplatz nicht ausreicht.
 */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;

export function stepUpTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.STEP_UP_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : STEP_UP_TTL_MS;
}

export interface StepUpState {
  verifiedAt: Date | null;
  scope: string | null;
}

/** Liest den Step-up-Zustand der AKTUELLEN Sitzung. */
export async function readStepUp(db: Database, request: FastifyRequest): Promise<StepUpState> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return { verifiedAt: null, scope: null };
  const [row] = await db
    .select({ verifiedAt: sessions.stepUpVerifiedAt, scope: sessions.stepUpScope })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  return { verifiedAt: row?.verifiedAt ?? null, scope: row?.scope ?? null };
}

/** Vermerkt eine erfolgreiche Wiederanmeldung an der Sitzung. */
export async function grantStepUp(
  db: Database,
  input: { sessionToken: string; scope: StepUpAction | "all"; now?: Date },
): Promise<Date> {
  const now = input.now ?? new Date();
  await db
    .update(sessions)
    .set({ stepUpVerifiedAt: now, stepUpScope: input.scope })
    .where(eq(sessions.tokenHash, hashSessionToken(input.sessionToken)));
  recordStepUpChallenge("granted");
  return now;
}

/** Entzieht Step-up (z. B. nach Ausführung der Aktion, wenn `scope` eng war). */
export async function revokeStepUp(db: Database, sessionToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ stepUpVerifiedAt: null, stepUpScope: null })
    .where(eq(sessions.tokenHash, hashSessionToken(sessionToken)));
}

export interface StepUpCheck {
  ok: boolean;
  reason?: "step_up_required" | "step_up_expired" | "step_up_scope_mismatch";
  ageMs?: number;
}

export function evaluateStepUp(
  state: StepUpState,
  action: StepUpAction,
  options: { now?: Date; ttlMs?: number } = {},
): StepUpCheck {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? stepUpTtlMs();
  if (!state.verifiedAt) return { ok: false, reason: "step_up_required" };
  const ageMs = now.getTime() - state.verifiedAt.getTime();
  if (ageMs > ttlMs) return { ok: false, reason: "step_up_expired", ageMs };
  if (state.scope && state.scope !== "all" && state.scope !== action) {
    return { ok: false, reason: "step_up_scope_mismatch", ageMs };
  }
  return { ok: true, ageMs };
}

/**
 * Fastify-preHandler-Fabrik. Wird ZUSÄTZLICH zu `requireAuth` und
 * `requirePermission` gesetzt, niemals stattdessen: Step-up ist eine dritte
 * Hürde, kein Ersatz für Autorisierung.
 */
export function requireStepUp(db: Database, action: StepUpAction) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const state = await readStepUp(db, request);
    const result = evaluateStepUp(state, action);
    if (!result.ok) {
      recordStepUpChallenge("required");
      return sendStepUpRequired(reply, action, result);
    }
    request.stepUpAction = action;
  };
}

/**
 * In-Handler-Variante für BEDINGTE Step-up-Pflicht.
 *
 * Nötig, weil drei der sieben Aktionen nicht am Endpunkt, sondern am INHALT
 * hängen: eine Erstzuordnung einer Zahlung ist Alltagsarbeit, eine UMbuchung
 * ist es nicht; ein Prüfungsübergang ist Alltagsarbeit, der Sprung über eine
 * unvollständige Voraussetzungskette ist es nicht; ein Umsatzbericht ist
 * Alltagsarbeit, ein Export mit Schülerdaten ist es nicht. Ein preHandler
 * kennt den Inhalt noch nicht gut genug.
 *
 * Rückgabe `true` = es wurde bereits geantwortet, der Handler muss zurückkehren.
 */
export async function stepUpBlocked(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  action: StepUpAction,
): Promise<boolean> {
  const state = await readStepUp(db, request);
  const result = evaluateStepUp(state, action);
  if (result.ok) return false;
  recordStepUpChallenge("required");
  sendStepUpRequired(reply, action, result);
  return true;
}

export function sendStepUpRequired(
  reply: FastifyReply,
  action: StepUpAction,
  result: StepUpCheck,
): FastifyReply {
  // 401 wäre falsch (die Sitzung ist gültig), 403 wäre falsch (die
  // Berechtigung ist vorhanden). HTTP 403 mit einem eindeutigen `error`-Code
  // ist trotzdem die richtige Wahl gegenüber einem exotischen Status: Phase 2s
  // Client klassifiziert 403 als PERMISSION und wiederholt NICHT automatisch –
  // exakt richtig, denn hier muss ein Mensch etwas tun.
  return reply.code(403).send({
    error: "step_up_required",
    reason: result.reason,
    action,
    ttlSeconds: Math.round(stepUpTtlMs() / 1000),
    hinweis:
      "Diese Aktion verlangt eine frische Wiederanmeldung (§17). POST /auth/step-up mit Passwort und TOTP-Code, danach die Aktion erneut auslösen.",
  });
}

declare module "fastify" {
  interface FastifyRequest {
    stepUpAction?: StepUpAction;
  }
}
