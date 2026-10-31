/**
 * German wording of the Zeitmaschine (pure): number formats, the verdict, the comparison text, the notes and the plain-language
 * summary lines. The same functions feed the card, the journal sheet and the assistant, so the words never drift apart. Every
 * figure comes from the result; nothing here estimates anything.
 */
import { slippageText } from "../backtest/slippage";
import { triggerText } from "./plan";
import type { TmCompare, TmCompareRow, TmHistory, TmNote, TmPlan, TmResult, TmSim, TmVerdict } from "./types";
import { TM_INTERVAL_TEXT, TM_SEC, MIN_EVENTS, MIN_SLOT_BARS, type TmInterval } from "./types";

const f1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const MINUS = "−";
/** "1,24" with the sign of `v`; a value that rounds to zero carries none. */
const sgn = (s: string, v: number): string => (/^0(,0+)?$/.test(s) ? s : v < 0 ? MINUS + s : "+" + s);

/** 0,336 → "33,6 %" */
export const pc = (p: number): string => `${f1.format(p * 100)} %`;
/** 0,336 → "34 %" */
export const pc0 = (p: number): string => `${f0.format(p * 100)} %`;
/** 1,236 → "+1,24 R", −1 → "−1,00 R" */
export const rr = (v: number): string => `${sgn(f2.format(Math.abs(v)), v)} R`;
/** 2 → "2,0 R" (a plain multiple, no sign) */
export const rPlain = (v: number): string => `${f1.format(v)} R`;
export const count = (n: number): string => f0.format(n);

/** Candles → "12 Kerzen (≈ 12 Std.)". */
export function durationText(bars: number, interval: TmInterval): string {
  const sec = bars * TM_SEC[interval];
  const unit = sec >= 2 * 86_400 ? `${f1.format(sec / 86_400)} Tage` : sec >= 3600 * 2 ? `${f1.format(sec / 3600)} Std.` : `${f0.format(sec / 60)} Min.`;
  return `${count(bars)} ${bars === 1 ? "Kerze" : "Kerzen"} (≈ ${unit})`;
}

export function planLine(p: TmPlan, symbol: string, interval: TmInterval): string {
  const px = (v: number): string => v.toLocaleString("de-DE", { maximumFractionDigits: v >= 1000 ? 2 : v >= 1 ? 4 : 8 });
  return `${symbol} · ${p.side === "long" ? "Long" : "Short"} · Einstieg ${px(p.entry)} · Stop ${px(p.stop)} · Ziel ${px(p.target)}${Math.abs(p.entry - p.stop) > 0 ? ` (${rPlain(Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop))})` : ""} · Kerzen: ${TM_INTERVAL_TEXT[interval]}`;
}

/* ------------------------------------------------------------------------------------------------ verdict */

/** Points a share must differ from its break-even (as shares of the runs that hit a side) to count as a lean / as strong. */
export const LEAN = 0.05;
export const STRONG = 0.15;
const MIN_DECIDED = 30;

/**
 * One honest line from the numbers. It looks only at the runs that hit one side (target or stop) and asks how often the target
 * came first. A bigger target needs to win less often to break even: 1 in (1 + R) – 50 % at 1 R, 33 % at 2 R, 25 % at 3 R.
 * Within 5 points of that: "Nahe an einer Münze" (1 R) / "Nahe am Break-even" (other R); 5–15 points: leans; 15 and more: strongly.
 */
export function verdictOf(sim: TmSim, targetR: number): TmVerdict {
  const hit = sim.target.k + sim.stop.k;
  const none = (text: string): TmVerdict => ({ id: "none", tone: "mute", text, lines: [], decided: null });
  if (sim.runs < 100) return none("Zu wenige Läufe für eine Einschätzung.");
  if (hit < MIN_DECIDED) return none(`Nur ${count(hit)} von ${count(sim.runs)} Läufen erreichten Ziel oder Stop – das reicht nicht für eine Einschätzung.`);
  const share = sim.target.k / hit;
  const needs = 1 / (1 + targetR);
  const diff = share - needs;
  const abs = Math.abs(diff);
  const both = `Ziel zuerst ${pc(sim.target.p)}, Stop zuerst ${pc(sim.stop.p)}`;
  const need = `Bei ${rPlain(targetR)} Ziel muss es in ${pc0(needs)} der entschiedenen Läufe zuerst kommen – es waren ${pc0(share)}`;
  let id: TmVerdict["id"];
  let tone: TmVerdict["tone"];
  let text: string;
  if (abs < LEAN) {
    const coin = Math.abs(targetR - 1) < 0.05;
    id = coin ? "coin" : "breakeven";
    tone = "mute";
    text = coin ? `Nahe an einer Münze: ${both}.` : `Nahe am Break-even: ${both}. ${need}.`;
  } else if (abs < STRONG) {
    id = diff > 0 ? "target" : "stop";
    tone = diff > 0 ? "win" : "loss";
    text = `${diff > 0 ? "Neigt zum Ziel" : "Neigt zum Stop"}: ${both}. ${need}.`;
  } else {
    id = diff > 0 ? "strongTarget" : "strongStop";
    tone = diff > 0 ? "win" : "loss";
    text = `${diff > 0 ? "Deutlich zum Ziel" : "Deutlich zum Stop"}: ${both}. ${need}.`;
  }
  const lines: string[] = [];
  const neither = sim.neither.p;
  if (neither > 0.4) lines.push(`${pc0(neither)} der Läufe erreichten weder Ziel noch Stop (Zeitstopp nach ${count(sim.horizon)} Kerzen) – über diese entscheidet der Kurs am Ende der Sitzung.`);
  const mean = sim.expectancy.mean;
  const lean = diff > 0 ? 1 : -1;
  if (abs >= LEAN && Math.sign(mean) === -lean && Math.abs(mean) >= 0.005) lines.push(`Der Erwartungswert (${rr(mean)} nach Kosten) zeigt in die andere Richtung als die Neigung – das machen die Läufe ohne Treffer und die Kosten (Ø ${f2.format(sim.costR)} R je Trade).`);
  else if (sim.expectancy.lo <= 0 && sim.expectancy.hi >= 0) lines.push(`Der Erwartungswert (${rr(mean)}) lässt sich von null nicht unterscheiden: Spanne ${rr(sim.expectancy.lo)} bis ${rr(sim.expectancy.hi)}.`);
  return { id, tone, text, lines, decided: { share, needs } };
}

/* ------------------------------------------------------------------------------------------------ comparison */

/** The simulation lies outside the history's interval AND the gap is at least this big (shares / R). */
export const OFF_SHARE = 0.1;
export const OFF_R = 0.25;

const ROW_LABEL = { target: "Ziel zuerst", stop: "Stop zuerst", neither: "Weder noch", expectancy: "Erwartungswert" } as const;

export function compareOf(sim: TmSim, hist: TmHistory): TmCompare {
  const rows: TmCompareRow[] = [];
  const share = (id: "target" | "stop" | "neither"): void => {
    const s = sim[id];
    const h = hist[id];
    const has = hist.n >= MIN_EVENTS;
    const diff = has ? h.p - s.p : null;
    rows.push({ id, label: ROW_LABEL[id], sim: s.p, hist: hist.n > 0 ? h.p : null, diff, unit: "%", off: has && diff != null && Math.abs(diff) >= OFF_SHARE && (s.p < h.lo || s.p > h.hi) });
  };
  share("target");
  share("stop");
  share("neither");
  const he = hist.expectancy;
  const hasE = hist.n >= MIN_EVENTS && he != null;
  const dE = hasE ? he.mean - sim.expectancy.mean : null;
  rows.push({ id: "expectancy", label: ROW_LABEL.expectancy, sim: sim.expectancy.mean, hist: he ? he.mean : null, diff: dE, unit: "R", off: hasE && dE != null && Math.abs(dE) >= OFF_R && (sim.expectancy.mean < he.lo || sim.expectancy.mean > he.hi) });
  if (hist.n < MIN_EVENTS) {
    const reason = hist.n === 0 ? "Es gab in den vorhandenen Kerzen keinen früheren Vorfall – die Simulation steht allein." : `Nur ${count(hist.n)} frühere Vorfälle – verglichen wird ab ${MIN_EVENTS}. Mit so wenigen sind es Beispiele, kein Beleg.`;
    return { status: "unavailable", reason, rows, warn: false, text: reason };
  }
  const off = rows.filter((r) => r.off);
  const warn = off.length > 0;
  const text = warn
    ? `Warnung: Simulation und echte Vorfälle weichen stark voneinander ab (${off.map((r) => r.label).join(", ")}). Entweder verhält sich dieser Aufbau anders als neu gemischte Kerzen – oder die ${count(hist.n)} Vorfälle sind ein Zufallsausschnitt. Beide Zahlen mit Vorsicht lesen, keine ist eine Zusage.`
    : `Simulation und echte Vorfälle liegen innerhalb ihrer Unsicherheit beieinander (${count(hist.n)} Vorfälle).${hist.n < 50 ? " Das beweist keine Gleichheit: so wenige Vorfälle lassen nur grobe Unterschiede erkennen." : ""}`;
  return { status: "ok", reason: null, rows, warn, text };
}

/* ------------------------------------------------------------------------------------------------ notes */

export function notesOf(r: Pick<TmResult, "pool" | "sim" | "history" | "options" | "interval" | "plan" | "targetR">): TmNote[] {
  const out: TmNote[] = [];
  const { pool, sim, history, options } = r;
  if (pool.thinnest < MIN_SLOT_BARS) out.push({ id: "thin", level: "warn", text: `Dünne Datenbasis: zu manchen Tageszeiten gibt es nur ${count(pool.thinnest)} echte Kerzen als Vorbild (gewünscht: ${MIN_SLOT_BARS}). Mehr Verlauf macht die Simulation verlässlicher.` });
  if (options.vol === "history" && pool.volRatio != null && (pool.volRatio > 1.4 || pool.volRatio < 0.7)) {
    out.push({ id: "vol", level: "warn", text: `Die letzten Kerzen schwanken ${pool.volRatio > 1 ? "stärker" : "schwächer"} als im Schnitt der Historie (ATR-Verhältnis ${f2.format(pool.volRatio)}). Die Simulation nimmt hier den Durchschnitt der Historie, nicht die heutige Schwankung („Schwankung wie heute“ rechnet mit der heutigen).` });
  }
  if (options.vol === "now" && pool.volScale) {
    out.push({ id: "volNow", level: "info", text: `Die echten Kerzen sind auf die heutige Schwankung umgerechnet (Ø Faktor ${f2.format(pool.volScale.mean)}, Spanne ${f2.format(pool.volScale.min)}–${f2.format(pool.volScale.max)}): ruhige Phasen der Historie werden lauter, wilde ruhiger, der Rhythmus der Tageszeit bleibt.` });
  }
  const driftR = Math.abs(pool.driftPerBar * options.horizon * r.plan.entry) / Math.abs(r.plan.entry - r.plan.stop);
  if (options.drift === "keep" && driftR >= 0.25) out.push({ id: "drift", level: "info", text: `Die Historie ${pool.driftPerBar > 0 ? "stieg" : "fiel"} im Schnitt um ${f1.format(Math.abs(pool.driftPerBar * options.horizon) * 100)} % je Sitzung (≈ ${f2.format(driftR)} R) – dieser Trend fließt in die Simulation ein. „Trend entfernen“ zeigt den neutralen Fall.` });
  if (options.drift === "zero") out.push({ id: "drift0", level: "info", text: "Der Trend der Historie ist herausgerechnet (neutraler Markt): Kurse steigen und fallen im Mittel gleich viel." });
  if (sim.runs > 0 && sim.ambiguous / sim.runs >= 0.05) out.push({ id: "ambiguous", level: "info", text: `In ${pc0(sim.ambiguous / sim.runs)} der Läufe lagen Stop und Ziel in derselben Kerze – wie in der Backtest-Engine zählt dann der Stop (konservativ).` });
  if (sim.skipped > 0) out.push({ id: "skipped", level: "warn", text: `${count(sim.skipped)} Läufe konnte die Engine nicht handeln und ließ sie weg.` });
  if (history.openAtEnd > 0) out.push({ id: "openEnd", level: "info", text: `Ein Vorfall war am Ende der Kerzen noch offen und zählt nicht mit.` });
  if (history.n > 0 && history.n < MIN_EVENTS) out.push({ id: "fewEvents", level: "info", text: `Nur ${count(history.n)} frühere Vorfälle – zu wenig für Prozentwerte mit Aussagekraft.` });
  if (history.ambiguous > 0 && history.n > 0 && history.ambiguous / history.n >= 0.1) out.push({ id: "histAmbiguous", level: "info", text: `Bei ${count(history.ambiguous)} früheren Vorfällen lagen Stop und Ziel in derselben Kerze (Stop gezählt).` });
  return out;
}

/* ------------------------------------------------------------------------------------------------ summary lines */

/** The result in a few plain sentences (card summary, assistant quote). Numbers only from the result. */
export function summaryLines(r: TmResult): string[] {
  const s = r.sim;
  const h = r.history;
  const lines = [
    planLine(r.plan, r.symbol, r.interval),
    `${count(s.runs)} simulierte Sitzungen zu je ${durationText(s.horizon, r.interval)}, Seed ${r.seed}.`,
    `Ziel zuerst ${pc(s.target.p)} (${pc0(s.target.lo)}–${pc0(s.target.hi)}), Stop zuerst ${pc(s.stop.p)}, weder noch ${pc(s.neither.p)}${s.moved.k > 0 ? `, nachgezogener Stop ${pc(s.moved.p)}` : ""}.`,
    `Erwartungswert ${rr(s.expectancy.mean)} nach Kosten (95 %: ${rr(s.expectancy.lo)} bis ${rr(s.expectancy.hi)}), Median ${rr(s.cases.median)}, schlechtester Lauf ${rr(s.cases.worst)}, bester ${rr(s.cases.best)}.`,
  ];
  if (h.n > 0) lines.push(`Echte Vorfälle: ${count(h.n)} – ${count(h.target.k)} Ziel, ${count(h.stop.k)} Stop${h.expectancy ? `, Ø ${rr(h.expectancy.mean)}` : ""}.`);
  else lines.push("Echte Vorfälle: keine in den vorhandenen Kerzen.");
  lines.push(r.verdict.text, r.compare.text);
  return lines;
}

/* ------------------------------------------------------------------------------------------------ assumptions */

const f2n = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const day = (ms: number): string => new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** The costs the engine charged, in words. */
export function costText(c: TmResult["costs"]): string {
  const f = c.fees;
  const fee = `Gebühren: Taker ${f2n.format(f.takerBps)} bp (Einstieg, Stop, Zeitstopp), Maker ${f2n.format(f.makerBps)} bp (Ziel)`;
  const slip = `Slippage: ${slippageText(c.slippage)}`;
  const fund = c.funding.kind === "none" ? "kein Funding" : c.funding.kind === "flat" ? `Funding pauschal ${f2n.format(c.funding.ratePer8h * 100)} % je 8 Std. (Annahme, nicht die echte Historie)` : "Funding aus der echten Historie";
  return `${fee}; ${slip}; ${fund}.`;
}

/** What the numbers rest on and what they leave out – every line is a fact about this run or a named limit. */
export function assumptionsOf(r: TmResult, source?: string | null): string[] {
  const o = r.options;
  const p = r.pool;
  const out: string[] = [];
  out.push(`Kerzen: ${count(p.bars)} echte Kerzen (${TM_INTERVAL_TEXT[r.interval]} je Kerze) von ${day(p.fromMs)} bis ${day(p.toMs)}${source ? `, Quelle ${source}` : ""}. Nur geschlossene Kerzen.`);
  out.push(`Jede Sitzung: ${durationText(o.horizon, r.interval)} ab dem Einstieg (der Zeitstopp). Die erste Kerze öffnet auf dem Einstiegspreis und behält ihre Form.`);
  out.push(
    o.method === "block"
      ? `Gezogen werden Reihen von je ${o.blockLen} echten, aufeinanderfolgenden Kerzen (Block-Bootstrap) – so bleiben Phasen mit viel und mit wenig Bewegung erhalten.`
      : "Gezogen wird jede Kerze einzeln aus der Historie (Bootstrap) – Phasen mit viel oder wenig Bewegung bleiben nicht erhalten.",
  );
  out.push(`Tageszeit: zu jeder Tageszeit stammen die Kerzen aus derselben Tageszeit${p.slots > 1 ? ` (± ${p.radiusMax} Kerzen, mindestens ${MIN_SLOT_BARS} im Fenster; die dünnste Tageszeit hat ${count(p.thinnest)})` : " (Tageskerzen haben keine Tageszeit)"}.`);
  out.push(o.vol === "now" ? "Schwankung: die Kerzen sind auf die heutige Schwankung umgerechnet (Durchschnitt der Kerzenspanne des letzten Tages)." : "Schwankung: die Kerzen bleiben so groß, wie sie waren (nicht an heute angepasst).");
  out.push(o.drift === "zero" ? "Trend: der Trend der Historie ist herausgerechnet." : "Trend: der Trend der Historie fließt ein.");
  out.push("Regeln wie in der Backtest-Engine: Stop und Ziel werden je Kerze geprüft (nicht je Tick); liegen beide in einer Kerze, zählt der Stop; ein Stop, durch den der Kurs hinausspringt, füllt zur Eröffnung.");
  if (o.manage.breakEvenR != null || o.manage.trailAtr != null) {
    out.push(`Verwaltung: ${o.manage.breakEvenR != null ? `Stop auf den Einstieg ab +${f2n.format(o.manage.breakEvenR)} R` : ""}${o.manage.breakEvenR != null && o.manage.trailAtr != null ? "; " : ""}${o.manage.trailAtr != null ? `Trailing ${f2n.format(o.manage.trailAtr)} × ATR ab +${f2n.format(o.manage.trailFromR)} R` : ""} – entschieden am Kerzenschluss, wirksam ab der nächsten Kerze.`);
  }
  out.push(costText(r.costs));
  out.push("Alle Einstiege wie die Engine sie macht: Market-Fill mit Taker-Gebühr und Slippage (bei Limit-Aufträgen etwas zu pessimistisch).");
  out.push(`Echte Vorfälle: gesucht nach „${triggerText(o.trigger, r.relative.kind)}“; eine Position nach der anderen. Nach einem Limit-Einstieg kann das Ziel in derselben Kerze nicht zählen (die Reihenfolge von Hoch und Tief ist unbekannt), der Stop schon.`);
  out.push(`Seed ${r.seed}: gleicher Plan, gleiche Kerzen, gleicher Seed ergeben auf jedem Gerät dieselben Zahlen.`);
  out.push("Nicht enthalten: Nachrichten, Handelsstopps und Lücken außerhalb der Kerzen, Marktauswirkung großer Aufträge, Ausführung zwischen den Kerzen. Die Simulation mischt die Vergangenheit neu – sie kennt die Zukunft nicht.");
  return out;
}
