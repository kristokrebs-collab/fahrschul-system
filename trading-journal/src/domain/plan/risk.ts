/**
 * Risiko-Manager des Handelsplans (nach dem Skill trader-risk): prüft den Plan gegen die Grenzen des Nutzers und sagt
 * Ampel + Gründe. Die Grenzen sind die der Risiko-Seite – dieselben Funktionen, nichts doppelt gerechnet:
 *  - `limitStatus` (Live-Limits: Tagesverlust, offenes Risiko, Trades heute, Hebel, Pause) liefert die Zahlen,
 *  - `riskLimits` (Disziplin-Grenzen + Risiko-Einstellungen + Hebelregel) die Grenzen,
 *  - `riskPreview` die Nähe der Liquidation zum Stop,
 *  - `rrCalc` das Chance-Risiko nach Gebühren.
 * Dazu die Regeln des Skills, die die Risiko-Seite nicht kennt: ein Stop ist Pflicht, das Chance-Risiko muss das eigene
 * Minimum erreichen, der Tagesverlust wird mit dem Verlust DIESES Trades zusammen geprüft, ein Kurs, der seit dem Signal
 * gelaufen ist, erhöht das Risiko (gemessen wird vom schlechteren von Plan-Einstieg und frischem Kurs).
 *
 * Rot ist final für diesen Plan: kein Ticket. Gelb heißt: erlaubt, aber schau hin. Grün: alles innerhalb der Grenzen. Eine
 * Ampel ist eine Regelprüfung, keine Empfehlung.
 */
import type { AccountId, Side } from "../types";
import type { RiskLimits } from "../risk/config";
import { stateOf, type LimitReport, type LimitRow as ReportRow } from "../risk/limits";
import { rrCalc } from "../risk/sizing";
import { cooldownWarning, riskPreview } from "../risk/warnings";
import { moneyText, num, pctText, priceText } from "./format";

export type LineState = "ok" | "warn" | "breach";
export type RiskKey = "stop" | "loss" | "rr" | "day" | "trades" | "open" | "leverage" | "liquidation" | "pause" | "price" | "signal";
export type Light = "green" | "amber" | "red";

export interface RiskLine {
  key: RiskKey;
  state: LineState;
  title: string;
  detail: string;
}

export interface RiskInput {
  side: Side;
  entry: number;
  stop: number | null;
  target: number | null;
  qty: number;
  notional: number;
  /** loss at the stop incl. fees and slippage, money */
  maxLoss: number | null;
  /** chosen leverage (1 = none) */
  leverage: number;
  account: AccountId;
  limits: RiskLimits;
  report: LimitReport;
  capital: number;
  now: number;
  /** smallest acceptable reward ÷ risk */
  minRewardRisk: number;
  /** the current price, when fresh (< 15 minutes): measured against the plan's entry */
  fresh?: { price: number; at: number } | null;
  /** the age of the entry signal (live session only) */
  signal?: { ageMin: number; late: boolean; past: boolean } | null;
  tick: number;
}

export interface RiskVerdict {
  light: Light;
  /** one sentence */
  headline: string;
  lines: RiskLine[];
  /** red: no ticket for this plan */
  blocked: boolean;
  counts: Record<LineState, number>;
}

/** A price older than this is not used to measure the risk (Skill trader-risk). */
export const FRESH_MAX_MS = 15 * 60_000;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const ratioText = (rr: number): string => `${num(rr, 2)} : 1`;

const rowOf = (report: LimitReport, key: ReportRow["key"]): ReportRow | undefined => report.rows.find((r) => r.key === key);

export function riskCheck(i: RiskInput): RiskVerdict {
  const { limits, report, capital, now } = i;
  const cur = report.currency;
  const M = (x: number): string => `${moneyText(x)} ${cur}`;
  const P = (x: number): string => priceText(x, i.tick);
  const long = i.side === "long";
  const lines: RiskLine[] = [];
  const push = (key: RiskKey, state: LineState, title: string, detail: string): void => void lines.push({ key, state, title, detail });
  const hasStop = fin(i.stop) && i.stop > 0;

  // 1 — the stop
  if (!hasStop) {
    push("stop", "breach", "Stop fehlt", "Ohne Stop ist das Risiko offen. Der Plan braucht einen Stop, bevor er geprüft werden kann.");
  } else if (long ? i.stop! >= i.entry : i.stop! <= i.entry) {
    push("stop", "breach", "Stop auf der falschen Seite", `Der Stop ${P(i.stop!)} liegt ${long ? "nicht unter" : "nicht über"} dem Einstieg ${P(i.entry)}.`);
  } else {
    push("stop", "ok", "Stop gesetzt", `Stop ${P(i.stop!)}, ${pctText(Math.abs(i.entry - i.stop!) / i.entry, 2)} vom Einstieg entfernt.`);
  }

  // 2 — loss at the stop against the limit per trade
  const maxLoss = fin(i.maxLoss) && hasStop ? i.maxLoss : null;
  if (maxLoss != null && capital > 0) {
    const frac = maxLoss / capital;
    const state: LineState = stateOf(frac / limits.maxLossTradePct, limits.warnAt, true);
    push(
      "loss",
      state,
      state === "breach" ? `Verlust am Stop ${pctText(frac, 2)} > Limit ${pctText(limits.maxLossTradePct, 2)}` : `Verlust am Stop ${pctText(frac, 2)} (Limit ${pctText(limits.maxLossTradePct, 2)})`,
      `${M(maxLoss)} bis zum Stop, inklusive Gebühren und Slippage – bei ${M(capital)} Kapital. Dein Limit pro Trade: ${M(limits.maxLossTradePct * capital)}.`,
    );
  }

  // 3 — reward : risk
  if (hasStop) {
    if (!fin(i.target) || !(i.target > 0)) {
      push("rr", "warn", "Kein Ziel gesetzt", "Ohne Ziel gibt es kein Chance-Risiko-Verhältnis; der Trade hat dann nur einen Ausstieg nach unten.");
    } else {
      const rr = rrCalc({ entry: i.entry, stop: i.stop!, target: i.target, side: i.side, feePct: limits.feePct, slippagePct: limits.slippagePct });
      if (!rr) push("rr", "breach", "Ziel auf der falschen Seite", `Das Ziel ${P(i.target)} liegt ${long ? "nicht über" : "nicht unter"} dem Einstieg.`);
      else if (rr.rr < i.minRewardRisk - 1e-9) push("rr", "breach", `Chance-Risiko ${ratioText(rr.rr)} unter deinem Minimum ${ratioText(i.minRewardRisk)}`, `Ziel ${P(i.target)}, Stop ${P(i.stop!)}: der mögliche Gewinn ist kleiner als verlangt im Verhältnis zum Verlust.`);
      else if (rr.rrNet < i.minRewardRisk - 1e-9) push("rr", "warn", `Chance-Risiko ${ratioText(rr.rr)} – nach Gebühren ${ratioText(rr.rrNet)}`, `Vor Kosten reicht es für dein Minimum ${ratioText(i.minRewardRisk)}, nach Gebühren und Slippage nicht mehr.`);
      else push("rr", "ok", `Chance-Risiko ${ratioText(rr.rr)} (nach Gebühren ${ratioText(rr.rrNet)})`, `Dein Minimum: ${ratioText(i.minRewardRisk)}. Man braucht dafür mindestens ${num(rr.beWinRate * 100, 0)} % Treffer, um nach Gebühren bei null zu landen.`);
    }
  }

  // 4 — the day: today's loss so far PLUS this trade's loss at the stop
  const day = rowOf(report, "day");
  if (day) {
    const after = maxLoss != null ? day.used + maxLoss : day.used;
    const afterRatio = day.limit > 0 ? after / day.limit : Infinity;
    const usedRatio = day.limit > 0 ? day.used / day.limit : Infinity;
    const projection = maxLoss != null ? ` Mit diesem Trade bis zum Stop wären es ${M(after)} (${pctText(afterRatio, 0)}).` : "";
    if (day.state === "breach") push("day", "breach", "Tageslimit schon erreicht", `Heute schon ${M(day.used)} von ${M(day.limit)} verloren – kein neuer Trade mehr heute.`);
    else if (after > day.limit + 1e-9) push("day", "breach", `Mit diesem Stop wären es ${pctText(afterRatio, 0)} deines Tageslimits`, `Heute schon ${M(day.used)} von ${M(day.limit)} (${pctText(usedRatio, 0)});${projection}`);
    else if (usedRatio >= 0.5 || afterRatio >= limits.warnAt) {
      const state: LineState = afterRatio >= limits.warnAt ? "warn" : "ok";
      const title = usedRatio >= 0.5 ? `Tageslimit schon zu ${pctText(usedRatio, 0)} ausgeschöpft` : `Mit diesem Trade wären es ${pctText(afterRatio, 0)} deines Tageslimits`;
      push("day", state, title, `${M(day.used)} von ${M(day.limit)} heute.${projection}`);
    } else push("day", "ok", `Tageslimit zu ${pctText(usedRatio, 0)} genutzt`, `${M(day.used)} von ${M(day.limit)} heute.${projection}`);
  }

  // 5 — trades today
  const trades = rowOf(report, "trades");
  if (trades) {
    if (trades.used >= trades.limit) push("trades", "breach", `Schon ${trades.used} Trades heute`, `Deine Grenze sind ${trades.limit} pro Tag – kein weiterer Einstieg.`);
    else push("trades", "ok", `${trades.used} von ${trades.limit} Trades heute`, trades.used + 1 === trades.limit ? "Das wäre dein letzter Trade des Tages." : `Das wäre Trade Nr. ${trades.used + 1}.`);
  }

  // 6 — open risk after this trade
  const open = rowOf(report, "openRisk");
  if (open) {
    const after = maxLoss != null ? open.used + maxLoss : open.used;
    const ratio = open.limit > 0 ? after / open.limit : Infinity;
    const state = stateOf(ratio, limits.warnAt);
    push("open", state, state === "breach" ? "Offenes Risiko über der Grenze" : `Offenes Risiko zu ${pctText(ratio, 0)} der Grenze`, `Mit diesem Trade ${M(after)} von ${M(open.limit)} bis zu den Stops.`);
  }

  // 7 — leverage the position needs against the rule
  const rule = limits.leverageRule[i.account];
  const needed = capital > 0 ? i.notional / capital : 0;
  const used = i.leverage > 1 ? Math.max(needed, i.leverage) : needed;
  if (used > rule + 1e-9) push("leverage", "breach", `Hebel ${num(used, 1)}× über deiner Regel (${rule}×)`, `Die Position braucht ${num(needed, 2)}× das Konto; die Regel des ${i.account === "scalp" ? "Scalp" : "Makro"}-Kontos erlaubt ${rule}×.`);
  else push("leverage", "ok", `Hebel ${num(used, 1)}× (Regel ${rule}×)`, `Die Position ist ${num(needed, 2)}× so groß wie das Konto.`);

  // 8 — liquidation in front of the stop (only with leverage)
  if (hasStop && i.leverage > 1) {
    const pv = riskPreview({ account: i.account, side: i.side, status: "open", entry: i.entry, stop: i.stop, target: i.target, qty: i.qty, leverage: i.leverage, marginMode: "isolated" }, { limits, report, capital, now });
    const liq = pv.warnings.find((w) => w.key === "preview:liq");
    if (liq) push("liquidation", "breach", liq.title, liq.detail);
    else push("liquidation", "ok", "Liquidation liegt hinter dem Stop", pv.liqPrice != null ? `Näherung: Liquidation bei etwa ${P(pv.liqPrice)} (isolierte Marge).` : "Näherung der Wartungsmargen-Stufen.");
  }

  // 9 — a pause
  if (report.cooldown && report.cooldown.endsAt > now) {
    const w = cooldownWarning(report.cooldown, now);
    push("pause", "breach", w.title, w.detail);
  } else {
    push("pause", "ok", "Keine Pause aktiv", "Weder Tageslimit noch Verlustserie halten dich gerade auf.");
  }

  // 10 — the price since the plan (measured from the worse of entry and a fresh price)
  const fresh = i.fresh && now - i.fresh.at < FRESH_MAX_MS && now >= i.fresh.at ? i.fresh : null;
  if (fresh && hasStop) {
    const worse = long ? fresh.price > i.entry : fresh.price < i.entry;
    if (worse) {
      const rr2 = fin(i.target) && i.target > 0 ? rrCalc({ entry: fresh.price, stop: i.stop!, target: i.target, side: i.side, feePct: limits.feePct, slippagePct: limits.slippagePct }) : null;
      const lossPerUnit = Math.abs(fresh.price - i.stop!) + limits.feePct * (fresh.price + i.stop!) + limits.slippagePct * i.stop!;
      const loss2 = i.qty * lossPerUnit;
      const frac2 = capital > 0 ? loss2 / capital : Infinity;
      const tooMuch = frac2 > limits.maxLossTradePct + 1e-12 || (rr2 != null && rr2.rr < i.minRewardRisk - 1e-9) || rr2 == null;
      push(
        "price",
        tooMuch ? "breach" : "warn",
        `Der Kurs ist seit dem Plan gelaufen: ${P(fresh.price)} statt ${P(i.entry)}`,
        `Vom aktuellen Kurs wären es ${M(loss2)} (${pctText(frac2, 2)}) bis zum Stop${rr2 ? ` und ${ratioText(rr2.rr)} Chance-Risiko` : ""}${tooMuch ? " – das hält deine Grenzen nicht mehr ein. Die Bewegung, auf die der Plan wartete, ist teilweise schon passiert." : "."}`,
      );
    } else {
      push("price", "ok", "Der aktuelle Kurs liegt nicht schlechter als der Einstieg", `Kurs ${P(fresh.price)}, Einstieg ${P(i.entry)}.`);
    }
  }

  // 11 — an old signal
  if (i.signal && !i.signal.past && i.signal.late) {
    push("signal", "warn", `Das Signal ist ${i.signal.ageMin} Minuten alt`, "Älter als eine Kerze: ein später Einstieg ist ein anderer Trade als der, den der Plan rechnet.");
  }

  const counts: Record<LineState, number> = { ok: 0, warn: 0, breach: 0 };
  for (const l of lines) counts[l.state]++;
  const light: Light = counts.breach ? "red" : counts.warn ? "amber" : "green";
  const firstBreach = lines.find((l) => l.state === "breach");
  const firstWarn = lines.find((l) => l.state === "warn");
  const headline =
    light === "red"
      ? `Rot: ${firstBreach!.title}.${counts.breach > 1 ? ` Dazu ${counts.breach - 1} weitere ${counts.breach - 1 === 1 ? "Verletzung" : "Verletzungen"}.` : ""} Der Plan erfüllt deine Grenzen nicht.`
      : light === "amber"
        ? `Gelb: ${firstWarn!.title}. Der Plan hält deine Grenzen ein, schau bei den markierten Punkten hin.`
        : "Grün: Der Plan hält alle deine Grenzen ein.";
  return { light, headline, lines, blocked: light === "red", counts };
}
