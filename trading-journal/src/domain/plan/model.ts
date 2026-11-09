/**
 * Der Handelsplan als EIN Ablauf: Formular + Kerzen + Konto → Einstieg → Ausstieg → Größe → Risiko-Check → Ticket.
 * Rein: dieselbe Eingabe gibt dieselbe Antwort, die Uhr (`now`) kommt von außen. Jeder Schritt führt zum nächsten nur, wenn er
 * gelingt; sonst steht dort, warum nicht – nichts wird geschätzt oder stillschweigend zurechtgebogen.
 */
import type { Candle } from "@/market/types";
import type { Side } from "../types";
import type { RiskLimits } from "../risk/config";
import type { LimitReport } from "../risk/limits";
import { atrOf, closedUpTo, entryTimer, intervalText, type EntryResult } from "./entry";
import { exitPlan, stopRuleText, targetRuleText, type ExitResult } from "./exit";
import { feedLag, type FeedLag } from "./feed";
import { DEFAULT_LOT, TF_MS, type PlanForm } from "./form";
import { inferStep, moneyText, num, pctText, priceText, qtyText, toStep } from "./format";
import { manageActive, managePlan, type ManageResult } from "./manage";
import type { PlanPrefs } from "./config";
import { riskCheck, type RiskVerdict } from "./risk";
import { flatByMs, latestSession, sessionDay, sessionDef, type SessionDay } from "./sessions";
import { positionSizing, type SizeResult } from "./size";
import { baseOf, buildTicket, type EntrySource, type Ticket, type TicketPlan } from "./ticket";
import { clockIn, dateTimeIn, zoneLabel } from "./time";

export type StepId = "entry" | "exit" | "size" | "risk" | "ticket";
export const STEP_IDS: readonly StepId[] = ["entry", "exit", "size", "risk", "ticket"];
export type StepStatus = "done" | "warn" | "blocked" | "todo";

export interface StepState {
  id: StepId;
  status: StepStatus;
  /** the first step that is not done – the one to work on */
  current: boolean;
}

export interface ModelInput {
  form: PlanForm;
  candles: readonly Candle[];
  now: number;
  prefs: PlanPrefs;
  /** capital of the form's account (start capital from the settings) */
  capital: number;
  currency: string;
  limits: RiskLimits;
  /** live limits of the form's account */
  report: LimitReport;
  sourceLabel: string;
  /** when the candles were loaded */
  fetchedAt: number | null;
  /** the current price while the session is live and the data is fresh */
  fresh?: { price: number; at: number } | null;
  /** the time of the last trade the source reports (ms) – the stock feed's lag is judged against it */
  marketTime?: number | null;
  /** what the source says about itself (unofficial, delayed, how far back it reaches …): added to the assumptions of step 1 */
  sourceNotes?: readonly string[];
}

export interface PlanModel {
  session: SessionDay;
  intervalMs: number;
  tick: number;
  tickSource: "eingegeben" | "aus den Kerzen" | "Voreinstellung" | "US-Aktien: 1 Cent" | "US-Aktien unter 1 Dollar: 0,0001";
  lot: number;
  entry: EntryResult;
  side: Side | null;
  entryPrice: number | null;
  entrySource: EntrySource | null;
  atr: { value: number; bars: number } | null;
  flatByMs: number;
  /** a typed "flat by" time that is not valid (before the open) */
  flatByInvalid: boolean;
  exit: ExitResult | null;
  riskPct: number;
  size: SizeResult | null;
  risk: RiskVerdict | null;
  /** the management plan (break-even, partial target, trailing); `null` while nothing is planned or the plan lacks a size (F65) */
  manage: ManageResult | null;
  ticketPlan: TicketPlan | null;
  ticket: Ticket | null;
  steps: StepState[];
  /** number of finished steps */
  progress: number;
  /** "was wurde angenommen", per step */
  assumptions: Record<StepId, string[]>;
  /** end of the newest closed candle that was used */
  candlesUntil: number | null;
  /** where the stock feed stands against the clock while the session runs (`null` for crypto and outside a running session) */
  lag: FeedLag | null;
  /** the market kind of the session */
  market: SessionDay["market"];
  /** the currency the plan is calculated in (stocks: USD) */
  currency: string;
  /** the leverage the plan is calculated with (stocks: always 1) */
  leverage: number;
}

/** US stocks are quoted and calculated in dollars. */
export const STOCK_CURRENCY = "USD";
/** The tick of a US stock: a cent from one dollar up (SEC Rule 612), a hundredth of a cent below. */
export const STOCK_TICK = 0.01;
export const SUB_DOLLAR_TICK = 0.0001;

const isCrypto = (s: SessionDay): boolean => s.market === "crypto";

/** Warm-up candles before the session (ATR over 14 candles, plus a margin). */
export const WARMUP_CANDLES = 40;

/** The candles the plan needs for a session: from the warm-up before the open to now (or the end of a past session). */
export function candleWindow(session: SessionDay, intervalMs: number, now: number): { from: number; to: number } {
  return { from: session.openMs - WARMUP_CANDLES * intervalMs, to: Math.min(now, session.closeMs) };
}

/** The risk fraction of a form: the typed one, else the risk setting but never above the per-trade limit. */
export function effectiveRiskPct(form: PlanForm, limits: RiskLimits): number {
  return form.riskPct ?? Math.min(limits.riskPerTradePct, limits.maxLossTradePct);
}

export function buildPlanModel(i: ModelInput): PlanModel {
  const { form, now } = i;
  const session = form.day ? sessionDay(form.session, form.day, form.cutoffMin) : latestSession(form.session, now, form.cutoffMin);
  const intervalMs = TF_MS[form.tf];
  const def = sessionDef(form.session);

  // price step and quantity step
  const stocks = session.market === "stocks";
  // a stock plan is calculated in dollars and without leverage; the risk lines speak the same currency
  const currency = stocks ? STOCK_CURRENCY : i.currency;
  const leverage = stocks ? 1 : form.leverage;
  const report = stocks && i.report.currency !== currency ? { ...i.report, currency } : i.report;
  let tick = form.tick ?? 0;
  let tickSource: PlanModel["tickSource"] = "eingegeben";
  if (!(tick > 0)) {
    if (stocks) {
      // the exchange's rule, not a guess from the candles (Yahoo's prices carry more places than the tick)
      const px = i.candles.length ? i.candles[i.candles.length - 1]!.close : null;
      const sub = px != null && px < 1;
      tick = sub ? SUB_DOLLAR_TICK : STOCK_TICK;
      tickSource = sub ? "US-Aktien unter 1 Dollar: 0,0001" : "US-Aktien: 1 Cent";
    } else {
      const prices: number[] = [];
      for (const c of i.candles) prices.push(c.open, c.high, c.low, c.close);
      if (prices.length) {
        tick = inferStep(prices, 0.01);
        tickSource = "aus den Kerzen";
      } else {
        tick = 0.01;
        tickSource = "Voreinstellung";
      }
    }
  }
  const lot = form.lot ?? DEFAULT_LOT[session.market];

  const entry = entryTimer({ symbol: form.symbol, candles: i.candles, intervalMs, session, now, orMinutes: form.orMinutes, sides: form.sides, minVolumeX: form.minVolumeX, tick });

  // which entry the plan rests on
  let side: Side | null = null;
  let entryPrice: number | null = null;
  let entrySource: EntrySource | null = null;
  if (form.manualEntry != null && form.manualEntry > 0) {
    side = form.manualSide;
    entryPrice = form.manualEntry;
    entrySource = "manual";
  } else if (entry.signal) {
    side = entry.signal.side;
    entryPrice = entry.signal.price;
    entrySource = "signal";
  } else if (entry.range?.complete && entry.status !== "closed" && entry.status !== "invalid" && entry.status !== "no-data" && entry.status !== "expired") {
    side = form.sides === "both" ? form.manualSide : form.sides;
    entryPrice = side === "long" ? entry.range.high : entry.range.low;
    entrySource = "level";
  }
  // a stock is traded in whole cents, the source quotes up to four places: the plan's entry (a close or a range edge) is rounded to the
  // price step – to the worse side on a tie – so the ticket holds prices a broker takes; a typed price stays as typed
  let entryRounded = false;
  if (stocks && entryPrice != null && entrySource !== "manual") {
    const rounded = toStep(entryPrice, tick, "nearest-away", side === "short" ? -1 : 1);
    entryRounded = Math.abs(rounded - entryPrice) > 1e-9;
    entryPrice = rounded;
  }

  // ATR of the closed candles up to the entry (crypto: with the candles before the session, stocks: the session only)
  const upTo = entry.signal ? entry.signal.barClose : Math.min(now, session.closeMs);
  let atrCandles = closedUpTo(i.candles, intervalMs, upTo);
  if (!isCrypto(session)) atrCandles = atrCandles.filter((c) => c.time >= session.openMs);
  const atr = atrOf(atrCandles, 14);
  const candlesUntil = entry.last ? entry.last.closeMs : null;

  // flat by
  const typed = flatByMs(session, form.flatBy);
  const flat = typed ?? flatByMs(session, null)!;
  const flatByInvalid = form.flatBy != null && typed == null;

  // 2 — exit
  const exit: ExitResult | null =
    side != null && entryPrice != null
      ? exitPlan({
          side,
          entry: entryPrice,
          range: entry.range?.complete ? { high: entry.range.high, low: entry.range.low } : null,
          atr,
          stop: form.stop,
          target: form.target,
          tick,
          entryMs: entry.signal ? entry.signal.barClose : entry.past ? null : now,
          flatByMs: flat,
          tz: session.tz,
        })
      : null;

  // 3 — size
  const riskPct = effectiveRiskPct(form, i.limits);
  const day = report.rows.find((r) => r.key === "day");
  const size: SizeResult | null =
    exit?.ok && entryPrice != null
      ? positionSizing({
          side: exit.side,
          entry: exit.entry,
          stop: exit.stop,
          tick,
          capital: i.capital,
          riskPct,
          maxPositionPct: i.prefs.maxPositionPct,
          cashBufferPct: i.prefs.cashBufferPct,
          leverage,
          dayRemaining: day ? Math.max(0, day.limit - day.used) : null,
          lot,
          feePct: i.limits.feePct,
          slippagePct: i.limits.slippagePct,
          minOrderValue: i.prefs.minOrderValue,
          currency,
        })
      : null;

  // 4 — risk
  const risk: RiskVerdict | null =
    exit?.ok && size?.ok
      ? riskCheck({
          side: exit.side,
          entry: exit.entry,
          stop: exit.stop,
          target: exit.target,
          qty: size.qty,
          notional: size.notional,
          maxLoss: size.maxLoss,
          leverage,
          account: form.account,
          limits: i.limits,
          report,
          capital: i.capital,
          now,
          minRewardRisk: i.prefs.minRewardRisk,
          fresh: entry.past ? null : i.fresh,
          signal: entry.signal ? { ageMin: entry.signal.ageMin, late: entry.signal.late, past: entry.past } : null,
          tick,
        })
      : null;

  // 4b — management after the entry (only when the trader switched a rule on)
  const manage: ManageResult | null =
    exit?.ok && size?.ok && manageActive(form.manage)
      ? managePlan({ side: exit.side, entry: exit.entry, stop: exit.stop, target: exit.target, qty: size.qty, lot, tick, feePct: i.limits.feePct, slippagePct: i.limits.slippagePct, atr: atr?.value ?? null, spec: form.manage, currency: i.currency, unit: baseOf(form.symbol) })
      : null;

  // 5 — ticket
  let ticketPlan: TicketPlan | null = null;
  let ticket: Ticket | null = null;
  if (exit?.ok && size?.ok && risk && !risk.blocked && entrySource) {
    ticketPlan = {
      symbol: form.symbol,
      side: exit.side,
      entry: exit.entry,
      stop: exit.stop,
      target: exit.target,
      qty: size.qty,
      notional: size.notional,
      maxLoss: size.maxLoss,
      maxLossPct: size.riskOfCapital,
      rr: exit.rr,
      leverage,
      flatByMs: flat,
      light: risk.light,
      tick,
      lot,
      currency,
      market: session.market,
      tz: session.tz,
      sessionLabel: session.label,
      entrySource,
      signalAt: entry.signal?.barClose ?? null,
      stopLabel: exit.stopLabel,
      targetLabel: exit.targetLabel,
      sourceLabel: i.sourceLabel,
      intervalLabel: intervalText(intervalMs),
      candlesUntil,
      fetchedAt: i.fetchedAt,
      manage: manage?.ok ? manage.lines : null,
    };
    ticket = buildTicket(ticketPlan);
  }

  // the steps
  const status: Record<StepId, StepStatus> = { entry: "todo", exit: "todo", size: "todo", risk: "todo", ticket: "todo" };
  if (entryPrice != null) status.entry = entrySource === "level" ? "warn" : "done";
  else if (entry.status === "closed" || entry.status === "invalid" || entry.status === "no-data" || entry.status === "expired") status.entry = "blocked";
  if (exit) status.exit = exit.ok ? "done" : "blocked";
  if (size) status.size = size.ok ? "done" : "blocked";
  if (risk) status.risk = risk.light === "green" ? "done" : risk.light === "amber" ? "warn" : "blocked";
  if (ticket) status.ticket = "done";
  const firstOpen = STEP_IDS.find((s) => status[s] !== "done");
  const steps: StepState[] = STEP_IDS.map((id) => ({ id, status: status[id], current: id === firstOpen }));

  // what was assumed, per step
  const cur = currency;
  const P = (x: number): string => priceText(x, tick);
  const orBars = Math.round((form.orMinutes * 60_000) / intervalMs);
  const lag = stocks ? feedLag({ now, session, intervalMs, lastCloseMs: entry.last ? entry.last.closeMs : null, marketTime: i.marketTime ?? null }) : null;
  const assumptions: PlanModel["assumptions"] = {
    entry: [
      `Markt ${form.symbol} · Quelle ${i.sourceLabel} · ${intervalText(intervalMs)}`,
      `Sitzung ${session.label}${def.market === "stocks" ? "" : " (Krypto handelt rund um die Uhr; die Sitzung gibt nur den Beginn der Range)"} – in Berlin ${session.openBerlin} Uhr`,
      `Range: die ersten ${form.orMinutes} Minuten (${orBars} ${orBars === 1 ? "Kerze" : "Kerzen"}); Signal: erste geschlossene Kerze, deren Schluss außerhalb liegt (${form.sides === "both" ? "Long über dem Hoch, Short unter dem Tief" : form.sides === "long" ? "nur Long über dem Hoch" : "nur Short unter dem Tief"})`,
      `Letzter Einstieg ${clockIn(session.cutoffMs, session.tz)} Uhr · Volumenfilter ${form.minVolumeX ? `${num(form.minVolumeX, 1)}× der Range` : "aus"} · nur geschlossene Kerzen`,
      ...(def.market === "stocks" && !session.calendarKnown ? ["Der Feiertagskalender der App kennt dieses Jahr nicht: erkannt werden nur Wochenenden."] : []),
      ...(entryRounded ? [`Der Einstieg wird auf den Kursschritt gerundet (${priceText(entryPrice!, tick)}): die Quelle liefert Kurse mit bis zu vier Stellen, ein Broker nimmt ganze Cent.`] : []),
      ...(stocks ? [`Nur die reguläre Handelszeit (${clockIn(session.openMs, session.tz)} bis ${clockIn(session.closeMs, session.tz)} Uhr ${zoneLabel(session.openMs, session.tz)}): kein Vorhandel, kein Nachhandel, Wochenenden und Börsenfeiertage haben keine Sitzung.`] : []),
      ...(i.sourceNotes ?? []),
    ],
    exit: [
      `Stop: ${stopRuleText(form.stop, side ?? form.manualSide)} · Ziel: ${targetRuleText(form.target)}`,
      `Kursschritt ${P(tick)} (${tickSource}); der Stop rundet vom Einstieg weg, das Ziel auf den nächsten Schritt`,
      atr ? `ATR: Mittel der letzten ${atr.bars} True Ranges = ${P(atr.value)}${isCrypto(session) ? " (auch Kerzen vor der Sitzung)" : " (nur Kerzen der Sitzung)"}` : "ATR: noch zu wenige geschlossene Kerzen",
      `Flat by ${clockIn(flat, session.tz)} Uhr (${zoneLabel(flat, session.tz)})${form.flatBy ? "" : ", fünf Minuten vor dem Ende der Sitzung"}${flatByInvalid ? " – deine Eingabe liegt vor dem Beginn und wurde nicht übernommen" : ""}`,
    ],
    size: [
      `Konto ${form.account === "scalp" ? "Scalp" : "Makro"} mit ${moneyText(i.capital)} ${cur} · Risiko ${pctText(riskPct, 2)} pro Trade = ${moneyText(i.capital * riskPct)} ${cur}${form.riskPct == null ? " (aus den Risiko-Einstellungen)" : ""}`,
      `Gebühren ${pctText(i.limits.feePct, 3)} je Seite und Slippage ${pctText(i.limits.slippagePct, 3)} am Stop (aus den Risiko-Einstellungen) sind im Verlust je Einheit enthalten`,
      stocks
        ? `Ganze Stück: Mengenschritt ${qtyText(lot, lot)} (gerundet wird ab) · Positionsdeckel ${pctText(i.prefs.maxPositionPct, 0)} des Kontos · Cash-Puffer ${pctText(i.prefs.cashBufferPct, 0)} · ohne Hebel (Aktien werden mit 1× gerechnet)`
        : `Mengenschritt ${qtyText(lot, lot)} (gerundet wird ab) · Positionsdeckel ${pctText(i.prefs.maxPositionPct, 0)} des Kontos · Cash-Puffer ${pctText(i.prefs.cashBufferPct, 0)} · Hebel ${num(leverage, 0)}×`,
      day ? `Tageslimit: ${moneyText(Math.max(0, day.limit - day.used))} ${cur} Rest von ${moneyText(day.limit)} ${cur}` : "Tageslimit: nicht bekannt",
      ...(stocks && i.currency !== STOCK_CURRENCY && i.currency !== "USDT" ? [`Dein Journal rechnet in ${i.currency}, Aktien notieren in ${STOCK_CURRENCY}. Die App rechnet nicht um: dein Kapital wird als ${STOCK_CURRENCY} gelesen.`] : stocks ? [`Dein Kapital (${i.currency}) wird 1 : 1 als ${STOCK_CURRENCY} gelesen – die App rechnet keine Währungen um.`] : []),
      ...(stocks && side === "short" ? ["Short: Leihbestand, Marge und Leihgebühr deines Brokers kennt die App nicht – sie rechnet nur Stop, Ziel und Menge."] : []),
    ],
    risk: [
      `Grenzen aus deinen Einstellungen: Verlust pro Trade ${pctText(i.limits.maxLossTradePct, 2)}, pro Tag ${pctText(i.limits.maxLossDayPct, 2)}, Trades pro Tag ${i.limits.maxTrades[form.account]}${stocks ? "" : `, Hebelregel ${i.limits.leverageRule[form.account]}×`}`,
      `Mindestens ${num(i.prefs.minRewardRisk, 2)} : 1 Chance-Risiko · Stand der Limits: dein Journal bis ${dateTimeIn(now, session.tz)} Uhr (${zoneLabel(now, session.tz)})`,
      stocks ? "Aktien ohne Hebel: es gibt keine Liquidation, die vor dem Stop liegen könnte." : "Liquidation ist eine Näherung (Wartungsmargen-Stufen der Risiko-Einstellungen)",
    ],
    ticket: [
      `Quelle ${i.sourceLabel}${candlesUntil != null ? ` · Kerzen bis ${dateTimeIn(candlesUntil, session.tz)} Uhr` : " · keine Kerzendaten"}${i.fetchedAt != null ? ` · abgerufen ${dateTimeIn(i.fetchedAt, session.tz)} Uhr` : ""}`,
      "Das Ticket wird nicht gesendet und nicht gespeichert, bis du es selbst kopierst oder den Plan speicherst.",
    ],
  };
  return {
    session,
    intervalMs,
    tick,
    tickSource,
    lot,
    entry,
    side: exit?.ok ? exit.side : side,
    entryPrice,
    entrySource,
    atr,
    flatByMs: flat,
    flatByInvalid,
    exit,
    riskPct,
    size,
    risk,
    manage,
    ticketPlan,
    ticket,
    steps,
    progress: steps.filter((s) => s.status === "done").length,
    assumptions,
    candlesUntil,
    lag,
    market: session.market,
    currency,
    leverage,
  };
}
