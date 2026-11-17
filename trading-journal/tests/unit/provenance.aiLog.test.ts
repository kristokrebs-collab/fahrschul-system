/**
 * F24 KI-Protokoll (`settings.aiLog`): versioniertes Passthrough, nur Helfer · Modell · Zeit · übernommen (kein Text), höchstens
 * 100 Einträge, Merge je Eintrag; der Schreiber blockiert nie; die vier Helfer schreiben je eine Zeile – ohne Gesprächsinhalt.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/cloud";
import { AI_HELPERS, aiLogCfgOf, aiLogOfSettings, appendEntry, decideEntry, entryOf, MAX_AI_LOG, normalizeEntry, splitModel, summarizeAiLog, withAiLog, type AiLogEntry } from "@/domain/provenance";
import { merge3 } from "@/store/merge3";
import { clearAiLog, decideAi, recordAi } from "@/store/aiLog";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const e = (id: string, over: Partial<AiLogEntry> = {}): AiLogEntry => ({ id, helper: "assistant", model: "claude-opus-5-5", version: null, at: 1_000 + Number(id.replace(/\D/g, "") || 0), adopted: true, ...over });

describe("splitModel", () => {
  it("trennt eine Datumsversion ab, wo die Modell-Kennung eine trägt – sonst ist die Version unbekannt (null)", () => {
    expect(splitModel("claude-opus-4-1-20250805")).toEqual({ model: "claude-opus-4-1-20250805", version: "20250805" });
    expect(splitModel("claude-opus-5-5")).toEqual({ model: "claude-opus-5-5", version: null });
    expect(splitModel("  ")).toEqual({ model: null, version: null });
    expect(splitModel(undefined)).toEqual({ model: null, version: null });
    expect(splitModel("x".repeat(200)).model).toHaveLength(80);
  });
});

describe("Eintrag und Protokoll", () => {
  it("liest nachsichtig: unlesbare Einträge bleiben in `rejected`, doppelte Ids zählen einmal, die Reihenfolge ist die der Zeit", () => {
    const cfg = aiLogCfgOf({ v: 1, entries: [e("a2"), { id: "bad", helper: "magie", at: 5 }, e("a1"), e("a1", { adopted: false }), "kaputt"] });
    expect(cfg.entries.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(cfg.entries[0]!.adopted).toBe(true);
    expect(cfg.rejected).toHaveLength(2);
    expect(aiLogCfgOf(undefined).entries).toEqual([]);
    expect(aiLogCfgOf("x").entries).toEqual([]);
  });

  it("ein Eintrag hat nur Helfer, Modell, Version, Zeit, übernommen (und eine Id): ein mitgegebener Text kommt nicht hinein", () => {
    const entry = entryOf({ helper: "studio", model: "claude-opus-4-1-20250805", adopted: false, question: "Wie viel Gewinn?", answer: "Viel", text: "Strategie" } as never, "ai_1", 9_000);
    expect(Object.keys(entry).sort()).toEqual(["adopted", "at", "helper", "id", "model", "version"]);
    expect(entry).toMatchObject({ helper: "studio", model: "claude-opus-4-1-20250805", version: "20250805", at: 9_000, adopted: false });
    expect(entryOf({ helper: "optimizer", model: null, adopted: true, ref: "ev_1", at: 5 }, "ai_2", 9_000)).toEqual({ id: "ai_2", helper: "optimizer", model: null, version: null, at: 5, adopted: true, ref: "ev_1" });
  });

  it("unbekannte Schlüssel eines Eintrags überleben das Lesen (neuere Version)", () => {
    const x = normalizeEntry({ ...e("a1"), zukunft: { a: 1 } });
    expect((x as unknown as { zukunft: unknown }).zukunft).toEqual({ a: 1 });
  });

  it("hält höchstens 100 Einträge: die ältesten fallen heraus", () => {
    let list: AiLogEntry[] = [];
    for (let i = 1; i <= MAX_AI_LOG + 5; i++) list = appendEntry(list, { helper: "coach", adopted: true }, `id${i}`, 1_000 + i);
    expect(list).toHaveLength(MAX_AI_LOG);
    expect(list[0]!.id).toBe("id6");
    expect(aiLogCfgOf({ v: 1, entries: list }).entries).toHaveLength(MAX_AI_LOG);
  });

  it("withAiLog behält unbekannte Wurzelschlüssel und unlesbare Einträge und gibt dasselbe Objekt zurück, wenn sich nichts ändert", () => {
    const raw = { v: 1, entries: [e("a1"), { id: "x", helper: "neu", at: 1 }], zukunft: 7 };
    const same = withAiLog(raw, aiLogCfgOf(raw).entries);
    expect(same).toBe(raw);
    const next = withAiLog(raw, [...aiLogCfgOf(raw).entries, e("a3")]);
    expect(next.zukunft).toBe(7);
    expect((next.entries as unknown[]).length).toBe(3);
    expect((next.entries as { id: string }[]).some((x) => x.id === "x")).toBe(true);
  });

  it("decideEntry entscheidet nur einen offenen Eintrag", () => {
    const list = [e("a1", { adopted: null }), e("a2", { adopted: true })];
    expect(decideEntry(list, "a1", false).find((x) => x.id === "a1")!.adopted).toBe(false);
    expect(decideEntry(list, "a2", false).find((x) => x.id === "a2")!.adopted).toBe(true);
  });

  it("fasst je Helfer zusammen: Aufrufe, übernommen / abgelehnt / offen, Modelle (häufigste zuerst), letzter Zeitpunkt", () => {
    const rows = summarizeAiLog([e("a1"), e("a2", { adopted: false }), e("a3", { model: "claude-haiku-9", adopted: null }), e("a4", { helper: "optimizer", model: null, adopted: true })]);
    expect(rows.map((r) => r.helper)).toEqual(["assistant", "optimizer"]);
    const a = rows[0]!;
    expect(a).toMatchObject({ calls: 3, adopted: 1, notAdopted: 1, open: 1 });
    expect(a.models.map((m) => [m.model, m.n])).toEqual([["claude-opus-5-5", 2], ["claude-haiku-9", 1]]);
    expect(rows[1]!.models).toEqual([]);
    expect(AI_HELPERS.map((h) => h.id)).toEqual(["assistant", "studio", "coach", "optimizer"]);
  });

  it("der Cloud-Merge arbeitet je Eintrag: zwei Geräte, die beide etwas protokollieren, behalten beide", () => {
    const base = withAiLog(undefined, [e("a1")]);
    const mine = withAiLog(base, [e("a1"), e("a2")]);
    const theirs = withAiLog(base, [e("a1"), e("a3")]);
    const merged = aiLogOfSettings({ aiLog: merge3(base, mine, theirs) }).entries.map((x) => x.id);
    expect(merged.sort()).toEqual(["a1", "a2", "a3"]);
  });
});

describe("Schreiber (src/store/aiLog.ts)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("schreibt eine Zeile in settings.aiLog und lässt alle anderen Einstellungen unberührt", async () => {
    const before = useJournal.getState().settings;
    const id = await recordAi({ helper: "coach", model: "claude-opus-5-5", adopted: true }, 5_000);
    expect(id).toMatch(/^ai_/);
    const s = useJournal.getState().settings;
    expect(aiLogOfSettings(s).entries).toEqual([{ id, helper: "coach", model: "claude-opus-5-5", version: null, at: 5_000, adopted: true }]);
    expect({ ...s, aiLog: undefined }).toEqual({ ...before, aiLog: undefined });
  });

  it("decideAi setzt einen offenen Eintrag; clearAiLog leert; beides ohne Wirkung, wo nichts zu tun ist", async () => {
    const id = (await recordAi({ helper: "optimizer", adopted: null }))!;
    expect(await decideAi(id, true)).toBe(true);
    expect(aiLogOfSettings(useJournal.getState().settings).entries[0]!.adopted).toBe(true);
    const spy = vi.spyOn(useJournal.getState(), "saveSettings");
    expect(await decideAi(id, false)).toBe(true);
    expect(aiLogOfSettings(useJournal.getState().settings).entries[0]!.adopted).toBe(true);
    expect(await clearAiLog()).toBe(true);
    expect(aiLogOfSettings(useJournal.getState().settings).entries).toEqual([]);
    spy.mockRestore();
    const calls = vi.fn(async () => undefined);
    useJournal.setState({ saveSettings: calls });
    expect(await clearAiLog()).toBe(true);
    expect(calls).not.toHaveBeenCalled();
  });

  it("wirft nie und blockiert den Helfer nicht: ein Speicherfehler ist eine fehlende Zeile", async () => {
    useJournal.setState({ saveSettings: vi.fn(async () => Promise.reject(new Error("voll"))) });
    await expect(recordAi({ helper: "assistant", adopted: true })).resolves.toBeNull();
  });

  it("schreibt nichts, solange das Journal nicht geladen ist", async () => {
    const save = vi.fn(async () => undefined);
    useJournal.setState({ loaded: false, saveSettings: save });
    expect(await recordAi({ helper: "assistant", adopted: true })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("die Helfer protokollieren, ohne Inhalt", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    vi.resetModules();
    await bootFixtureJournal();
  });

  it("Assistent: übernommen, wenn eine vorgeschlagene Frage die lokale Prüfung besteht", async () => {
    const fetchSpy = vi.fn(async () => ({ questions: ["Wie ist meine Win-Rate?", "xyzzy plugh"], clarify: null, model: "claude-opus-5-5" }));
    vi.doMock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), apiFetch: fetchSpy }));
    const { routeViaServer } = await import("@/assistant/route");
    const { useJournal: J } = await import("@/store/journalStore");
    await routeViaServer("meine quote", { history: [], page: "overview", setups: [], assets: [] }, { parse: { setups: [], assets: ["BTC"], now: Date.UTC(2026, 9, 26, 12) }, closed: 10 });
    await vi.waitFor(() => expect(aiLogOfSettings(J.getState().settings).entries).toHaveLength(1));
    const entry = aiLogOfSettings(J.getState().settings).entries[0]!;
    expect(entry).toMatchObject({ helper: "assistant", model: "claude-opus-5-5" });
    expect(typeof entry.adopted).toBe("boolean");
    expect(JSON.stringify(J.getState().settings.aiLog)).not.toMatch(/Win-Rate|meine quote|xyzzy/);
    vi.doUnmock("@/cloud");
  });

  it("Coach: Modell und „gezeigt oder nicht“, nie die Frage oder die Antwort", async () => {
    const fetchSpy = vi.fn(async () => ({ text: "Eine geheime Umformulierung", model: "claude-opus-5-5" }));
    vi.doMock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), apiFetch: fetchSpy }));
    const { rephraseAnswer } = await import("@/views/coach/ask");
    const { useJournal: J } = await import("@/store/journalStore");
    await rephraseAnswer("Warum verliere ich?", { title: "Titel", text: "Text", facts: [], confidence: { label: "dünn", n: 3 } } as never);
    await vi.waitFor(() => expect(aiLogOfSettings(J.getState().settings).entries).toHaveLength(1));
    expect(aiLogOfSettings(J.getState().settings).entries[0]).toMatchObject({ helper: "coach", model: "claude-opus-5-5", adopted: true });
    expect(JSON.stringify(J.getState().settings.aiLog)).not.toMatch(/geheime|Warum verliere|Titel/);
    vi.doUnmock("@/cloud");
  });

  it("Strategie-Übersetzer: eine abgelehnte Lesart ist ein Eintrag mit übernommen = false; ohne Antwort des Servers gibt es keinen", async () => {
    const fetchSpy = vi.fn(async () => ({ result: null, model: "claude-opus-5-5", reason: "refusal" }));
    vi.doMock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), apiFetch: fetchSpy }));
    const { compileViaServer } = await import("@/views/studio/aiClient");
    const { useJournal: J } = await import("@/store/journalStore");
    const out = await compileViaServer("Long wenn der RSI unter 30 fällt");
    expect(out.ok).toBe(false);
    await vi.waitFor(() => expect(aiLogOfSettings(J.getState().settings).entries).toHaveLength(1));
    expect(aiLogOfSettings(J.getState().settings).entries[0]).toMatchObject({ helper: "studio", adopted: false });
    expect(JSON.stringify(J.getState().settings.aiLog)).not.toContain("RSI");
    // der Server antwortet gar nicht: kein Modell, keine Zeile
    fetchSpy.mockImplementationOnce(async () => {
      throw new ApiError(503, "nicht erreichbar", "down");
    });
    const down = await compileViaServer("noch einer");
    expect(down.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(aiLogOfSettings(J.getState().settings).entries).toHaveLength(1);
    vi.doUnmock("@/cloud");
  });
});
