/**
 * F29: the trader is told the REASON. `extractError` turns whatever came back from the function (or the platform in
 * front of it) into one German sentence that names it; `shotExtractServerEnabled` tells „no key“ from „server did not
 * answer“ (the settings card must not claim a missing key it never saw) and asks again after a failed answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/cloud";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), apiFetch }));

import { resetShotExtractStatusForTests, shotExtractServerEnabled, SHOT_EXTRACT_STATE_TEXT } from "@/journal/extract/availability";
import { extractError, ExtractError } from "@/journal/extract/client";

beforeEach(() => {
  apiFetch.mockReset();
  resetShotExtractStatusForTests();
});

describe("extractError – Grund statt Pauschalsatz", () => {
  const api = (status: number, code: string, message = "Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.") => extractError(new ApiError(status, code, message));

  it("kein KI-Schlüssel / Schlüssel abgelehnt / Modell / Zeitlimit: die Meldung des Servers kommt unverändert an, mit Code", () => {
    const cases: [number, string, string][] = [
      [503, "shot_extract_unavailable", "Der KI-Dienst ist auf dem Server nicht eingerichtet: Es ist kein KI-Schlüssel hinterlegt."],
      [503, "shot_extract_key_rejected", "Der KI-Schlüssel auf dem Server wurde abgelehnt."],
      [502, "shot_extract_model", "Das eingestellte KI-Modell „x“ gibt es nicht."],
      [504, "shot_extract_timeout", "Die KI hat nicht innerhalb von 25 Sekunden geantwortet."],
      [502, "shot_extract_invalid", "Die KI-Antwort passte nicht zum erwarteten Format (Feld: trades.0.status)."],
    ];
    for (const [status, code, message] of cases) {
      const e = api(status, code, message);
      expect(e).toBeInstanceOf(ExtractError);
      expect(e.message).toBe(message);
      expect(e.detail).toBe(code);
    }
  });

  it("die Plattform antwortet statt der Funktion: 404, 5xx und Offline sagen, was los ist", () => {
    expect(api(404, "http_404").message).toMatch(/nicht bereitgestellt \(HTTP 404\)/);
    expect(api(504, "http_504").message).toMatch(/nicht \(rechtzeitig\) geantwortet \(HTTP 504\).*Zeitlimit/);
    expect(api(502, "http_502").detail).toBe("http_502");
    const off = extractError(new ApiError(0, "unavailable", "Die Server-Funktionen sind auf dieser Seite nicht eingerichtet."));
    expect(off.code).toBe("offline");
    expect(off.message).toMatch(/^Die Server-Funktionen sind auf dieser Seite nicht eingerichtet\. Du kannst/);
  });

  it("Login, Tarif, Limit, Größe", () => {
    expect(api(401, "unauthorized").message).toMatch(/melde dich an/);
    expect(api(402, "limit_reached").message).toMatch(/Tageslimit/);
    expect(api(402, "plan_required").message).toMatch(/nicht zu deinem Tarif/);
    expect(api(413, "payload_too_large").code).toBe("size");
  });

  it("alles andere bleibt eine lesbare Meldung", () => {
    expect(extractError(new Error("boom")).message).toMatch(/Das Auslesen hat nicht geklappt/);
    expect(extractError(new DOMException("x", "AbortError")).code).toBe("gone");
  });
});

describe("Verfügbarkeit des Servers", () => {
  it("Schlüssel da / Schlüssel fehlt", async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true });
    await expect(shotExtractServerEnabled()).resolves.toBe(true);
    resetShotExtractStatusForTests();
    apiFetch.mockResolvedValueOnce({ enabled: false });
    await expect(shotExtractServerEnabled()).resolves.toBe(false);
  });

  it("ein Server, der nicht antwortet, ist „unbekannt“ (null) – nicht „kein Schlüssel“ – und wird später erneut gefragt", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(0, "unavailable", "x"));
    await expect(shotExtractServerEnabled()).resolves.toBeNull();
    await Promise.resolve();
    apiFetch.mockResolvedValueOnce({ enabled: true });
    await expect(shotExtractServerEnabled()).resolves.toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    // a real answer is asked once per session
    await shotExtractServerEnabled();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("die Einstellungen-Karte nennt jeden Zustand ehrlich", () => {
    expect(SHOT_EXTRACT_STATE_TEXT["server-off"]).toMatch(/kein KI-Schlüssel hinterlegt.*ANTHROPIC_API_KEY.*Netlify/);
    expect(SHOT_EXTRACT_STATE_TEXT["server-error"]).toMatch(/nicht geantwortet.*nicht geprüft/);
    expect(SHOT_EXTRACT_STATE_TEXT.ready).toMatch(/Ob Anthropic den Schlüssel annimmt, zeigt sich erst beim Auslesen/);
    expect(SHOT_EXTRACT_STATE_TEXT.plan).toMatch(/Tarif/);
    expect(SHOT_EXTRACT_STATE_TEXT["signed-out"]).toMatch(/Melde dich an/);
  });
});
