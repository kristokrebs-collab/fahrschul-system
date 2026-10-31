/**
 * Strategie-Studio · the optional server reading from the page's side: the answer of `strategy-compile` is re-validated before it
 * becomes a reading (a refusal, an invalid or an ungrounded answer is dropped with the reason and the local reading stays), the
 * reading is marked as the AI's, and a text that changed while the server worked is never overwritten by its answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leavesOf } from "@/domain/lab";
import { parseStrategyText, type AiOutput } from "@/domain/strategytext";

const apiFetch = vi.fn();
vi.mock("@/cloud", async (orig) => ({ ...(await orig<typeof import("@/cloud")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { compileViaServer, tooLongForAi, resetCompileStatusForTests, compileServerEnabled } = await import("@/views/studio/aiClient");
const { useStudio, __resetStudio } = await import("@/views/studio/studioStore");

const text = "Long wenn der RSI unter 30 fällt und der Kurs über der EMA 200 liegt, Stop 1,5 ATR";
const local = parseStrategyText(text);
const [l1, l2] = leavesOf(local.rules.long);
const good = (): AiOutput => ({
  rules: JSON.parse(JSON.stringify(local.rules)) as AiOutput["rules"],
  setup: { symbol: null, period: null, riskPct: null },
  understood: [
    { phrase: "RSI unter 30 fällt", ref: l1!.id },
    { phrase: "Kurs über der EMA 200 liegt", ref: l2!.id },
    { phrase: "Stop 1,5 ATR", ref: "stop" },
  ],
  unclear: [],
  questions: ["Ist die EMA 200 auf dem Tageschart gemeint?"],
  assumptions: [],
});

beforeEach(() => {
  apiFetch.mockReset();
  resetCompileStatusForTests();
  __resetStudio();
});

describe("compileViaServer", () => {
  it("a valid answer becomes a reading marked as the AI's, with the lab's own meanings", async () => {
    apiFetch.mockResolvedValue({ result: good(), model: "m" });
    const out = await compileViaServer(text);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.parse.source).toBe("ai");
    expect(out.parse.understood.map((u) => u.meaning)).toEqual(["RSI(14) kreuzt nach unten 30", "Schluss über EMA 200", "Stop: 1,5 × ATR(14)"]);
    expect(apiFetch).toHaveBeenCalledWith("/strategy/compile", { method: "POST", body: { text } });
  });

  it("drops a refused, an empty, an invalid and an ungrounded answer – each with its reason", async () => {
    apiFetch.mockResolvedValueOnce({ result: null, model: "m", reason: "refusal" });
    expect(await compileViaServer(text)).toEqual({ ok: false, message: expect.stringContaining("abgelehnt") });
    apiFetch.mockResolvedValueOnce({ result: null, model: "m", reason: "empty" });
    expect(await compileViaServer(text)).toEqual({ ok: false, message: expect.stringContaining("keine Regeln") });
    const bad = good();
    leavesOf(bad.rules.long)[0]!.params.level = 500;
    apiFetch.mockResolvedValueOnce({ result: bad, model: "m" });
    const invalid = await compileViaServer(text);
    expect(invalid.ok).toBe(false);
    const invented = good();
    invented.understood.push({ phrase: "Volumen über dem Doppelten", ref: l1!.id });
    apiFetch.mockResolvedValueOnce({ result: invented, model: "m" });
    const ungrounded = await compileViaServer(text);
    expect(ungrounded).toEqual({ ok: false, message: expect.stringContaining("steht nicht im Text") });
  });

  it("a failing request says so and keeps the local reading", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    const out = await compileViaServer(text);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("nicht verfügbar");
  });

  it("asks the server's status once per session and reads any failure as off", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    expect(await compileServerEnabled()).toBe(false);
    expect(await compileServerEnabled()).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("the text limit of the server is known to the page", () => {
    expect(tooLongForAi("x".repeat(1500))).toBe(false);
    expect(tooLongForAi("x".repeat(1501))).toBe(true);
  });
});

describe("studio store with the AI reading", () => {
  it("adopts the AI reading for the text it was asked about", async () => {
    apiFetch.mockResolvedValue({ result: good(), model: "m" });
    useStudio.setState((s) => ({ editor: { ...s.editor, text } }));
    await useStudio.getState().understandWithAi();
    const s = useStudio.getState();
    expect(s.parsed?.source).toBe("ai");
    expect(s.ai).toEqual({ busy: false, message: null });
    expect(s.editor.answers).toEqual({});
  });

  it("never lets an answer overwrite a text that changed meanwhile", async () => {
    let release: (v: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise((r) => (release = r)));
    useStudio.setState((s) => ({ editor: { ...s.editor, text } }));
    const run = useStudio.getState().understandWithAi();
    expect(useStudio.getState().ai.busy).toBe(true);
    useStudio.setState((s) => ({ editor: { ...s.editor, text: `${text}, nicht am Freitag` } }));
    release({ result: good(), model: "m" });
    await run;
    expect(useStudio.getState().parsed).toBeNull();
    expect(useStudio.getState().ai.busy).toBe(false);
  });

  it("a dropped answer shows its reason and leaves the reading alone", async () => {
    apiFetch.mockResolvedValue({ result: null, model: "m", reason: "refusal" });
    useStudio.setState((s) => ({ editor: { ...s.editor, text } }));
    useStudio.getState().understand();
    const before = useStudio.getState().parsed;
    await useStudio.getState().understandWithAi();
    expect(useStudio.getState().parsed).toBe(before);
    expect(useStudio.getState().ai.message).toContain("verworfen");
  });
});
