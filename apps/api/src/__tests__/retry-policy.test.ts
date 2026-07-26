import { describe, expect, it } from "vitest";
import {
  BUSINESS_SQLSTATE,
  classifyError,
  computeBackoffMs,
  decideRetry,
  isTransient,
  PERMANENT_ERROR_CLASSES,
  TRANSIENT_ERROR_CLASSES,
} from "@fahrschul/events";

/**
 * PROMPT -1 §9 (Serverseite) – Wiederholungsstrategie.
 *
 * Getestet wird hier bewusst in apps/api statt in packages/events, weil
 * packages/events kein eigenes Test-Runner-Setup hat (kein vitest in seinen
 * devDependencies) und ein zusätzlicher Installationsschritt in dieser
 * Umgebung vermieden werden soll. Die Datei importiert ausschließlich über
 * die öffentliche Paketgrenze `@fahrschul/events`.
 *
 * PHASE-2-SEAM: dieselben Funktionen bilden die Client-Seite von §9 ab.
 */
describe("§9 error classification", () => {
  it("classifies timeouts, 429 and selected 5xx as transient", () => {
    expect(classifyError({ status: 408 })).toBe("TIMEOUT");
    expect(classifyError({ status: 429 })).toBe("RATE_LIMITED");
    for (const status of [500, 502, 503, 504]) {
      expect(classifyError({ status }), `HTTP ${status}`).toBe("SERVER_UNAVAILABLE");
      expect(isTransient(classifyError({ status }))).toBe(true);
    }
    expect(classifyError({ code: "ECONNRESET" })).toBe("NETWORK");
    expect(classifyError({ code: "ETIMEDOUT" })).toBe("TIMEOUT");
    expect(classifyError({ code: "40001" })).toBe("SERIALIZATION_FAILURE");
  });

  it("NEVER classifies validation/permission/business-conflict/expired/stale as transient", () => {
    const cases: Array<[unknown, string]> = [
      [{ status: 400 }, "VALIDATION"],
      [{ status: 422 }, "VALIDATION"],
      [{ status: 401 }, "PERMISSION"],
      [{ status: 403 }, "PERMISSION"],
      [{ status: 404 }, "NOT_FOUND"],
      [{ status: 409 }, "BUSINESS_CONFLICT"],
      [{ status: 410 }, "EXPIRED_OFFER"],
      [{ status: 412 }, "STALE_VERSION"],
      [{ status: 428 }, "STALE_VERSION"],
    ];
    for (const [err, expected] of cases) {
      const cls = classifyError(err);
      expect(cls, JSON.stringify(err)).toBe(expected);
      expect(isTransient(cls), `${expected} must not be transient`).toBe(false);
    }
  });

  it("treats every business SQLSTATE from migration 0007 as a permanent business conflict", () => {
    for (const code of Object.keys(BUSINESS_SQLSTATE)) {
      const cls = classifyError({ code });
      expect(cls, `SQLSTATE ${code}`).toBe("BUSINESS_CONFLICT");
      expect(isTransient(cls)).toBe(false);
    }
  });

  it("treats an unknown error as PERMANENT (conservative: no infinite retry loop)", () => {
    expect(classifyError(new Error("irgendwas unerwartetes"))).toBe("UNKNOWN_PERMANENT");
    expect(isTransient("UNKNOWN_PERMANENT")).toBe(false);
  });

  it("keeps transient and permanent classes disjoint", () => {
    for (const t of TRANSIENT_ERROR_CLASSES) {
      expect(PERMANENT_ERROR_CLASSES).not.toContain(t as never);
    }
  });
});

describe("§9 exponential backoff with jitter and cap", () => {
  it("grows exponentially without jitter", () => {
    const opts = { jitterRatio: 0, baseMs: 1000, capMs: 60_000 };
    expect(computeBackoffMs(1, opts)).toBe(1000);
    expect(computeBackoffMs(2, opts)).toBe(2000);
    expect(computeBackoffMs(3, opts)).toBe(4000);
    expect(computeBackoffMs(4, opts)).toBe(8000);
  });

  it("never exceeds the cap, no matter how many attempts", () => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      expect(computeBackoffMs(attempt, { capMs: 5000 })).toBeLessThanOrEqual(5000);
      expect(computeBackoffMs(attempt, { capMs: 5000 })).toBeGreaterThanOrEqual(0);
    }
  });

  it("applies jitter within the configured ratio", () => {
    const low = computeBackoffMs(3, { baseMs: 1000, jitterRatio: 0.3, random: () => 0 });
    const high = computeBackoffMs(3, { baseMs: 1000, jitterRatio: 0.3, random: () => 1 });
    const mid = computeBackoffMs(3, { baseMs: 1000, jitterRatio: 0.3, random: () => 0.5 });
    expect(low).toBe(4000 - 1200);
    expect(high).toBe(4000 + 1200);
    expect(mid).toBe(4000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe("§9 retry decision", () => {
  it("retries a transient error with a delay until attempts are exhausted", () => {
    const first = decideRetry({ status: 503 }, 1, 3);
    expect(first.retry).toBe(true);
    expect(first.deadLetter).toBe(false);
    expect(first.delayMs).toBeGreaterThan(0);

    const exhausted = decideRetry({ status: 503 }, 3, 3);
    expect(exhausted.retry).toBe(false);
    expect(exhausted.deadLetter).toBe(true);
    expect(exhausted.reason).toContain("erschöpft");
  });

  it("sends a permanent error straight to the dead-letter queue without retrying", () => {
    for (const err of [{ status: 422 }, { status: 403 }, { status: 409 }, { status: 410 }, { status: 412 }, { code: "FS005" }]) {
      const decision = decideRetry(err, 1, 10);
      expect(decision.retry, JSON.stringify(err)).toBe(false);
      expect(decision.deadLetter).toBe(true);
      expect(decision.delayMs).toBe(0);
    }
  });

  it("honours an explicitly supplied errorClass", () => {
    const decision = decideRetry(Object.assign(new Error("x"), { errorClass: "TIMEOUT" as const }), 1, 5);
    expect(decision.errorClass).toBe("TIMEOUT");
    expect(decision.retry).toBe(true);
  });
});
