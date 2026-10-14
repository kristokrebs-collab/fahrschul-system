/** Info panel of `Ergebnis nach Signal-Stärke`: the ladder conditions plus the graded parts of v2 snapshots. */
import { describe, expect, it } from "vitest";
import { conditionEffects, explainSignal, strengthRows } from "@/domain/insights";
import { partEffects } from "@/views/insights/SignalStrengthCard";
import { closedOf, enrich, qt, theirSnap, utc } from "./insights.fixtures";

const traders = (ok: boolean, data = true) => ({
  id: "traders",
  grade: ok ? 1 : 0.25,
  points: ok ? 10 : 2.5,
  weight: 10,
  ok,
  data,
  state: "confirmed",
  met: ok ? 4 : 1,
  items: ["pos", "acc", "retail", "zone"].map((id, i) => ({ id, met: data ? ok || i === 2 : null, raw: data ? 1 : null })),
});
const v2 = (parts: unknown[]) => theirSnap("long", 2, { v: 2, state: "confirmed", parts });

describe("explainSignal", () => {
  const closed = closedOf(
    enrich([
      qt(utc(2026, 9, 1), { p: 100, signal: v2([traders(true)]) }),
      qt(utc(2026, 9, 2), { p: -50, signal: v2([traders(false)]) }),
      qt(utc(2026, 9, 3), { p: 30, signal: v2([traders(true)]) }),
      qt(utc(2026, 9, 4), { p: -40, signal: v2([traders(false, false)]) }),
      qt(utc(2026, 9, 5), { p: 20, signal: theirSnap("long", 1) }),
    ]),
  );
  const res = strengthRows(closed);
  const effects = conditionEffects(closed);

  it("without part effects: the ladder conditions only (as before)", () => {
    const e = explainSignal(res, effects);
    expect(e.rows).toHaveLength(1 + effects.length);
    expect(e.what).not.toContain("Teil-Bedingungen");
  });

  it("lists every part effect after the conditions: items indented, win-rate delta, no-data trades named", () => {
    const parts = partEffects(closed);
    expect(parts.map((p) => p.key)).toEqual(["traders", "traders-pos", "traders-acc", "traders-retail"]);
    const e = explainSignal(res, effects, parts);
    expect(e.rows).toHaveLength(1 + effects.length + parts.length);
    const rows = e.rows.slice(1 + effects.length);
    expect(rows[0]![0]).toBe("Top-Trader-Kombi erfüllt");
    // met: +100, +30 (2 wins) vs missed: −50 (0 wins) → +100 pp; one trade had no top-trader data
    expect(rows[0]![1]).toBe("+100 Prozentpunkte · 1 ohne Daten");
    expect(rows[1]![0]).toBe("· Top-Trader Positionen");
    // retail held on every trade with data → no "without" side
    expect(rows[3]![1]).toBe("– · 1 ohne Daten");
    expect(e.what).toContain("Kerzenschluss (vorläufig · bestätigt · stark bestätigt)");
    expect(e.what).toContain("Trades ohne Daten dafür zählen weder als erfüllt noch als offen");
  });
});
