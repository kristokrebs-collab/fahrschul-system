/**
 * „Wie läuft mein Forward-Test?“ / „Hält das virtuelle Konto, was der Backtest zeigt?“ – the assistant reads the virtual
 * accounts (`settings.forward`) through `accountView` (key numbers with their sample and uncertainty, from the lab's
 * `runStats`) and quotes the comparison with the backtest (`compareForward`) when the trader has already started it on the
 * account. It never starts a catch-up, a comparison or an account.
 */
import { accountView, COMPARE_MIN_TRADES, type AccountView, type ForwardAccount, type ForwardCompare } from "@/domain/forward";
import { has, tokensOf } from "../fuzzy";
import type { ToolEnv, ToolReply } from "../tools";
import { forwardAccounts } from "./sources";
import { dayText, dec, fact, openAction, pctText, plural, reply, rText, signedPct, stampText, tone } from "./shared";

const STATUS: Readonly<Record<ForwardAccount["status"], string>> = { running: "läuft", paused: "pausiert", ended: "beendet" };
const SPOT = { page: "labor", testid: "forward-section" } as const;

/** One account in a sentence: sample first, then the figures with their uncertainty. */
export function accountLine(a: ForwardAccount, v: AccountView): string {
  const s = v.stats;
  const head = `${a.name} (${a.symbol} ${a.interval}, ${STATUS[a.status]}, seit ${dayText(a.startMs)})`;
  if (!s.n) return `${head}: noch kein abgeschlossener Trade${v.upTo != null ? ` (Stand ${stampText(v.upTo)})` : v.hasData ? "" : ", noch keine Kerze verarbeitet"}.${v.open ? ` Offen: ${v.open.side === "long" ? "Long" : "Short"} seit ${stampText(v.open.since)}, unrealisiert ${dec(v.open.unrealised, 2)} USDT.` : ""}`;
  const win = s.winRate != null ? `Trefferquote ${pctText(s.winRate)}${s.winRateCI ? ` (80-%-Bereich ${Math.round(s.winRateCI.lo * 100)}–${Math.round(s.winRateCI.hi * 100)} %)` : ""}` : "";
  const avg = s.avgR != null ? `Ø ${rText(s.avgR)}${s.rCI ? ` (Bereich ${rText(s.rCI.lo)} bis ${rText(s.rCI.hi)})` : ""}` : "";
  return `${head}: ${plural(s.n, "Trade", "Trades")}, ${[win, avg].filter(Boolean).join(", ")}, Stand ${signedPct(v.nowPct, 1)} auf das Startkapital, größter Rückgang ${pctText(s.maxDD, 1)}${v.upTo != null ? `, verarbeitet bis ${stampText(v.upTo)}` : ""}.${v.open ? ` Offen: ${v.open.side === "long" ? "Long" : "Short"} seit ${stampText(v.open.since)}, unrealisiert ${dec(v.open.unrealised, 2)} USDT.` : ""}`;
}

function compareReply(a: ForwardAccount, v: AccountView, c: ForwardCompare, env: ToolEnv): ToolReply {
  const pick = (id: string) => c.rows.find((r) => r.id === id);
  const avg = pick("avgR");
  const rate = pick("rate");
  return reply({
    title: c.level === "holds" ? "Bisher im Rahmen des Backtests" : c.level === "differs" ? "Abweichung vom Backtest" : "Zu früh für ein Urteil",
    text: `${a.name}: ${c.headline} Grundlage: ${plural(c.forwardN, "Forward-Trade", "Forward-Trades")} gegen ${plural(c.backtestN, "Trade", "Trades")} aus ${c.backtestDays} Tagen vor dem Start. ${c.notes[1] ?? ""}`.trim(),
    facts: [
      fact("Forward-Trades", String(c.forwardN), "fg", c.forwardN),
      fact("Backtest-Trades", String(c.backtestN), "fg", c.backtestN),
      ...(avg ? [fact("Ø R (Forward)", avg.forward.split(" (")[0]!, tone(v.stats.avgR), v.stats.avgR)] : []),
      ...(rate ? [fact("Trefferquote", rate.forward.split(" (")[0]!)] : []),
    ],
    tone: c.level === "differs" ? "loss" : c.level === "holds" ? "win" : "mute",
    actions: [openAction(env, "Forward-Test öffnen", SPOT)],
    followUps: ["Wie läuft mein Forward-Test?"],
  });
}

export async function forwardAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const { accounts, compare } = await forwardAccounts(env);
  const open = openAction(env, "Forward-Test öffnen", SPOT);
  if (!accounts.length) {
    return reply({
      title: "Noch kein Forward-Test-Konto",
      text: "Du hast noch kein virtuelles Konto. Ein Forward-Test lässt eine eingefrorene Regel (aus „Eigene Idee“) ab jetzt auf neuen, geschlossenen Kerzen laufen – ohne Geld, und nie rückwirkend. Anlegen kannst du es im Labor unter „Forward-Test“; ich lege nichts an.",
      tone: "mute",
      actions: [open],
    });
  }
  const t = tokensOf(norm);
  const wantsCompare = has(t, "haelt", "halten", "vergleich", "backtest", "rueckblick", "zeigt", "verspricht", "bestaetigt", "abweich");
  const named = accounts.find((a) => a.name.length >= 3 && norm.includes(a.name.toLowerCase()));
  const live = accounts.filter((a) => a.status !== "ended");
  const pool = named ? [named] : live.length ? live : accounts.slice(-1);
  const first = pool[0]!;
  const v = accountView(first);

  if (wantsCompare) {
    const st = compare[first.id];
    if (st?.status === "done" && st.result) return compareReply(first, v, st.result, env);
    const n = v.stats.n;
    const early = n < COMPARE_MIN_TRADES ? ` Mit ${plural(n, "Trade", "Trades")} wäre ein Urteil ohnehin zu früh: unter ${COMPARE_MIN_TRADES} Trades kann jede Abweichung Zufall sein.` : "";
    return reply({
      title: st?.status === "loading" || st?.status === "calc" ? "Vergleich läuft" : "Vergleich noch nicht gerechnet",
      text: `${first.name}: ${st?.status === "loading" || st?.status === "calc" ? "Der Vergleich mit dem Backtest wird gerade gerechnet." : "Der Vergleich mit dem Backtest derselben Regeln vor dem Start wurde noch nicht gerechnet – er lädt Kerzen und startet nur auf deinen Klick im Konto („Mit dem Backtest vergleichen“)."}${early} ${accountLine(first, v)}`,
      facts: [fact("Trades", String(n), "fg", n), fact("Stand", signedPct(v.nowPct, 1), tone(v.nowPct), v.nowPct)],
      tone: "mute",
      actions: [open],
    });
  }

  const lines = pool.slice(0, 3).map((a, i) => (i === 0 ? accountLine(a, v) : accountLine(a, accountView(a))));
  const more = pool.length > 3 ? ` Weitere ${pool.length - 3} Konten stehen im Labor.` : "";
  const s = v.stats;
  const caution = s.n < COMPARE_MIN_TRADES ? ` Bei ${plural(s.n, "Trade", "Trades")} sagen die Zahlen noch wenig – unter ${COMPARE_MIN_TRADES} Trades ist vieles Zufall.` : "";
  return reply({
    title: pool.length === 1 ? first.name : `${pool.length} Forward-Test-Konten`,
    text: `${lines.join(" ")}${more}${caution}`,
    facts: [fact("Trades", String(s.n), "fg", s.n), fact("Stand", signedPct(v.nowPct, 1), tone(v.nowPct), v.nowPct), fact("Ø R", s.avgR == null ? "–" : rText(s.avgR), tone(s.avgR), s.avgR), fact("Rückgang", pctText(s.maxDD, 1), s.maxDD > 0 ? "loss" : "fg", -s.maxDD)],
    tone: "fg",
    actions: [open],
    followUps: ["Hält das virtuelle Konto, was der Backtest zeigt?"],
  });
}
