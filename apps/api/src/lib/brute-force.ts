import { authThrottle, auditEreignisse } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { and, eq, sql } from "drizzle-orm";

/**
 * PROMPT -1 §17 – Brute-Force-Schutz auf der Anmeldung.
 *
 * ## Die Abwägung, die der Auftrag ausdrücklich verlangt
 *
 * Eine harte Kontosperre nach N Fehlversuchen ist der Standardvorschlag – und
 * gleichzeitig ein fertiger **Denial-of-Service gegen einen bekannten
 * Menschen**. Wer die E-Mail einer Büromitarbeiterin kennt, sperrt sie mit
 * fünf falschen Passwörtern aus, jeden Morgen um 7:55. In einer Fahrschule mit
 * einer Handvoll Mitarbeitenden ist das kein theoretisches Risiko: es ist der
 * wahrscheinlichere Angriff als das Passwortraten selbst.
 *
 * **Entscheidung: zwei asymmetrische Zweige.**
 *
 * | Zweig | Mechanismus | Wirkt gegen | Kollateralschaden |
 * | --- | --- | --- | --- |
 * | Konto (E-Mail) | PROGRESSIVE VERZÖGERUNG, Sperre erst spät und dann kurz | verteiltes Raten auf ein Konto | begrenzt: Sperre ≤ 15 Min., läuft von selbst ab |
 * | IP | harte, exponentiell wachsende Sperre | ein Angreifer, der viel probiert | trifft nur seine eigene Herkunft |
 *
 * Konkret:
 *  - **Konto:** ab dem 4. Fehlversuch wird die Antwort künstlich verzögert
 *    (0,5 s, 1 s, 2 s, 4 s … gekappt bei 4 s). Verzögerung ist die
 *    wirkungsvollste Maßnahme gegen Online-Raten (sie senkt den Durchsatz um
 *    Größenordnungen) und die harmloseste für den echten Nutzer (er wartet
 *    zwei Sekunden). Erst ab 12 Fehlversuchen innerhalb des Fensters folgt
 *    eine **kurze** Sperre von 15 Minuten, damit ein Dauerangriff nicht
 *    beliebig Rechenzeit (argon2/bcrypt!) verbrennt.
 *  - **IP:** ab 20 Fehlversuchen 15 Minuten, danach verdoppelnd bis 24 h.
 *  - **Erfolg löscht den Kontozweig sofort.** Ein Mensch, der sich nach drei
 *    Versuchen erinnert, startet bei null.
 *  - **Der Zähler ist ein Fenster.** Nach `WINDOW_MS` ohne Fehlversuch
 *    beginnt die Zählung neu; alte Fehlversuche summieren sich nicht über
 *    Monate zu einer Sperre.
 *
 * ## Entsperrpfad (ausdrücklich gefordert)
 *
 * Drei Wege, absteigend nach Selbstbedienung:
 *  1. **Warten.** Jede Sperre hat ein Ende (`locked_until`). Die Antwort nennt
 *     die Wartezeit über `Retry-After`, damit niemand raten muss.
 *  2. **Anderer Standort/Gerät.** Weil die harte Sperre am IP-Zweig hängt und
 *     die Kontosperre kurz ist, ist ein Mensch nie dauerhaft ausgeschlossen.
 *  3. **`POST /auth/unlock` durch die Rolle systemdienst** (`users:manage`).
 *     Auditiert mit Akteur und Ziel. Das ist der Pfad für "ich komme heute
 *     nicht rein und habe keine 15 Minuten".
 *
 * ## Warum persistent und nicht im Prozessspeicher
 *
 * Ein Neustart darf einen laufenden Angriff nicht zurücksetzen, und mehrere
 * API-Instanzen müssen dieselbe Sicht haben. Deshalb liegt der Zustand in
 * `auth_throttle` (Migration 0009) – im Gegensatz zum allgemeinen Rate Limiter
 * (lib/rate-limit.ts), dessen Prozessspeicher für eine Verkehrsbremse
 * ausreicht, aber für eine Sicherheitsaussage nicht.
 *
 * ## Kein Enumerationsorakel
 *
 * Die Antwort auf "gesperrt" ist für existierende UND nicht existierende
 * Konten identisch (`account_temporarily_locked` + `Retry-After`), und
 * `registerFailure` wird auch für unbekannte E-Mails aufgerufen. Ein Angreifer
 * lernt aus dem Sperrverhalten nicht, ob ein Konto existiert.
 */

export interface BruteForceConfig {
  /** Zeitfenster, in dem Fehlversuche zusammengezählt werden. */
  windowMs: number;
  /** Ab diesem Fehlversuch wird verzögert. */
  accountDelayAfter: number;
  /** Basisverzögerung; verdoppelt sich je weiterem Fehlversuch. */
  accountDelayBaseMs: number;
  accountDelayMaxMs: number;
  /** Ab diesem Fehlversuch wird das Konto kurz gesperrt. */
  accountLockAfter: number;
  accountLockMs: number;
  /** Ab diesem Fehlversuch wird die IP gesperrt. */
  ipLockAfter: number;
  ipLockBaseMs: number;
  ipLockMaxMs: number;
}

export const DEFAULT_BRUTE_FORCE: BruteForceConfig = {
  windowMs: 15 * 60 * 1000,
  accountDelayAfter: 4,
  accountDelayBaseMs: 500,
  accountDelayMaxMs: 4000,
  accountLockAfter: 12,
  accountLockMs: 15 * 60 * 1000,
  ipLockAfter: 20,
  ipLockBaseMs: 15 * 60 * 1000,
  ipLockMaxMs: 24 * 60 * 60 * 1000,
};

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function bruteForceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BruteForceConfig {
  return {
    windowMs: positive(env.BRUTE_FORCE_WINDOW_MS, DEFAULT_BRUTE_FORCE.windowMs),
    accountDelayAfter: positive(env.BRUTE_FORCE_DELAY_AFTER, DEFAULT_BRUTE_FORCE.accountDelayAfter),
    accountDelayBaseMs: positive(env.BRUTE_FORCE_DELAY_BASE_MS, DEFAULT_BRUTE_FORCE.accountDelayBaseMs),
    accountDelayMaxMs: positive(env.BRUTE_FORCE_DELAY_MAX_MS, DEFAULT_BRUTE_FORCE.accountDelayMaxMs),
    accountLockAfter: positive(env.BRUTE_FORCE_ACCOUNT_LOCK_AFTER, DEFAULT_BRUTE_FORCE.accountLockAfter),
    accountLockMs: positive(env.BRUTE_FORCE_ACCOUNT_LOCK_MS, DEFAULT_BRUTE_FORCE.accountLockMs),
    ipLockAfter: positive(env.BRUTE_FORCE_IP_LOCK_AFTER, DEFAULT_BRUTE_FORCE.ipLockAfter),
    ipLockBaseMs: positive(env.BRUTE_FORCE_IP_LOCK_BASE_MS, DEFAULT_BRUTE_FORCE.ipLockBaseMs),
    ipLockMaxMs: positive(env.BRUTE_FORCE_IP_LOCK_MAX_MS, DEFAULT_BRUTE_FORCE.ipLockMaxMs),
  };
}

export type ThrottleScope = "account" | "ip";

export interface ThrottleState {
  scope: ThrottleScope;
  key: string;
  failures: number;
  lockedUntil: Date | null;
}

export interface BruteForceCheck {
  /** true = Anfrage darf NICHT weiterverarbeitet werden. */
  locked: boolean;
  lockedScope: ThrottleScope | null;
  retryAfterSeconds: number;
  /** Künstliche Verzögerung, die VOR der Passwortprüfung anzuwenden ist. */
  delayMs: number;
  accountFailures: number;
  ipFailures: number;
}

function normalizeAccountKey(email: string): string {
  return email.trim().toLowerCase().slice(0, 320);
}

async function readState(
  db: Database,
  scope: ThrottleScope,
  key: string,
  now: Date,
  windowMs: number,
): Promise<ThrottleState> {
  const [row] = await db
    .select()
    .from(authThrottle)
    .where(and(eq(authThrottle.scope, scope), eq(authThrottle.key, key)))
    .limit(1);
  if (!row) return { scope, key, failures: 0, lockedUntil: null };

  const lockedUntil = row.lockedUntil && row.lockedUntil.getTime() > now.getTime() ? row.lockedUntil : null;
  // Fenster abgelaufen -> Zählung gilt als zurückgesetzt (ohne Schreibvorgang;
  // der nächste Fehlversuch überschreibt sie ohnehin).
  const windowExpired = now.getTime() - row.lastFailureAt.getTime() > windowMs;
  return {
    scope,
    key,
    failures: windowExpired && !lockedUntil ? 0 : row.failures,
    lockedUntil,
  };
}

/**
 * Prüft VOR der Passwortverifikation. Liefert Sperre und Verzögerung.
 * Bewusst kein Schreibvorgang: ein Leseaufruf darf keinen Zähler hochzählen,
 * sonst wäre ein GET auf den Login-Endpunkt schon ein Angriff.
 */
export async function checkBruteForce(
  db: Database,
  input: { email: string; ip: string; now?: Date; config?: BruteForceConfig },
): Promise<BruteForceCheck> {
  const config = input.config ?? DEFAULT_BRUTE_FORCE;
  const now = input.now ?? new Date();
  const accountKey = normalizeAccountKey(input.email);

  const [account, ip] = await Promise.all([
    readState(db, "account", accountKey, now, config.windowMs),
    readState(db, "ip", input.ip, now, config.windowMs),
  ]);

  // IP-Sperre gewinnt: sie ist die härtere und trifft den Verursacher.
  if (ip.lockedUntil) {
    return {
      locked: true,
      lockedScope: "ip",
      retryAfterSeconds: Math.max(1, Math.ceil((ip.lockedUntil.getTime() - now.getTime()) / 1000)),
      delayMs: 0,
      accountFailures: account.failures,
      ipFailures: ip.failures,
    };
  }
  if (account.lockedUntil) {
    return {
      locked: true,
      lockedScope: "account",
      retryAfterSeconds: Math.max(1, Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 1000)),
      delayMs: 0,
      accountFailures: account.failures,
      ipFailures: ip.failures,
    };
  }

  const ueber = account.failures - (config.accountDelayAfter - 1);
  const delayMs =
    ueber > 0
      ? Math.min(config.accountDelayMaxMs, config.accountDelayBaseMs * 2 ** (ueber - 1))
      : 0;

  return {
    locked: false,
    lockedScope: null,
    retryAfterSeconds: 0,
    delayMs,
    accountFailures: account.failures,
    ipFailures: ip.failures,
  };
}

async function bumpFailure(
  db: Database,
  scope: ThrottleScope,
  key: string,
  now: Date,
  config: BruteForceConfig,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const lockAfter = scope === "account" ? config.accountLockAfter : config.ipLockAfter;

  // Ein einziges Upsert: `failures` wird im Fenster hochgezählt, außerhalb des
  // Fensters auf 1 zurückgesetzt. Die Sperre wird im gleichen Statement
  // berechnet, damit zwei parallele Fehlversuche nicht in eine Race laufen.
  const windowStart = new Date(now.getTime() - config.windowMs);
  const [row] = await db
    .insert(authThrottle)
    .values({
      scope,
      key,
      failures: 1,
      firstFailureAt: now,
      lastFailureAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [authThrottle.scope, authThrottle.key],
      set: {
        failures: sql`case when ${authThrottle.lastFailureAt} < ${windowStart.toISOString()}::timestamptz then 1 else ${authThrottle.failures} + 1 end`,
        firstFailureAt: sql`case when ${authThrottle.lastFailureAt} < ${windowStart.toISOString()}::timestamptz then ${now.toISOString()}::timestamptz else ${authThrottle.firstFailureAt} end`,
        lastFailureAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (row.failures < lockAfter) return { failures: row.failures, lockedUntil: null };

  const lockMs =
    scope === "account"
      ? config.accountLockMs
      : Math.min(config.ipLockMaxMs, config.ipLockBaseMs * 2 ** Math.max(0, row.lockCount));
  const lockedUntil = new Date(now.getTime() + lockMs);
  const [locked] = await db
    .update(authThrottle)
    .set({ lockedUntil, lockCount: sql`${authThrottle.lockCount} + 1`, updatedAt: now })
    .where(and(eq(authThrottle.scope, scope), eq(authThrottle.key, key)))
    .returning();
  return { failures: locked.failures, lockedUntil: locked.lockedUntil };
}

export interface FailureOutcome {
  accountFailures: number;
  ipFailures: number;
  accountLockedUntil: Date | null;
  ipLockedUntil: Date | null;
  newlyLocked: ThrottleScope | null;
}

/**
 * Nach einem FEHLGESCHLAGENEN Anmeldeversuch aufzurufen – auch dann, wenn das
 * Konto nicht existiert (siehe Modulkommentar: kein Enumerationsorakel).
 */
export async function registerLoginFailure(
  db: Database,
  input: { email: string; ip: string; reason: string; now?: Date; config?: BruteForceConfig },
): Promise<FailureOutcome> {
  const config = input.config ?? DEFAULT_BRUTE_FORCE;
  const now = input.now ?? new Date();
  const accountKey = normalizeAccountKey(input.email);

  const account = await bumpFailure(db, "account", accountKey, now, config);
  const ip = await bumpFailure(db, "ip", input.ip, now, config);

  const newlyLocked = ip.lockedUntil ? "ip" : account.lockedUntil ? "account" : null;
  return {
    accountFailures: account.failures,
    ipFailures: ip.failures,
    accountLockedUntil: account.lockedUntil,
    ipLockedUntil: ip.lockedUntil,
    newlyLocked,
  };
}

/**
 * Nach einer ERFOLGREICHEN Anmeldung: Kontozähler löschen. Der IP-Zähler wird
 * NICHT gelöscht – ein Angreifer, der zufällig ein gültiges Konto trifft,
 * soll damit nicht sein IP-Budget zurücksetzen können.
 */
export async function clearLoginFailures(
  db: Database,
  input: { email: string },
): Promise<void> {
  await db
    .delete(authThrottle)
    .where(and(eq(authThrottle.scope, "account"), eq(authThrottle.key, normalizeAccountKey(input.email))));
}

export interface UnlockResult {
  ok: boolean;
  entsperrt: number;
}

/**
 * Der Entsperrpfad. Nur für Rolle systemdienst (`users:manage`), immer
 * auditiert. Entsperrt Konto und/oder IP.
 */
export async function unlockThrottle(
  db: Database,
  input: {
    scope: ThrottleScope;
    key: string;
    akteurBenutzerId: string;
    standortId: string | null;
    correlationId?: string;
  },
): Promise<UnlockResult> {
  const now = new Date();
  const key = input.scope === "account" ? normalizeAccountKey(input.key) : input.key;
  const rows = await db
    .delete(authThrottle)
    .where(and(eq(authThrottle.scope, input.scope), eq(authThrottle.key, key)))
    .returning({ key: authThrottle.key });

  await db.insert(auditEreignisse).values(
    buildEventRow({
      type: "auth.throttle.unlocked",
      aktion: "auth.unlock",
      entitaet: "auth_throttle",
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:auth.unlock",
      correlationId: input.correlationId,
      // Bewusst OHNE den Schlüssel im Klartext: eine E-Mail im Audit-Payload
      // wäre ein zusätzlicher personenbezogener Ort. Der Geltungsbereich und
      // die Anzahl genügen für die Nachvollziehbarkeit; wer entsperrt wurde,
      // steht über `entitaet_id`-freie Korrelation im Zugriffsprotokoll.
      payload: { scope: input.scope, entsperrt: rows.length, at: now.toISOString() },
    }),
  );

  return { ok: true, entsperrt: rows.length };
}

/** Betriebsansicht: aktuell gesperrte Einträge. */
export async function listLockedThrottles(db: Database, now = new Date()) {
  return db
    .select({
      scope: authThrottle.scope,
      failures: authThrottle.failures,
      lockedUntil: authThrottle.lockedUntil,
      lockCount: authThrottle.lockCount,
      lastFailureAt: authThrottle.lastFailureAt,
    })
    .from(authThrottle)
    .where(sql`${authThrottle.lockedUntil} is not null and ${authThrottle.lockedUntil} > ${now.toISOString()}::timestamptz`);
}

/** Für Tests und den Aufräumjob: abgelaufene Zeilen entfernen. */
export async function purgeExpiredThrottles(db: Database, now = new Date(), windowMs = DEFAULT_BRUTE_FORCE.windowMs) {
  const cutoff = new Date(now.getTime() - windowMs);
  const removed = await db
    .delete(authThrottle)
    .where(
      sql`${authThrottle.lastFailureAt} < ${cutoff.toISOString()}::timestamptz
          and (${authThrottle.lockedUntil} is null or ${authThrottle.lockedUntil} < ${now.toISOString()}::timestamptz)`,
    )
    .returning({ key: authThrottle.key });
  return removed.length;
}

/** Nichtblockierende Verzögerung (progressive Antwortverzögerung). */
export function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
