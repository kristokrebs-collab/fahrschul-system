/**
 * Fixture of "Frag dein Journal" (Paket F2, not a test file): a fixed journal of 12 closed trades whose every figure is easy to
 * recompute by hand – the expected values in `ask.test.ts` are written out from this table, not read from the code under test.
 *
 * Clock: Wed 2026-06-10 12:00 local ("letzten Monat" = May 2026, "dieses Jahr" = 2026). Risk is 100 per trade unless noted
 * (entry 100, stop 99, size = risk × 100 → R = P&L ÷ risk), so R = pnl / 100 (T0: risk 200). Setups: "Breakout" (checklist: Plan, Stopp),
 * "Fade" (no checklist). `✓` = checklist items ticked, `rev` = has a review (note / tags).
 *
 *   id  date (weekday)        setup     pnl   R      stop  ✓     rev
 *   T0  2025-12-15 (Mo)       Breakout  −500  −2,5   yes   0/2   no
 *   T1  2026-05-04 (Mo)       Breakout  +200  +2     yes   2/2   yes
 *   T2  2026-05-05 (Di)       Breakout  −100  −1     yes   1/2   no
 *   T3  2026-05-06 (Mi)       Breakout  −150  −1,5   yes   0/2   no
 *   T4  2026-05-12 (Di)       Fade       −80  −0,8   yes   –     yes (tag)
 *   T5  2026-05-13 (Mi)       Fade      +120  +1,2   yes   –     no
 *   T6  2026-05-20 (Mi)       Breakout   −60  −0,6   yes   2/2   yes
 *   T7  2026-05-27 (Mi)       Breakout  −300  –      NO    2/2   no
 *   T8  2026-05-28 (Do)       Fade       +50  –      NO    –     no
 *   T9  2026-06-02 (Di)       Breakout  +100  +1     yes   2/2   yes
 *   T10 2026-06-03 (Mi)       Fade       −40  −0,4   yes   –     no
 *   T11 2026-06-08 (Mo)       Breakout  +400  +4     yes   1/2   yes
 */
import { accountView } from "@/domain/account";
import { detectBehaviors } from "@/domain/coach/events";
import type { AnswerData } from "@/domain/coach/nlq";
import { enrichTrades } from "@/domain/enrich";
import type { EnrichedTrade, Settings, Trade } from "@/domain/types";
import { mkTrade } from "./domain.fixtures";
import { settingsWith } from "./insights.fixtures";

export const NOW = new Date(2026, 5, 10, 12).getTime();

export const ASK_SETTINGS: Settings = settingsWith({
  capital: { makro: 10_000, scalp: 10_000 },
  rules: [],
  setups: [
    { id: "s_bo", name: "Breakout", account: "both", color: "#fff", desc: "", checklist: [{ id: "c1", text: "Plan" }, { id: "c2", text: "Stopp" }] },
    { id: "s_fa", name: "Fade", account: "both", color: "#fff", desc: "", checklist: [] },
  ],
});

interface Row {
  id: string;
  date: string;
  setup: "s_bo" | "s_fa";
  pnl: number;
  risk?: number;
  stop?: boolean;
  ticks?: 0 | 1 | 2;
  review?: "note" | "tag";
}

const ROWS: Row[] = [
  { id: "T0", date: "2025-12-15T10:00", setup: "s_bo", pnl: -500, risk: 200, ticks: 0 },
  { id: "T1", date: "2026-05-04T10:00", setup: "s_bo", pnl: 200, ticks: 2, review: "note" },
  { id: "T2", date: "2026-05-05T10:00", setup: "s_bo", pnl: -100, ticks: 1 },
  { id: "T3", date: "2026-05-06T10:00", setup: "s_bo", pnl: -150, ticks: 0 },
  { id: "T4", date: "2026-05-12T10:00", setup: "s_fa", pnl: -80, review: "tag" },
  { id: "T5", date: "2026-05-13T10:00", setup: "s_fa", pnl: 120 },
  { id: "T6", date: "2026-05-20T10:00", setup: "s_bo", pnl: -60, ticks: 2, review: "note" },
  { id: "T7", date: "2026-05-27T10:00", setup: "s_bo", pnl: -300, stop: false, ticks: 2 },
  { id: "T8", date: "2026-05-28T10:00", setup: "s_fa", pnl: 50, stop: false },
  { id: "T9", date: "2026-06-02T10:00", setup: "s_bo", pnl: 100, ticks: 2, review: "note" },
  { id: "T10", date: "2026-06-03T10:00", setup: "s_fa", pnl: -40 },
  { id: "T11", date: "2026-06-08T10:00", setup: "s_bo", pnl: 400, ticks: 1, review: "note" },
];

export function askTrades(): Trade[] {
  return ROWS.map((r) => {
    const risk = r.risk ?? 100;
    const hasStop = r.stop !== false;
    const checks: Record<string, boolean> = {};
    if (r.setup === "s_bo") {
      if ((r.ticks ?? 0) >= 1) checks["s_bo:c1"] = true;
      if ((r.ticks ?? 0) >= 2) checks["s_bo:c2"] = true;
    }
    return mkTrade({
      id: r.id,
      date: r.date,
      exitDate: r.date.replace("T10:00", "T11:00"),
      setups: [r.setup],
      entry: 100,
      stop: hasStop ? 99 : null,
      size: hasStop ? risk * 100 : 10_000,
      pnlManual: r.pnl,
      checks,
      reason: "Plan",
      notes: r.review === "note" ? "gut ausgeführt" : "",
      tags: r.review === "tag" ? ["review"] : undefined,
    });
  });
}

export interface AskWorld {
  enriched: EnrichedTrade[];
  data: AnswerData;
}

/** The fixture journal as the question bar gets it (closed trades of the account view, behaviour events, clock pinned). */
export function askWorld(settings: Settings = ASK_SETTINGS, trades: Trade[] = askTrades()): AskWorld {
  const enriched = enrichTrades(trades, settings);
  const view = accountView(enriched, settings, "all", { now: () => NOW });
  const events = detectBehaviors({ trades: enriched, settings });
  return { enriched, data: { closed: view.closed, settings, events, now: NOW, currency: "USDT", start: view.start } };
}
