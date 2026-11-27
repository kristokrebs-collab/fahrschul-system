/**
 * Strategie-Studio · which rules does a strategy mean right now, and can they run: the saved version when it says the same and its
 * rules differ from the local reading (an AI reading stays what it was); otherwise the fresh local reading – whose open question
 * a saved version does not remember.
 */
import { describe, expect, it } from "vitest";
import { leavesOf, sanitizeCustom } from "@/domain/lab";
import { newStrategy, parseStrategyText, saveVersion } from "@/domain/strategytext";
import { resolveEditor, resolveStored, resolveText, whyNotReady } from "@/views/studio/resolve";

const OK = "Long, wenn der RSI unter 30 liegt, Stop 1,5 ATR, Ziel 2R";
const OPEN = "Wenn der RSI unter 30 fällt";

const withVersion = (text: string, config = parseStrategyText(text).rules, answers: Record<string, string> = {}) => {
  const p = parseStrategyText(text, { answers });
  return saveVersion(newStrategy({ id: "s_1", text, answers }, 1), { text, answers, setup: p.setup, config }, 2, "x");
};

describe("resolve", () => {
  it("a text without a version is read locally and says whether it can run", () => {
    const r = resolveText(OK, {}, []);
    expect(r).toMatchObject({ ready: true, why: null, versionNo: null, source: "local" });
    expect(leavesOf(r.config.long)).toHaveLength(1);
  });

  it("a missing direction is an open question that blocks – also after the text was saved as a version", () => {
    const fresh = resolveText(OPEN, {}, []);
    expect(fresh.ready).toBe(false);
    expect(fresh.why).toContain("Offene Frage");
    const saved = resolveStored(withVersion(OPEN));
    expect(saved.ready).toBe(false);
    expect(saved.versionNo).toBe(1);
    // the chip answers it
    const answered = resolveStored(withVersion(OPEN, undefined, { side: "long" }));
    expect(answered).toMatchObject({ ready: true, versionNo: 1 });
  });

  it("saved rules that differ from the local reading stay what they were (an AI reading), marked as such", () => {
    const local = parseStrategyText(OK).rules;
    const other = sanitizeCustom({ ...local, target: { kind: "r", r: 3 } });
    const s = withVersion(OK, other);
    const r = resolveStored(s);
    expect(r.config.target).toMatchObject({ r: 3 });
    expect(r).toMatchObject({ source: "ai", versionNo: 1, ready: true });
  });

  it("a changed text is read afresh and is no version any more", () => {
    const s = withVersion(OK);
    const r = resolveText(`${OK}, nicht am Freitag`, {}, s.versions);
    expect(r.versionNo).toBeNull();
    expect(leavesOf(r.config.long)).toHaveLength(2);
  });

  it("the editor's own fresh reading wins, and it is only labelled 'vN' when it IS that version's rules", () => {
    const s = withVersion(OK);
    const parsed = parseStrategyText(OK);
    expect(resolveEditor({ text: OK, answers: {} }, parsed, s.versions).versionNo).toBe(1);
    const stale = resolveEditor({ text: `${OK}, nicht am Freitag`, answers: {} }, parsed, s.versions);
    expect(stale.versionNo).toBeNull();
    expect(leavesOf(stale.config.long)).toHaveLength(2);
    // rules changed by a proposal after the reading: not the saved version any more
    const changed = { ...parsed, rules: sanitizeCustom({ ...parsed.rules, target: { kind: "r" as const, r: 4 } }) };
    expect(resolveEditor({ text: OK, answers: {} }, changed, s.versions).versionNo).toBeNull();
  });

  it("names why rules cannot run: an open question, a lab error, no rule at all", () => {
    expect(whyNotReady(parseStrategyText(OPEN).rules, parseStrategyText(OPEN))).toContain("Offene Frage");
    expect(whyNotReady(parseStrategyText("Das Wetter ist schön").rules)).toBeTruthy();
    expect(whyNotReady(parseStrategyText(OK).rules, parseStrategyText(OK))).toBeNull();
  });
});
