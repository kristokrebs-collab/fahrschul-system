/**
 * Fixture journal for the P03 analytics tests (not a test file): a deterministic set of closed trades built with the
 * Auswertung's `qt` / `utc` helpers – two setups with a clearly different edge, both sides, several sessions and
 * weekdays, stops on most trades (R), a few Journal-v3 fields (exit time, ATR, excursions, tags, exchange, origin).
 */
import type { Trade } from "@/domain/types";
import { accountView } from "@/domain/account";
import { qt, settingsWith, enrich, utc } from "./insights.fixtures";

export const NOW = Date.UTC(2026, 5, 30, 12);
export const SETTINGS = settingsWith({
  capital: { makro: 10_000, scalp: 10_000 },
  setups: [
    { id: "s_good", name: "Breakout", account: "both", color: "#fff", desc: "", checklist: [] },
    { id: "s_bad", name: "Fade", account: "both", color: "#fff", desc: "", checklist: [] },
  ],
});

/** 60 trades over ~4 months: `s_good` wins ~70 % at +2R / −1R, `s_bad` wins ~30 %. */
export function fixtureTrades(): Trade[] {
  const out: Trade[] = [];
  for (let i = 0; i < 60; i++) {
    const good = i % 2 === 0;
    const day = 1 + Math.floor(i * 2);
    const month = 2 + Math.floor((day - 1) / 28);
    const dom = ((day - 1) % 28) + 1;
    const hour = [3, 9, 15, 22][i % 4]!;
    const winSeq = good ? [1, 1, 0, 1, 1, 1, 0, 1, 0, 1] : [0, 1, 0, 0, 1, 0, 0, 0, 1, 0];
    const win = winSeq[Math.floor(i / 2) % 10] === 1;
    const risk = 100;
    const p = win ? (good ? 200 + (i % 3) * 20 : 120) : -100 - (i % 2) * 10;
    const date = utc(2026, month, dom, hour);
    out.push(
      qt(date, {
        id: `a${i}`,
        p,
        risk,
        setups: [good ? "s_good" : "s_bad"],
        side: i % 3 === 0 ? "short" : "long",
        account: i % 5 === 0 ? "makro" : "scalp",
        leverage: [2, 5, 10][i % 3]!,
        conviction: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        emotion: win ? "Ruhig" : "FOMO",
        ...(i % 4 === 0 ? { exitDate: utc(2026, month, dom, hour + 1), atrPct: 1.5, tags: ["plan"], exchange: "bitunix", origin: { kind: "api" as const } } : {}),
        ...(i % 3 === 0 ? { mae: 0.4, mfe: win ? 3 : 1.2, exit: win ? 102 : 99, side: "long" as const } : {}),
      }),
    );
  }
  return out;
}

export function fixtureView(trades: Trade[] = fixtureTrades()) {
  const enriched = enrich(trades, SETTINGS);
  return accountView(enriched, SETTINGS, "all", { now: () => NOW });
}

export const CTX = { settings: SETTINGS };
