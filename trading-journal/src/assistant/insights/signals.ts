/**
 * Signals (Posteingang, Bilanz, Qualität, Ausgang): „Welche Signale habe ich diese Woche ausgelassen und warum?“, „Wie ist die
 * Trefferquote meiner Box-Setups?“, „Welche verpassten Signale hatten das Ziel zuerst?“, „Wie lange war die App letzten Monat
 * offen?“, „Gab es Alarme mit mehr als 5 Minuten Verspätung?“. The figures are the domain's own (`buildInbox`, `matchSignals`,
 * `buildBalance`, `qualityReport`) over the signal archive of THIS device. Outcomes are named only where they are already known
 * (the app evaluates them automatically – `views/coach/signalAuto.ts` – and caches them; this session's run); otherwise the answer
 * names the state („x von y ausgewertet“) – the assistant loads no candles and starts no evaluation itself. Whether a signal was
 * left out on purpose or overlooked is known only where the trader set „Ausgelassen – Grund“.
 */
import { wilson } from "@/domain/analytics/stats";
import { buildBalance, buildInbox, durationText, matchSignals, qualityReport, signalKindLabel, SIGNAL_ARCHIVE_DAYS, SLOW_ALERT_MS, type InboxRow, type OutcomeMap, type SignalEvent } from "@/domain/missed";
import { contains, periodOf, type ReportPeriod } from "@/domain/reports/periods";
import { has, tokensOf } from "../fuzzy";
import type { ToolEnv, ToolReply } from "../tools";
import { periodMentioned } from "./period";
import { signalsSource } from "./sources";
import { dayText, fact, openAction, pctText, plural, range, reply, rText, stampText, tone } from "./shared";

const EMPTY_ARCHIVE = `Das Signalarchiv ist leer. Die App hält Signale (Einstiegs-Check, Box-zu-Box-Alarme, bestätigte Schlüsselmarken) erst fest, seit es das Archiv gibt – nur solange sie offen ist, nur auf diesem Gerät, die letzten 300 und höchstens ${SIGNAL_ARCHIVE_DAYS} Tage. Was vorher geschah, lässt sich nicht nachtragen.`;
const INBOX = { page: "coach", testid: "inbox-card" } as const;
const MISSED = { page: "coach", feature: "verpasste-chancen" } as const;
const BALANCE = { page: "coach", testid: "balance-card" } as const;
const QUALITY = { page: "coach", testid: "quality-card" } as const;
const AUTO_NOTE = "Die App wertet die Ausgänge selbst aus – beim Öffnen des Coachs und im Leerlauf nach dem Start, sobald die Kerzen nach dem Signal vorliegen (bei Datensparmodus, schwachem Akku oder im Hintergrund-Tab wartet sie). Ich rechne und lade nichts selbst.";
const OUTCOME_NOTE = "Der Ausgang ist der Weg des Kurses nach dem Signal (Marken des Signals, sonst Stopp 1,5 × ATR und Ziel 2 R), kein gebuchter Trade und ohne Gebühren, Slippage und Funding.";
const side = (e: SignalEvent): string => (e.side === "short" ? "Short" : "Long");
const what = (e: SignalEvent): string => `${stampText(e.at)} ${e.symbol || "Markt unbekannt"} ${side(e)} (${signalKindLabel(e)})`;

const oldest = (events: readonly SignalEvent[]): string => (events.length ? dayText(Math.min(...events.map((e) => e.at))) : "–");

/* ------------------------------------------------------------------ week / period list */

function listReply(rows: readonly InboxRow[], per: ReportPeriod, said: string | null, events: readonly SignalEvent[], env: ToolEnv): ToolReply {
  const mine = rows.filter((r) => r.entry && contains(per, r.event.at));
  const open = openAction(env, "Posteingang öffnen", INBOX);
  const label = `${per.label} (${per.range})`;
  if (!mine.length) {
    return reply({
      title: "Keine Signale in diesem Zeitraum",
      text: `In ${label}${said ? ` („${said}“)` : ""} hat die App keine Einstiegs-Signale festgehalten. Das archivierte Material reicht bis ${oldest(events)} zurück; Signale entstehen nur bei offener App.`,
      tone: "mute",
      actions: [open],
      followUps: ["Wie lange war die App letzten Monat offen?"],
    });
  }
  const by = (s: InboxRow["status"]): InboxRow[] => mine.filter((r) => r.status === s);
  const left = by("ausgelassen");
  const expired = by("abgelaufen");
  const running = mine.filter((r) => r.status === "neu" || r.status === "angesehen");
  const reasons = new Map<string, number>();
  for (const r of left) reasons.set(r.skipText ?? "?", (reasons.get(r.skipText ?? "?") ?? 0) + 1);
  const parts = [`${label}: ${plural(mine.length, "Einstiegs-Signal", "Einstiegs-Signale")} – ${by("gehandelt").length} gehandelt, ${left.length} bewusst ausgelassen, ${expired.length} abgelaufen ohne Vermerk, ${running.length} noch im Zeitfenster.`];
  if (left.length) parts.push(`Gründe, die du angegeben hast: ${[...reasons].map(([k, n]) => `${k} (${n}×)`).join(", ")}.`);
  const shown = [...left, ...expired].sort((a, b) => a.event.at - b.event.at).slice(0, 4);
  if (shown.length) parts.push(`Nicht gehandelt: ${shown.map((r) => `${what(r.event)}${r.skipText ? ` – ${r.skipText}` : " – kein Grund vermerkt"}`).join("; ")}${left.length + expired.length > shown.length ? "; …" : ""}.`);
  parts.push("Ob ein Signal bewusst ausgelassen oder nur übersehen wurde, weiß die App nur dort, wo du „Ausgelassen – Grund“ gesetzt hast.");
  return reply({
    title: left.length + expired.length ? `${plural(left.length + expired.length, "Signal", "Signale")} nicht gehandelt` : "Alle Signale gehandelt oder noch offen",
    text: parts.join(" "),
    facts: [fact("Signale", String(mine.length), "fg", mine.length), fact("Gehandelt", String(by("gehandelt").length), "win", by("gehandelt").length), fact("Ausgelassen", String(left.length), "fg", left.length), fact("Abgelaufen", String(expired.length), expired.length ? "loss" : "fg", expired.length)],
    actions: [open],
    followUps: ["Welche verpassten Signale hatten das Ziel zuerst?", "Wie ist die Trefferquote meiner Box-Setups?"],
  });
}

/* ------------------------------------------------------------------ outcomes of the missed signals */

function outcomeReply(events: readonly SignalEvent[], outcomes: OutcomeMap, trades: ToolEnv["data"]["closed"], env: ToolEnv, per: ReportPeriod | null, all: boolean): ToolReply {
  const rep = matchSignals(events, trades, env.now);
  const base = all ? rep.rows : rep.missed;
  const rows = base.filter((r) => !per || contains(per, r.event.at));
  const scope = all ? "Signalen" : "nicht gehandelten Signalen";
  const open = openAction(env, "Verpasste Chancen öffnen", MISSED);
  if (!rows.length) return reply({ title: all ? "Keine Signale" : "Keine verpassten Signale", text: `Es gibt ${per ? `in ${per.label}` : "im Archiv"} keine ${scope} mit Richtung, die ich auswerten könnte.`, tone: "mute", actions: [open] });
  const o = rows.map((r) => ({ r, o: outcomes.get(r.event.id) }));
  const target = o.filter((x) => x.o?.kind === "target");
  const stop = o.filter((x) => x.o?.kind === "stop");
  const openN = o.filter((x) => x.o?.kind === "open").length;
  const unusableN = o.filter((x) => x.o?.kind === "unusable").length;
  const unfinished = openN + unusableN;
  const missing = o.filter((x) => !x.o).length;
  const evaluated = target.length + stop.length + openN;
  if (missing === rows.length) {
    return reply({
      title: "Noch keine Ausgänge ausgewertet",
      text: `Stand: 0 von ${plural(rows.length, all ? "Signal" : "nicht gehandeltem Signal", all ? "Signalen" : "nicht gehandelten Signalen")} ausgewertet. ${AUTO_NOTE}`,
      tone: "mute",
      actions: [open],
    });
  }
  const decided = target.length + stop.length;
  const ci = decided ? wilson(target.length, decided) : null;
  const parts = [`Stand: ${evaluated} von ${plural(rows.length, all ? "Signal" : "nicht gehandeltem Signal", all ? "Signalen" : "nicht gehandelten Signalen")}${per ? ` in ${per.label}` : ""} ausgewertet – ${target.length} erreichten das Ziel zuerst und ${stop.length} den Stopp zuerst; ${openN} sind noch offen, ${unusableN} nicht auswertbar${missing ? `, ${missing} noch ohne Ergebnis (die App wertet automatisch weiter aus)` : ""}.`];
  if (ci && decided) parts.push(`Von den ${decided} entschiedenen waren das ${pctText(target.length / decided)} (80-%-Bereich ${range(ci.lo, ci.hi)}).`);
  if (target.length) {
    const top = target.sort((a, b) => b.r.event.at - a.r.event.at).slice(0, 3);
    parts.push(`Ziel zuerst: ${top.map((x) => `${what(x.r.event)} ${rText(x.o!.r)}${x.o!.basis === "standard" ? " (Standardmaß)" : ""}`).join("; ")}${target.length > top.length ? "; …" : ""}.`);
  }
  parts.push(OUTCOME_NOTE);
  return reply({
    title: target.length ? `${plural(target.length, "Signal", "Signale")} mit Ziel zuerst` : "Kein Signal mit Ziel zuerst",
    text: parts.join(" "),
    facts: [fact("Ziel zuerst", String(target.length), "win", target.length), fact("Stopp zuerst", String(stop.length), stop.length ? "loss" : "fg", stop.length), fact("Entschieden", String(decided), "fg", decided), fact("Offen", String(missing + unfinished), "mute", missing + unfinished)],
    actions: [open],
    followUps: ["Wie ist die Trefferquote meiner Box-Setups?"],
  });
}

/* ------------------------------------------------------------------ balance (hit rate) */

function balanceReply(events: readonly SignalEvent[], outcomes: OutcomeMap, trades: ToolEnv["data"]["closed"], env: ToolEnv, t: readonly string[]): ToolReply {
  const bal = buildBalance(events, trades, outcomes, env.now, "type");
  const open = openAction(env, "Signalbilanz öffnen", BALANCE);
  if (!bal.signals) return reply({ title: "Keine Einstiegs-Signale", text: `Im Archiv liegt kein Einstiegs-Signal mit Richtung, aus dem sich eine Bilanz ergäbe. ${EMPTY_ARCHIVE}`, tone: "mute", actions: [open] });
  const box = has(t, "box");
  const entry = has(t, "einstiegs", "einstiegscheck");
  const key = has(t, "schluesselmarke", "marke", "level");
  const picked = bal.rows.filter((r) => (box ? r.key.startsWith("Box") : entry ? r.key === "Einstiegs-Check" : key ? r.key.startsWith("Schlüsselmarke") : false));
  const rows = picked.length ? picked : box || entry || key ? [] : [bal.total];
  const subject = box ? "Box-Setups" : entry ? "dem Einstiegs-Check" : key ? "Schlüsselmarken" : "allen Einstiegs-Signalen";
  if (!rows.length) return reply({ title: "Keine passenden Signale", text: `Im Archiv gibt es kein Signal dieser Art (${bal.rows.map((r) => `${r.label}: ${r.n}`).join(", ")}). ${EMPTY_ARCHIVE.split(". ")[0]}.`, tone: "mute", actions: [open] });
  const parts: string[] = [];
  for (const r of rows) {
    const flow = `${plural(r.n, "Signal", "Signale")} (${r.traded} gehandelt, ${r.left} bewusst ausgelassen, ${r.expired} abgelaufen, ${r.running} noch im Zeitfenster)`;
    if (r.decided) parts.push(`${r.label}: ${flow}. Von ${r.decided} entschiedenen erreichten ${r.target} das Ziel zuerst, ${r.stop} den Stopp: Trefferquote ${pctText(r.hitRate)} (80-%-Bereich ${r.hitCi ? range(r.hitCi.lo, r.hitCi.hi) : "–"}), Ø ${rText(r.avgR)}${r.rCi ? ` (Bereich ${rText(r.rCi.lo)} bis ${rText(r.rCi.hi)})` : ""}. Stichprobe: ${r.level}. Stand: ${r.target + r.stop + r.open} von ${r.n} ausgewertet${r.pending ? `, ${r.pending} noch ohne Ergebnis` : ""}.`);
    else parts.push(`${r.label}: ${flow}. ${r.pending === r.n ? `Stand: 0 von ${r.n} ausgewertet. ${AUTO_NOTE}` : `Noch kein entschiedener Ausgang – Stand: ${r.open} von ${r.n} ausgewertet, aber noch offen; ${r.unusable} nicht auswertbar, ${r.pending} noch ohne Ergebnis (die App wertet automatisch weiter aus).`}`);
  }
  parts.push(OUTCOME_NOTE, "Die Trefferquote allein sagt nichts über den Gewinn – dafür steht das Ø R daneben.");
  const main = rows[0]!;
  return reply({
    title: main.decided ? `Trefferquote bei ${subject}: ${pctText(main.hitRate)}` : `Trefferquote bei ${subject}: noch offen`,
    text: parts.join(" "),
    facts: [fact("Signale", String(main.n), "fg", main.n), fact("Entschieden", String(main.decided), "fg", main.decided), fact("Trefferquote", main.decided ? pctText(main.hitRate) : "–", "fg", main.hitRate), fact("Ø R", rText(main.avgR), tone(main.avgR), main.avgR)],
    actions: [open],
    followUps: ["Welche verpassten Signale hatten das Ziel zuerst?"],
  });
}

export async function signalsAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const src = await signalsSource(env);
  const trades = env.list ?? env.data.closed;
  const t = tokensOf(norm);
  const open = openAction(env, "Posteingang öffnen", INBOX);
  if (!src.events.length) return reply({ title: "Noch keine Signale festgehalten", text: EMPTY_ARCHIVE, tone: "mute", actions: [open] });
  const mention = periodMentioned(norm, env.now);
  const missedWords = has(t, "verpasst", "ausgelassen", "auslassen", "uebersehen", "gehandelt");
  if (has(t, "trefferquote", "quote", "treffer", "bilanz", "hitrate", "erfolg", "wie gut")) return balanceReply(src.events, src.outcomes, trades, env, t);
  if (has(t, "ziel", "zuerst", "stopp", "ausgang", "haette", "gewinner", "gewonn")) return outcomeReply(src.events, src.outcomes, trades, env, mention?.period ?? null, !missedWords);
  const inbox = buildInbox(src.events, trades, env.now);
  return listReply(inbox.rows, mention?.period ?? periodOf("week", env.now), mention?.said ?? null, src.events, env);
}

/* ------------------------------------------------------------------ quality: app presence and alert delay */

export async function qualityAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const src = await signalsSource(env);
  const rep = qualityReport({ now: env.now, events: src.events, log: src.log, presence: src.presence, gaps: null });
  const t = tokensOf(norm);
  const wantsDelay = has(t, "verspaet", "verzoeger", "=delay", "puenktlich", "zuverlaessig", "zustell", "minuten");
  const wantsPresence = has(t, "offen", "geoeffnet", "lief", "laeuft", "geschlossen", "ausfall", "unterbroch", "online", "anteil", "lange", "=app");
  const both = wantsDelay === wantsPresence;
  const open = openAction(env, "Daten- und Alarmqualität öffnen", QUALITY);
  const parts: string[] = [];
  const facts = [];
  let title = "Daten- und Alarmqualität";

  if (wantsPresence || both) {
    const p = rep.presence;
    if (!p.known) parts.push("Wie lange die App offen war, ist unbekannt: Die Aufzeichnung (ein Herzschlag alle 30 Sekunden, solange ein Tab die App offen hat) beginnt erst jetzt und lässt sich nicht rückwirkend füllen.");
    else {
      parts.push(`In den letzten ${rep.windowDays} Tagen${p.since != null && p.since > rep.from ? ` (die Aufzeichnung beginnt erst am ${dayText(p.since)})` : ""} war die App ${pctText(p.share)} der Zeit offen (${durationText(p.openMs)} von ${durationText(p.spanMs)}). Gerechnet wird über 30 Tage, nicht über einen Kalendermonat.`);
      if (p.outageCount) {
        const last = p.outages[0]!;
        parts.push(`${plural(p.outageCount, "Unterbrechung", "Unterbrechungen")} von mindestens 10 Minuten, zusammen ${durationText(p.outageMs)}; die jüngste: ${stampText(last.from)} bis ${stampText(last.to)} (${durationText(last.ms)}). In dieser Zeit gab es keine Alarme.`);
      } else parts.push("Keine Unterbrechung von mindestens 10 Minuten.");
      facts.push(fact("App offen", pctText(p.share), "fg", p.share), fact("Unterbrechungen", String(p.outageCount), p.outageCount ? "loss" : "fg", p.outageCount));
    }
    title = p.known ? `App ${pctText(p.share)} der Zeit offen` : "Offenzeit unbekannt";
  }

  if (wantsDelay || both) {
    const n = rep.delays.reduce((s, r) => s + r.n, 0);
    const slow = rep.delays.reduce((s, r) => s + r.slow, 0);
    if (!n) parts.push("Verspätung: Noch kein Alarm mit bekanntem Kerzenschluss gespeichert – sie lässt sich erst danach lesen.");
    else {
      parts.push(`${slow ? "Ja" : "Nein"}: ${slow} von ${plural(n, "Alarm", "Alarmen")} (${pctText(slow / n)}) kamen mehr als ${Math.round(SLOW_ALERT_MS / 60_000)} Minuten nach dem Schluss der Kerze, auf der das Signal beruht (letzte ${rep.windowDays} Tage). ${rep.delays.map((r) => `${r.label}: ${r.slow} von ${r.n}, Median ${durationText(r.median)}, längster ${durationText(r.max)}`).join("; ")}. Beim Einstiegs-Check sind 60 Sekunden Wartezeit enthalten; eine falsch gehende Geräteuhr zeigt sich hier ebenfalls als Verspätung.`);
      facts.push(fact("Spät (> 5 Min)", String(slow), slow ? "loss" : "fg", slow), fact("Alarme gemessen", String(n), "fg", n));
    }
    if (!both) title = n ? (slow ? `${plural(slow, "Alarm", "Alarme")} später als 5 Minuten` : "Keine Alarme über 5 Minuten Verspätung") : "Verspätung nicht messbar";
  }
  parts.push("Alarme laufen nur bei offener App; es gibt keine Überwachung auf einem Server.");
  return reply({ title, text: parts.join(" "), facts, tone: "fg", actions: [open], followUps: both ? [] : [wantsDelay ? "Wie lange war die App letzten Monat offen?" : "Gab es Alarme mit mehr als 5 Minuten Verspätung?"] });
}
