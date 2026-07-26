import type { FastifyReply, FastifyRequest } from "fastify";
import { recordRateLimited } from "./metrics.js";

/**
 * PROMPT -1 §17 – Rate Limiting. Vorher existierte KEINES (bestätigt durch die
 * unabhängige Prompt-5-Review, docs/final-release-report.md §7 Bedingung 1).
 *
 * ## Der Kernkonflikt, und wie er gelöst ist
 *
 * Ein Limit, das gegen Missbrauch wirkt, darf legitime Stöße nicht töten.
 * Zwei Stöße sind in diesem System AUSDRÜCKLICH legitim und werden getestet:
 *
 *  - **Chaos-Szenario 2 (Phase 4): "dieselbe Anfrage zehnmal".** Das ist der
 *    Idempotenz-Beweis. Zehn identische Aufrufe MÜSSEN durchkommen.
 *  - **Chaos-Szenario 3: "zwei Schüler nehmen gleichzeitig denselben Slot".**
 *    Beide Anfragen müssen den Server erreichen, damit der EXCLUDE-Constraint
 *    entscheidet – nicht der Rate Limiter.
 *
 * Die Auflösung ist nicht "Limit weglassen", sondern:
 *
 *  1. **Token-Bucket mit Burst.** Nicht "N Anfragen pro Fenster" (das wirft
 *     genau am Fensterrand legitime Stöße weg), sondern eine nachfließende
 *     Rate mit einem separat konfigurierten Eimer. Zehn Anfragen in einer
 *     Sekunde sind unter `burst: 60` ein Nichtereignis.
 *  2. **Getrennte Politiken je Zweck.** Anmeldung ist eng (Missbrauch =
 *     Passwortraten), Schreibvorgänge sind mittel, Lesevorgänge sind weit,
 *     der SSE-Stream ist eine EIGENE Politik, weil eine langlebige
 *     Verbindung mit Kontingenten für kurze Anfragen nichts zu tun hat
 *     (Phase-2-Übergabe: "§17 muss `/sync/stream` ausdrücklich anders
 *     behandeln").
 *  3. **Vollständig konfigurierbar und abschaltbar.** `RATE_LIMIT_ENABLED=0`
 *     schaltet aus; Tests bauen ihre eigenen Politiken. Es gibt KEINEN
 *     hartkodierten Zahlenwert in einer Route.
 *
 * ## Zwei Dimensionen: IP und Konto
 *
 * Pro IP schützt vor anonymem Massenverkehr, pro Konto vor einem
 * kompromittierten oder außer Kontrolle geratenen Client hinter einer NAT-IP
 * (in einer Fahrschule sitzen Büro und Fahrlehrer hinter derselben IP – ein
 * reines IP-Limit wäre dort entweder wirkungslos oder eine Selbstsperre).
 * Beide werden geprüft; das ENGERE Ergebnis gewinnt.
 *
 * ## Ehrliche Einschränkung
 *
 * Die Zähler liegen im PROZESSSPEICHER. Bei mehreren API-Instanzen gilt das
 * Limit je Instanz, nicht global. Ein gemeinsamer Speicher (Redis) existiert
 * in dieser Umgebung nicht (docs/integration-gaps.md); `RateLimitStore` ist
 * der Einhängepunkt dafür und ist bewusst so schmal, dass eine
 * Redis-Implementierung ihn ohne Änderung an den Aufrufstellen erfüllt.
 * DER BRUTE-FORCE-SCHUTZ AUF DER ANMELDUNG IST DESHALB SEPARAT UND
 * PERSISTENT (siehe lib/brute-force.ts) – die Sicherheitsaussage hängt nicht
 * am Prozessspeicher.
 */

export interface RateLimitPolicy {
  /** Name (geht in Kennzahl-Label und Antwort). */
  name: string;
  /** Nachfließende Rate in Anfragen pro Sekunde. */
  ratePerSecond: number;
  /** Eimergröße = zulässiger Stoß. */
  burst: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Verbleibende Token (abgerundet). */
  remaining: number;
  /** Sekunden bis zum nächsten freien Token (für `Retry-After`). */
  retryAfterSeconds: number;
  policy: string;
  scope: "ip" | "account" | "global";
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Schmale Speicherabstraktion. Synchron, weil der Prozessspeicher synchron
 * ist; eine Redis-Implementierung liefert ein Promise und `check` wird dann
 * asynchron – das ist der einzige Grund, warum `consume` hier NICHT async ist:
 * eine falsche Async-Signatur ohne Nutzen würde jeden Aufrufer verkomplizieren.
 * Der Seam ist die KLASSE, nicht die Signatur.
 */
export class InMemoryRateLimitStore {
  private buckets = new Map<string, Bucket>();

  consume(key: string, policy: RateLimitPolicy, now: number, cost = 1): RateLimitDecision {
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: policy.burst, updatedAt: now };
    if (existing) {
      const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
      bucket.tokens = Math.min(policy.burst, bucket.tokens + elapsedSeconds * policy.ratePerSecond);
      bucket.updatedAt = now;
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
        policy: policy.name,
        scope: "global",
      };
    }

    this.buckets.set(key, bucket);
    const fehlend = cost - bucket.tokens;
    // Immer mindestens 1 Sekunde: ein `Retry-After: 0` würde einen korrekten
    // Client (Phase 2 respektiert den Header) in eine enge Schleife schicken.
    const retryAfterSeconds = Math.max(1, Math.ceil(fehlend / policy.ratePerSecond));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      policy: policy.name,
      scope: "global",
    };
  }

  /** Nur für Tests/Betrieb: alles zurücksetzen. */
  reset(): void {
    this.buckets.clear();
  }

  size(): number {
    return this.buckets.size;
  }

  /** Entfernt Eimer, die lange vollgelaufen sind (Speicherhygiene). */
  prune(now: number, idleMs = 10 * 60 * 1000): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > idleMs) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Politiken
// ---------------------------------------------------------------------------

/**
 * Die vier Politiken. Zahlen sind bewusst großzügig gewählt: ein Rate Limiter,
 * der eine echte Fahrschule im Betrieb bremst, wird abgeschaltet und schützt
 * dann gar nichts.
 *
 * `login` ist die einzige enge Politik. 0,2/s = 12/Min. bei Stoß 10 –
 * ein Mensch, der sich viermal vertippt, merkt nichts; ein Skript, das
 * Passwörter durchprobiert, kommt auf maximal 12 Versuche pro Minute und
 * pro IP, und läuft zusätzlich in die persistente Sperre aus
 * lib/brute-force.ts.
 */
export const DEFAULT_POLICIES = {
  login: { name: "login", ratePerSecond: 0.2, burst: 10 },
  write: { name: "write", ratePerSecond: 5, burst: 60 },
  read: { name: "read", ratePerSecond: 20, burst: 200 },
  /** Langlebige SSE-Verbindung: begrenzt wird der VERBINDUNGSAUFBAU, nicht der Datenfluss. */
  stream: { name: "stream", ratePerSecond: 0.5, burst: 12 },
  /** Export/Bericht: teuer, deshalb eng, aber nicht so eng wie Login. */
  expensive: { name: "expensive", ratePerSecond: 0.5, burst: 15 },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof DEFAULT_POLICIES;

export interface RateLimitConfig {
  enabled: boolean;
  policies: Record<PolicyName, RateLimitPolicy>;
  /** Faktor auf alle Politiken – erlaubt eine globale Lockerung im Betrieb. */
  multiplier: number;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Konfiguration aus der Umgebung. Standard ist EIN (ein Rate Limiter, der
 * standardmäßig aus ist, existiert nicht). Tests schalten gezielt ab bzw.
 * setzen eigene Politiken – siehe `buildApp({ rateLimit })`.
 */
export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const multiplier = positiveNumber(env.RATE_LIMIT_MULTIPLIER, 1);
  const scale = (p: RateLimitPolicy): RateLimitPolicy => ({
    name: p.name,
    ratePerSecond: p.ratePerSecond * multiplier,
    burst: Math.ceil(p.burst * multiplier),
  });
  return {
    enabled: env.RATE_LIMIT_ENABLED !== "0" && env.RATE_LIMIT_ENABLED !== "false",
    multiplier,
    policies: {
      login: scale({
        name: "login",
        ratePerSecond: positiveNumber(env.RATE_LIMIT_LOGIN_RPS, DEFAULT_POLICIES.login.ratePerSecond),
        burst: positiveNumber(env.RATE_LIMIT_LOGIN_BURST, DEFAULT_POLICIES.login.burst),
      }),
      write: scale({
        name: "write",
        ratePerSecond: positiveNumber(env.RATE_LIMIT_WRITE_RPS, DEFAULT_POLICIES.write.ratePerSecond),
        burst: positiveNumber(env.RATE_LIMIT_WRITE_BURST, DEFAULT_POLICIES.write.burst),
      }),
      read: scale({
        name: "read",
        ratePerSecond: positiveNumber(env.RATE_LIMIT_READ_RPS, DEFAULT_POLICIES.read.ratePerSecond),
        burst: positiveNumber(env.RATE_LIMIT_READ_BURST, DEFAULT_POLICIES.read.burst),
      }),
      stream: scale({
        name: "stream",
        ratePerSecond: positiveNumber(env.RATE_LIMIT_STREAM_RPS, DEFAULT_POLICIES.stream.ratePerSecond),
        burst: positiveNumber(env.RATE_LIMIT_STREAM_BURST, DEFAULT_POLICIES.stream.burst),
      }),
      expensive: scale({
        name: "expensive",
        ratePerSecond: positiveNumber(env.RATE_LIMIT_EXPENSIVE_RPS, DEFAULT_POLICIES.expensive.ratePerSecond),
        burst: positiveNumber(env.RATE_LIMIT_EXPENSIVE_BURST, DEFAULT_POLICIES.expensive.burst),
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Routenklassifikation
// ---------------------------------------------------------------------------

/**
 * Welche Politik gilt für welche Anfrage? Bewusst eine reine Funktion (keine
 * Registrierung je Route), damit eine NEUE Route nicht versehentlich ohne
 * Limit bleibt: der Standard ist `write` für alles Schreibende und `read`
 * für alles Lesende.
 */
export function policyForRequest(method: string, url: string): PolicyName {
  const path = url.split("?")[0];
  if (path === "/auth/login" || path === "/auth/step-up") return "login";
  if (path === "/sync/stream") return "stream";
  if (path.startsWith("/finance/exports") || path === "/ops/consistency/run") return "expensive";
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return "read";
  return "write";
}

/**
 * Route-Label für Kennzahlen. IDs werden ersetzt, damit die Label-Kardinalität
 * begrenzt bleibt (und keine Datensatz-ID in Prometheus landet – dasselbe
 * Redaktionsargument wie in lib/metrics.ts).
 */
export function metricRouteLabel(url: string): string {
  return url
    .split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+/g, "/:n")
    .slice(0, 64);
}

/**
 * Client-IP. `request.ip` respektiert `trustProxy`, das hier bewusst NICHT
 * aktiviert ist: ohne bekannten Reverse Proxy wäre `X-Forwarded-For`
 * fälschbar und damit ein Weg, das IP-Limit zu umgehen. Sobald ein Proxy
 * bekannt ist, wird `trustProxy` in `buildApp` gesetzt – dann stimmt
 * `request.ip` automatisch.
 */
export function clientIp(request: FastifyRequest): string {
  return request.ip || "unbekannt";
}

const ALLOWED_DECISION: RateLimitDecision = {
  allowed: true,
  remaining: Number.MAX_SAFE_INTEGER,
  retryAfterSeconds: 0,
  policy: "none",
  scope: "global",
};

export interface RateLimiter {
  /**
   * Prüft die IP-Dimension. Läuft im `onRequest`-Hook, also VOR dem
   * Sitzungs-Lookup: ein Angriffsversuch soll keine Datenbankabfrage kosten.
   */
  checkIp(request: FastifyRequest, now?: number): RateLimitDecision;
  /**
   * Prüft die KONTO-Dimension. Läuft im `preHandler`, weil dort erst
   * `request.user` gesetzt ist. Ohne Sitzung ein No-op – jede Dimension wird
   * damit genau EINMAL je Anfrage belastet.
   */
  checkAccount(request: FastifyRequest, now?: number): RateLimitDecision;
  store: InMemoryRateLimitStore;
  config: RateLimitConfig;
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const store = new InMemoryRateLimitStore();
  return {
    store,
    config,
    checkIp(request, now = Date.now()) {
      const policyName = policyForRequest(request.method, request.url);
      const policy = config.policies[policyName];
      const decision = store.consume(`ip:${policyName}:${clientIp(request)}`, policy, now);
      if (!decision.allowed) recordRateLimited("ip", metricRouteLabel(request.url));
      return { ...decision, scope: "ip" };
    },
    checkAccount(request, now = Date.now()) {
      const benutzerId = request.user?.id;
      if (!benutzerId) return ALLOWED_DECISION;
      const policyName = policyForRequest(request.method, request.url);
      const policy = config.policies[policyName];
      // Etwas weiterer Eimer als die IP-Dimension: eine Person mit mehreren
      // Geräten/Tabs ist normal, eine IP mit vielen Konten dahinter (Büro-NAT)
      // ebenfalls – deshalb sind beide Dimensionen nötig und keine reicht allein.
      const accountPolicy: RateLimitPolicy = {
        name: policy.name,
        ratePerSecond: policy.ratePerSecond,
        burst: Math.ceil(policy.burst * 1.5),
      };
      const decision = store.consume(`acct:${policyName}:${benutzerId}`, accountPolicy, now);
      if (!decision.allowed) recordRateLimited("account", metricRouteLabel(request.url));
      return { ...decision, scope: "account" };
    },
  };
}

/**
 * Antwortkörper für 429. Bewusst dieselbe Form wie die übrigen Fehler
 * (`error` als maschinenlesbarer Code) und mit `Retry-After` – Phase 2s Client
 * liest genau diesen Header (`parseRetryAfterMs`) und klassifiziert 429 als
 * transient-wiederholbar (`RATE_LIMITED` in packages/events/src/retry.ts).
 * Server und Client sind damit ohne zweite Absprache konsistent.
 */
export function sendRateLimited(reply: FastifyReply, decision: RateLimitDecision): FastifyReply {
  reply.header("Retry-After", String(decision.retryAfterSeconds));
  reply.header("X-RateLimit-Policy", decision.policy);
  reply.header("X-RateLimit-Scope", decision.scope);
  reply.header("X-RateLimit-Remaining", String(decision.remaining));
  return reply.code(429).send({
    error: "rate_limited",
    policy: decision.policy,
    scope: decision.scope,
    retryAfterSeconds: decision.retryAfterSeconds,
    hinweis:
      "Zu viele Anfragen. Der Header Retry-After nennt die Wartezeit in Sekunden; ein Wiederholversuch danach ist erlaubt.",
  });
}
