import { describe, expect, it } from "vitest";
import {
  CircuitOpenError,
  DEFAULT_TIMEOUTS,
  INTEGRATIONS,
  IntegrationGuard,
  IntegrationGuardRegistry,
  retryAfterMsFromError,
  withTimeout,
  type ResilienceOptions,
} from "./resilience.js";

/**
 * PROMPT -1 §11 – der Circuit Breaker als reine Einheit geprüft.
 *
 * Absichtlich OHNE Datenbank und ohne HTTP: hier wird die Mechanik bewiesen
 * (Zustandsübergänge, Sondierung, Erholung, Zeitlimit, Rate-Limit-Sonderfall).
 * Die WIRKUNG im System (Puffer, Fehlerwarteschlange, Gesundheitstabelle,
 * degradierter Betrieb) ist in `apps/api/src/__tests__/resilience.test.ts`
 * gegen echtes Postgres geprüft.
 */

function transientError(message = "Anbieter weg") {
  return Object.assign(new Error(message), { errorClass: "SERVER_UNAVAILABLE" as const });
}

function buildGuard(overrides: Partial<ResilienceOptions> = {}) {
  let now = 1_000_000;
  const guard = new IntegrationGuard({
    integration: "notifications",
    mode: "mock",
    timeoutMs: 50,
    maxAttempts: 1,
    breaker: { failureThreshold: 3, successThreshold: 2, openMs: 1000, maxOpenMs: 8000 },
    now: () => now,
    sleep: async () => undefined,
    ...overrides,
  });
  return {
    guard,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

describe("PROMPT -1 §11 – Circuit Breaker", () => {
  it("bleibt geschlossen, solange Aufrufe gelingen", async () => {
    const { guard } = buildGuard();
    for (let i = 0; i < 10; i += 1) {
      const result = await guard.call(async () => "ok", { operation: "send", idempotencyKey: `k-${i}` });
      expect(result.ok).toBe(true);
    }
    expect(guard.breakerState).toBe("closed");
    expect(guard.snapshot().status).toBe("gesund");
    expect(guard.snapshot().lastSuccessAt).not.toBeNull();
  });

  it("öffnet nach `failureThreshold` aufeinanderfolgenden Fehlern und schließt dann JEDEN Aufruf kurz", async () => {
    const { guard } = buildGuard();
    for (let i = 0; i < 3; i += 1) {
      const result = await guard.call(
        async () => {
          throw transientError();
        },
        { operation: "send", idempotencyKey: `f-${i}` },
      );
      expect(result.ok).toBe(false);
      expect(result.shortCircuited).toBe(false);
    }
    expect(guard.breakerState).toBe("open");
    expect(guard.snapshot().status).toBe("ausgefallen");

    // Der entscheidende Nachweis: der nächste Aufruf wird GAR NICHT VERSUCHT.
    let versucht = false;
    const kurzgeschlossen = await guard.call(
      async () => {
        versucht = true;
        return "ok";
      },
      { operation: "send", idempotencyKey: "nach-open" },
    );
    expect(versucht).toBe(false);
    expect(kurzgeschlossen.shortCircuited).toBe(true);
    expect(kurzgeschlossen.errorClass).toBe("SERVER_UNAVAILABLE");
    expect(kurzgeschlossen.error).toContain("Circuit Breaker ist offen");
  });

  it("geht nach Ablauf der Öffnungszeit in half_open und lässt GENAU EINEN Sondierungsaufruf durch", async () => {
    const h = buildGuard();
    for (let i = 0; i < 3; i += 1) {
      await h.guard.call(
        async () => {
          throw transientError();
        },
        { operation: "send", idempotencyKey: `f-${i}` },
      );
    }
    expect(h.guard.breakerState).toBe("open");

    h.advance(1001);
    expect(h.guard.breakerState).toBe("half_open");

    // Die Sondierung wird versucht …
    let sondierungen = 0;
    const probe = h.guard.call(
      async () => {
        sondierungen += 1;
        // absichtlich hängend, bis wir den zweiten Aufruf gemacht haben
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "ok";
      },
      { operation: "send", idempotencyKey: "probe-1" },
    );
    // … ein PARALLELER Aufruf wird währenddessen kurzgeschlossen (kein Sturm).
    const parallel = await h.guard.call(
      async () => {
        sondierungen += 1;
        return "ok";
      },
      { operation: "send", idempotencyKey: "parallel-1" },
    );
    expect(parallel.shortCircuited).toBe(true);
    expect(parallel.error).toContain("Sondierung läuft bereits");

    const probeResult = await probe;
    expect(probeResult.ok).toBe(true);
    expect(sondierungen).toBe(1);
  });

  it("schließt nach `successThreshold` erfolgreichen Sondierungen wieder (Erholung)", async () => {
    const h = buildGuard();
    for (let i = 0; i < 3; i += 1) {
      await h.guard.call(
        async () => {
          throw transientError();
        },
        { operation: "send", idempotencyKey: `f-${i}` },
      );
    }
    h.advance(1001);
    expect(h.guard.breakerState).toBe("half_open");

    const erste = await h.guard.call(async () => "ok", { operation: "send", idempotencyKey: "p1" });
    expect(erste.ok).toBe(true);
    expect(h.guard.breakerState).toBe("half_open"); // successThreshold = 2

    const zweite = await h.guard.call(async () => "ok", { operation: "send", idempotencyKey: "p2" });
    expect(zweite.ok).toBe(true);
    expect(h.guard.breakerState).toBe("closed");
    expect(h.guard.snapshot().consecutiveFailures).toBe(0);
  });

  it("öffnet bei einem FEHLSCHLAG der Sondierung erneut – mit VERDOPPELTER Öffnungszeit", async () => {
    const h = buildGuard();
    for (let i = 0; i < 3; i += 1) {
      await h.guard.call(
        async () => {
          throw transientError();
        },
        { operation: "send", idempotencyKey: `f-${i}` },
      );
    }
    h.advance(1001);
    expect(h.guard.breakerState).toBe("half_open");

    await h.guard.call(
      async () => {
        throw transientError();
      },
      { operation: "send", idempotencyKey: "probe-fail" },
    );
    expect(h.guard.breakerState).toBe("open");

    // Nach der ALTEN Öffnungszeit ist er noch NICHT half_open …
    h.advance(1001);
    expect(h.guard.breakerState).toBe("open");
    // … erst nach der verdoppelten.
    h.advance(1000);
    expect(h.guard.breakerState).toBe("half_open");
  });

  it("erklärt einen hängenden Aufruf nach dem Zeitlimit zum TIMEOUT statt zu warten", async () => {
    const { guard } = buildGuard({ timeoutMs: 20 });
    const started = Date.now();
    const result = await guard.call(
      () => new Promise((resolve) => setTimeout(() => resolve("zu spät"), 500)),
      { operation: "send", idempotencyKey: "hang" },
    );
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe("TIMEOUT");
    // Der Aufrufer hat NICHT auf die 500 ms gewartet.
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("öffnet NICHT bei dauerhaften Fehlern – ein falscher Datensatz darf keine Integration abschalten", async () => {
    const { guard } = buildGuard();
    for (let i = 0; i < 10; i += 1) {
      const result = await guard.call(
        async () => {
          throw Object.assign(new Error("Adresse ungültig"), { status: 422 });
        },
        { operation: "send", idempotencyKey: `v-${i}` },
      );
      expect(result.errorClass).toBe("VALIDATION");
    }
    expect(guard.breakerState).toBe("closed");
  });

  it("behandelt ein Rate Limit des Anbieters als Wartezeit, NICHT als Ausfall", async () => {
    const h = buildGuard();
    const rateLimited = Object.assign(new Error("429"), { status: 429, retryAfter: "2" });
    const first = await h.guard.call(
      async () => {
        throw rateLimited;
      },
      { operation: "send", idempotencyKey: "rl-1" },
    );
    expect(first.errorClass).toBe("RATE_LIMITED");
    // Kein Breaker-Fehler …
    expect(h.guard.breakerState).toBe("closed");
    expect(h.guard.snapshot().status).toBe("eingeschraenkt");
    expect(h.guard.snapshot().rateLimitedUntil).not.toBeNull();

    // … aber der nächste Aufruf wird vor Ablauf der Wartezeit nicht versucht.
    let versucht = false;
    const gesperrt = await h.guard.call(
      async () => {
        versucht = true;
        return "ok";
      },
      { operation: "send", idempotencyKey: "rl-2" },
    );
    expect(versucht).toBe(false);
    expect(gesperrt.errorClass).toBe("RATE_LIMITED");

    h.advance(2001);
    const danach = await h.guard.call(async () => "ok", { operation: "send", idempotencyKey: "rl-3" });
    expect(danach.ok).toBe(true);
  });

  it("liest Retry-After als Sekunden UND als HTTP-Datum", () => {
    const now = Date.parse("2026-07-26T10:00:00Z");
    expect(retryAfterMsFromError({ retryAfter: "5" }, now)).toBe(5000);
    expect(
      retryAfterMsFromError({ retryAfter: new Date(now + 30_000).toUTCString() }, now),
    ).toBeGreaterThanOrEqual(29_000);
    expect(retryAfterMsFromError({ retryAfter: "unsinn" }, now)).toBeNull();
    expect(retryAfterMsFromError({}, now)).toBeNull();
  });

  it("wiederholt transiente Fehler nach der GETEILTEN §9-Politik (kein zweites Regelwerk)", async () => {
    const { guard } = buildGuard({ maxAttempts: 3, breaker: { failureThreshold: 99, successThreshold: 1, openMs: 1000, maxOpenMs: 1000 } });
    let versuche = 0;
    const result = await guard.call(
      async () => {
        versuche += 1;
        if (versuche < 3) throw transientError();
        return "endlich";
      },
      { operation: "send", idempotencyKey: "retry" },
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(versuche).toBe(3);
  });

  it("trägt den Idempotenzschlüssel des ausgehenden Aufrufs durch – auch im Fehlerfall", async () => {
    const { guard } = buildGuard();
    const ok = await guard.call(async () => "x", { operation: "send", idempotencyKey: "stabil-1" });
    expect(ok.idempotencyKey).toBe("stabil-1");
    const fehler = await guard.call(
      async () => {
        throw transientError();
      },
      { operation: "send", idempotencyKey: "stabil-2" },
    );
    expect(fehler.idempotencyKey).toBe("stabil-2");
  });

  it("meldet jeden Zustandswechsel EINMAL an `onStateChange` (Alarmierungshaken)", async () => {
    const wechsel: string[] = [];
    const h = buildGuard({
      onStateChange: (from, to) => {
        wechsel.push(`${from}->${to}`);
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await h.guard.call(
        async () => {
          throw transientError();
        },
        { operation: "send", idempotencyKey: `f-${i}` },
      );
    }
    h.advance(1001);
    void h.guard.breakerState;
    await h.guard.call(async () => "ok", { operation: "send", idempotencyKey: "p1" });
    await h.guard.call(async () => "ok", { operation: "send", idempotencyKey: "p2" });
    expect(wechsel).toEqual(["closed->open", "open->half_open", "half_open->closed"]);
  });

  it("legt die Fehlerwarteschlange erst an, wenn die Versuche erschöpft sind", async () => {
    const eintraege: unknown[] = [];
    const { guard } = buildGuard({
      maxAttempts: 2,
      onErrorQueue: (e) => {
        eintraege.push(e);
      },
    });
    await guard.call(
      async () => {
        throw transientError();
      },
      { operation: "send", idempotencyKey: "eq-1" },
    );
    expect(eintraege).toHaveLength(1);
    expect((eintraege[0] as { idempotencyKey: string }).idempotencyKey).toBe("eq-1");
    expect((eintraege[0] as { attempts: number }).attempts).toBe(2);
  });

  it("erlaubt manuelles Öffnen und Schließen (Betrieb: Wartungsfenster / 'jetzt neu versuchen')", async () => {
    const { guard } = buildGuard();
    guard.trip("Anbieter in Wartung");
    expect(guard.breakerState).toBe("open");
    guard.reset();
    expect(guard.breakerState).toBe("closed");
    const result = await guard.call(async () => "ok", { operation: "send", idempotencyKey: "manuell" });
    expect(result.ok).toBe(true);
  });

  it("`withTimeout` verwirft das späte Ergebnis, ohne einen unbehandelten Fehler zu erzeugen", async () => {
    await expect(
      withTimeout(
        new Promise((_, reject) => setTimeout(() => reject(new Error("spät")), 30)),
        5,
        () => new Error("timeout"),
      ),
    ).rejects.toThrow("timeout");
    // Kurz warten, damit ein etwaiges unhandledRejection sichtbar würde.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe("PROMPT -1 §11 – Registry und Abdeckung", () => {
  it("führt je Integration GENAU EINEN Wächter", () => {
    const registry = new IntegrationGuardRegistry();
    const a = registry.ensure({ integration: "bank", mode: "mock" });
    const b = registry.ensure({ integration: "bank", mode: "mock" });
    expect(a).toBe(b);
    expect(registry.all()).toHaveLength(1);
  });

  it("deckt ALLE zehn Integrationen aus docs/integration-gaps.md mit einem Zeitlimit ab", () => {
    for (const name of INTEGRATIONS) {
      expect(DEFAULT_TIMEOUTS[name], `Zeitlimit für ${name} fehlt`).toBeGreaterThan(0);
    }
    expect(Object.keys(DEFAULT_TIMEOUTS).sort()).toEqual([...INTEGRATIONS].sort());
  });

  it("liefert einen Gesundheitsschnappschuss je Integration – inklusive Modus (mock)", () => {
    const registry = new IntegrationGuardRegistry();
    for (const name of INTEGRATIONS) {
      registry.ensure({ integration: name, mode: "mock", timeoutMs: DEFAULT_TIMEOUTS[name] });
    }
    const snapshots = registry.snapshots();
    expect(snapshots).toHaveLength(INTEGRATIONS.length);
    for (const s of snapshots) {
      expect(s.mode).toBe("mock");
      expect(s.breakerState).toBe("closed");
      expect(s.status).toBe("gesund");
      expect(s.lastSuccessAt).toBeNull();
    }
  });

  it("`CircuitOpenError` ist als TRANSIENT klassifiziert – der Aufrufer darf puffern", () => {
    const err = new CircuitOpenError("bank", 5000);
    expect(err.errorClass).toBe("SERVER_UNAVAILABLE");
    expect(err.retryAfterMs).toBe(5000);
  });
});
