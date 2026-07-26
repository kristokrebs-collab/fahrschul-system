import { SYNC_STATES } from "@fahrschul/domain";
import { describe, expect, it } from "vitest";
import {
  describeDataAge,
  formatAge,
  readCacheEntry,
  writeCacheEntry,
} from "../cache.js";
import {
  OUTCOME_UNKNOWN_LABEL,
  SYNC_STATE_LABEL,
  syncStateLabel,
  syncStateSeverity,
} from "../labels.js";
import { assertOfflineAllowed, classifyMutation, OfflineNotAllowedError } from "../mutations.js";
import {
  CLIENT_MAX_ATTEMPTS,
  needsHumanDecision,
  parseRetryAfterMs,
  planClientRetry,
} from "../retry-client.js";
import { memoryKeyValueStore } from "../store.js";

describe("§7 die neun Client-Synchronisationszustände", () => {
  it("sind zeichengenau die neun aus der Spezifikation – in dieser Reihenfolge", () => {
    expect([...SYNC_STATES]).toEqual([
      "synced",
      "local_draft",
      "queued",
      "syncing",
      "retrying",
      "conflict",
      "failed",
      "offline",
      "stale",
    ]);
  });

  it("jeder Zustand hat eine sichtbare Beschriftung (ein Zustand ohne Anzeige ist keiner)", () => {
    for (const state of SYNC_STATES) {
      expect(SYNC_STATE_LABEL[state]).toBeTruthy();
      expect(syncStateLabel(state)).toBe(SYNC_STATE_LABEL[state]);
    }
  });

  it('unbekannter Ausgang zeigt "Status wird geprüft" – NIE Erfolg, NIE Fehler', () => {
    for (const state of SYNC_STATES) {
      expect(syncStateLabel(state, { outcomeUnknown: true })).toBe("Status wird geprüft");
      expect(syncStateLabel(state, { outcomeUnknown: true })).toBe(OUTCOME_UNKNOWN_LABEL);
      expect(syncStateSeverity(state, { outcomeUnknown: true })).toBe("warn");
    }
    // Gegenprobe: keine Beschriftung behauptet Erfolg, wenn der Ausgang offen ist.
    expect(syncStateLabel("synced", { outcomeUnknown: true })).not.toBe(SYNC_STATE_LABEL.synced);
  });

  it('"syncing" behauptet keinen Erfolg', () => {
    expect(SYNC_STATE_LABEL.syncing).toBe("Wird übertragen");
    expect(SYNC_STATE_LABEL.syncing.toLowerCase()).not.toContain("gespeichert");
    expect(syncStateSeverity("syncing")).not.toBe("ok");
  });
});

describe("§9 Clientseite: Wiederverwendung der Politik aus packages/events", () => {
  it("wiederholt transiente Fehler automatisch", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      const plan = planClientRetry({ status }, 1);
      expect(plan.retry, `HTTP ${status} sollte wiederholbar sein`).toBe(true);
      expect(plan.delayMs).toBeGreaterThan(0);
    }
    // Netzwerkabbruch (keine Antwort) ebenfalls.
    const netz = planClientRetry({ message: "network", outcomeUnknown: true }, 1);
    expect(netz.retry).toBe(true);
    expect(netz.outcomeUnknown).toBe(true);
  });

  it("wiederholt NIEMALS Validierung, Berechtigung, Konflikt, Ablauf, veraltete Version", () => {
    const faelle: Array<[number, string]> = [
      [400, "VALIDATION"],
      [422, "VALIDATION"],
      [401, "PERMISSION"],
      [403, "PERMISSION"],
      [409, "BUSINESS_CONFLICT"],
      [410, "EXPIRED_OFFER"],
      [412, "STALE_VERSION"],
      [428, "STALE_VERSION"],
    ];
    for (const [status, klasse] of faelle) {
      const plan = planClientRetry({ status }, 1);
      expect(plan.errorClass, `HTTP ${status}`).toBe(klasse);
      expect(plan.retry, `HTTP ${status} darf nicht automatisch wiederholt werden`).toBe(false);
      expect(plan.exhausted, `HTTP ${status} ist dauerhaft, nicht erschöpft`).toBe(false);
    }
  });

  it("eine mehrdeutige Zahlungszuordnung (409) wird nicht wiederholt, sondern zur Entscheidung gestellt", () => {
    const plan = planClientRetry({ status: 409, body: { error: "ambiguous_bank_match" } }, 1);
    expect(plan.retry).toBe(false);
    expect(needsHumanDecision(plan.errorClass)).toBe(true);
  });

  it("Backoff ist exponentiell mit Jitter und Obergrenze", () => {
    const deterministisch = { random: () => 0.5, baseMs: 1000, capMs: 60_000, jitterRatio: 0.3 };
    const a1 = planClientRetry({ status: 503 }, 1, { backoff: deterministisch }).delayMs;
    const a2 = planClientRetry({ status: 503 }, 2, { backoff: deterministisch }).delayMs;
    const a3 = planClientRetry({ status: 503 }, 3, { backoff: deterministisch }).delayMs;
    expect(a1).toBe(1000);
    expect(a2).toBe(2000);
    expect(a3).toBe(4000);
    // Obergrenze greift (hoher maxAttempts, damit nicht schon die Erschöpfung greift).
    expect(
      planClientRetry({ status: 503 }, 20, { backoff: deterministisch, maxAttempts: 50 }).delayMs,
    ).toBe(60_000);
  });

  it("Retry-After hat Vorrang vor dem eigenen Backoff (Sekunden UND HTTP-Datum)", () => {
    const now = Date.parse("2026-07-26T10:00:00.000Z");
    const sekunden = planClientRetry({ status: 429, retryAfter: "120" }, 1, { now });
    expect(sekunden.delayMs).toBe(120_000);
    expect(sekunden.respectedRetryAfter).toBe(true);

    const datum = planClientRetry(
      { status: 503, retryAfter: "Sun, 26 Jul 2026 10:00:30 GMT" },
      1,
      { now },
    );
    expect(datum.delayMs).toBe(30_000);
    expect(datum.respectedRetryAfter).toBe(true);

    // Kaputter Header führt NICHT zu einem absurden Wartewert.
    expect(parseRetryAfterMs("bald", now)).toBeNull();
    expect(planClientRetry({ status: 429, retryAfter: "bald" }, 1, { now }).respectedRetryAfter).toBe(
      false,
    );
  });

  it("nach Erschöpfung wird nicht still verworfen, sondern als erschöpft gemeldet", () => {
    const plan = planClientRetry({ status: 503 }, CLIENT_MAX_ATTEMPTS, {
      maxAttempts: CLIENT_MAX_ATTEMPTS,
    });
    expect(plan.retry).toBe(false);
    expect(plan.exhausted).toBe(true);
    expect(plan.deadLetter).toBe(true);
    expect(plan.reason).toContain("erschöpft");
  });
});

describe("§8 Vertrag: was offline erlaubt ist", () => {
  it("die vier erlaubten Entwürfe sind offline möglich", () => {
    const erlaubt: Array<[string, string]> = [
      ["PATCH", "/availability/8f3a1c2d-0000-4000-8000-000000000001"],
      ["POST", "/instructor/voice-logs"],
      ["POST", "/instructor/vehicle-issues"],
      ["PATCH", "/feedback/8f3a1c2d-0000-4000-8000-000000000002/self-assessment"],
    ];
    for (const [method, path] of erlaubt) {
      expect(classifyMutation(method, path).offlineDraftKind).not.toBeNull();
      expect(() => assertOfflineAllowed(method, path, false)).not.toThrow();
    }
  });

  it("Terminbuchung/Storno, Prüfung-Go, Zahlung/Rechnung, Fahrzeugsperre und Dokumentprüfung sind offline VERBOTEN", () => {
    const id = "8f3a1c2d-0000-4000-8000-000000000003";
    const verboten: Array<[string, string, string]> = [
      ["POST", "/appointments", "termin_buchung"],
      ["POST", `/appointment-offers/${id}/accept`, "termin_buchung"],
      ["POST", `/appointments/${id}/cancel`, "termin_storno"],
      ["POST", `/appointment-offers/${id}/decline`, "termin_storno"],
      ["POST", `/pruefungen/${id}/transition`, "pruefung_go"],
      ["POST", `/finance/bank/${id}/resolve`, "zahlung"],
      ["POST", "/invoices", "rechnung"],
      ["PATCH", `/invoices/${id}`, "rechnung"],
      ["POST", `/resources/fahrzeuge/${id}/block`, "fahrzeug_blockierung"],
      ["POST", `/documents/${id}/review`, "dokument_verifizierung"],
    ];
    for (const [method, path, label] of verboten) {
      const klasse = classifyMutation(method, path);
      expect(klasse.offlineForbidden, `${method} ${path}`).toBe(label);
      expect(klasse.kritisch).toBe(true);
      expect(() => assertOfflineAllowed(method, path, false)).toThrow(OfflineNotAllowedError);
      // Online ist derselbe Vorgang erlaubt.
      expect(() => assertOfflineAllowed(method, path, true)).not.toThrow();
    }
  });

  it("ein unbekannter Endpunkt ist offline standardmäßig GESPERRT (fail closed)", () => {
    expect(() => assertOfflineAllowed("POST", "/etwas/ganz/neues", false)).toThrow(
      OfflineNotAllowedError,
    );
  });

  it("die zehn §2-Operationen sind über method+path auflösbar", () => {
    const id = "8f3a1c2d-0000-4000-8000-000000000004";
    const erwartet: Array<[string, string, string]> = [
      ["POST", `/appointment-offers/${id}/accept`, "appointment-offers.accept"],
      ["POST", "/appointments", "appointments.create"],
      ["POST", `/appointments/${id}/cancel`, "appointments.cancel"],
      ["POST", `/instructor/lessons/${id}/complete`, "instructor.lessons.complete"],
      ["POST", "/invoices", "invoices.create"],
      ["POST", `/finance/bank/${id}/resolve`, "finance.bank.resolve"],
      ["POST", "/documents", "documents.submit"],
      ["POST", `/pruefungen/${id}/transition`, "pruefungen.transition"],
      ["POST", `/resources/fahrzeuge/${id}/block`, "resources.fahrzeuge.block"],
      ["POST", "/communication/send", "communication.send"],
    ];
    for (const [method, path, operation] of erwartet) {
      expect(classifyMutation(method, path).operation, `${method} ${path}`).toBe(operation);
    }
  });
});

describe("§1 Anzeigehälfte: Datenalter, Version, Quelle", () => {
  it("ein Cache-Eintrag trägt Zeitstempel, Version und Quelle", () => {
    const store = memoryKeyValueStore();
    const jetzt = new Date("2026-07-26T10:00:00.000Z");
    const geschrieben = writeCacheEntry(store, "/me/termine", { a: 1 }, { version: 'W/"7"', now: jetzt });
    expect(geschrieben.fetchedAt).toBe("2026-07-26T10:00:00.000Z");
    expect(geschrieben.version).toBe('W/"7"');
    expect(geschrieben.source).toBe("server");

    const gelesen = readCacheEntry<{ a: number }>(store, "/me/termine");
    // Aus dem Cache gelesen heißt IMMER source "cache" – niemals als frisch
    // ausgeben, sonst ist die Kopie von Wahrheit nicht unterscheidbar.
    expect(gelesen?.source).toBe("cache");
    expect(gelesen?.data.a).toBe(1);
    expect(gelesen?.version).toBe('W/"7"');
  });

  it("Datenalter wird gerechnet und ab der Schwelle als stale gemeldet", () => {
    const fetchedAt = "2026-07-26T10:00:00.000Z";
    const frisch = describeDataAge(fetchedAt, { now: new Date("2026-07-26T10:00:20.000Z") });
    expect(frisch?.stale).toBe(false);
    expect(frisch?.label).toBe("vor 20 Sek.");

    const alt = describeDataAge(fetchedAt, { now: new Date("2026-07-26T10:06:00.000Z") });
    expect(alt?.stale).toBe(true);
    expect(alt?.label).toBe("vor 6 Min.");

    expect(describeDataAge(null)).toBeNull();
    expect(describeDataAge("kein datum")).toBeNull();
  });

  it("Altersbeschriftungen sind über alle Größenordnungen sinnvoll", () => {
    expect(formatAge(1000)).toBe("gerade jetzt");
    expect(formatAge(45_000)).toBe("vor 45 Sek.");
    expect(formatAge(3 * 60_000)).toBe("vor 3 Min.");
    expect(formatAge(5 * 3_600_000)).toBe("vor 5 Std.");
    expect(formatAge(24 * 3_600_000)).toBe("vor 1 Tag");
    expect(formatAge(3 * 24 * 3_600_000)).toBe("vor 3 Tagen");
  });
});
