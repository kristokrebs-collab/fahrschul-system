/**
 * `compareFit(strategy, profile)` – „Passt zu dir?“ (F49): what a tested idea demands, held against what the trader's own
 * journal shows, as agreements and frictions WITH numbers. Pure and deterministic.
 *
 * What it deliberately does not do: no total score, no „geeignet / ungeeignet“, no advice to trade or not to trade. Every
 * statement names both samples; a statement whose sample is too small is „nicht beurteilbar“ with the reason, never a
 * guess. Frictions are observations („verlangt“ vs „du …“), not predictions of how the trader would behave.
 */
import { expectedLongestLosingStreak } from "../analytics/streaks";
import { holdLabel } from "../excursion";
import type { SessionKey } from "../insights/time";
import { FIT_RULES, MIN_DRAWDOWN, MIN_HOLD, MIN_JOURNAL, MIN_PLAN, MIN_RISK, MIN_STRATEGY, MIN_WINDOW, type FitEvidence, type FitItem, type FitKind, type FitReport, type JournalProfile, type Share, type StrategyFacts } from "./types";

const de = (x: number, d: number): string => Math.abs(x).toFixed(d).replace(".", ",");
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const range = (s: Share): string => `${Math.round(s.lo * 100)}–${Math.round(s.hi * 100)} %`;
const trades = (n: number): string => `${n} Trade${n === 1 ? "" : "s"}`;

const WEEKDAY_NAME = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
const SESSION_NAME: Readonly<Record<SessionKey, string>> = { asia: "die Asien-Session (00–07 UTC)", london: "die London-Session (07–13 UTC)", ny: "die New-York-Session (13–21 UTC)", late: "die späte Session (21–24 UTC)", weekend: "das Wochenende (Sa/So UTC)" };
const SESSIONS: readonly SessionKey[] = ["asia", "london", "ny", "late", "weekend"];

const item = (id: FitItem["id"], title: string, kind: FitKind, text: string, evidence: FitEvidence[], caveat = ""): FitItem => ({ id, title, kind, text, evidence, caveat });
const unknown = (id: FitItem["id"], title: string, why: string): FitItem => item(id, title, "unknown", why, []);

function winRate(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Trefferquote";
  const ev: FitEvidence[] = [
    { label: "Idee", value: `${pct(s.win.share)} (${s.win.k} von ${s.win.n}, Spanne ${range(s.win)})` },
    { label: "Du", value: `${pct(j.win.share)} (${j.win.k} von ${j.win.n}, Spanne ${range(j.win)})` },
  ];
  const caveat = "Spanne = 80-%-Intervall der Trefferquote; bei kleiner Stichprobe ist sie breit.";
  if (s.win.hi < j.win.lo) return item("winRate", title, "friction", `Die Idee gewinnt seltener als du: ${pct(s.win.share)} der Trades gegen ${pct(j.win.share)} bei dir – die Spannen überlappen nicht. Mehr Verlierer pro Gewinner heißt mehr Verlusttrades zwischen den Gewinnern.`, ev, caveat);
  if (s.win.lo > j.win.hi) return item("winRate", title, "match", `Die Idee gewinnt häufiger als du: ${pct(s.win.share)} der Trades gegen ${pct(j.win.share)} bei dir – die Spannen überlappen nicht.`, ev, caveat);
  return item("winRate", title, "match", `Trefferquote im selben Bereich: ${pct(s.win.share)} bei der Idee, ${pct(j.win.share)} bei dir; die Spannen überlappen, ein belastbarer Unterschied ist nicht zu sehen.`, ev, caveat);
}

function hold(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Haltedauer";
  if (s.holdMedianMs == null) return unknown("hold", title, "Die Idee hat keine abgeschlossenen Trades mit Haltedauer.");
  if (j.hold.n < MIN_HOLD || j.hold.medianMs == null) return unknown("hold", title, `Von deinen Trades haben ${j.hold.n} eine Ausstiegszeit; ab ${MIN_HOLD} lässt sich deine übliche Haltedauer vergleichen.`);
  const a = Math.max(60_000, s.holdMedianMs);
  const b = Math.max(60_000, j.hold.medianMs);
  const ratio = Math.max(a, b) / Math.min(a, b);
  const ev: FitEvidence[] = [
    { label: "Idee (Median)", value: holdLabel(s.holdMedianMs) },
    { label: "Du (Median)", value: `${holdLabel(j.hold.medianMs)} · ${j.hold.n} Trades mit Ausstiegszeit` },
  ];
  if (ratio >= FIT_RULES.holdFactor) {
    const longer = a > b;
    return item("hold", title, "friction", `Haltedauer Median ${holdLabel(s.holdMedianMs)}; du schließt im Median nach ${holdLabel(j.hold.medianMs)}. Die Idee hält ${longer ? "länger" : "kürzer"} als du – etwa ${de(ratio, 1)}-fach.`, ev, `Verglichen werden Mediane; deine Zahl stammt aus ${j.hold.n} von ${j.n} Trades (nur die mit Ausstiegszeit).`);
  }
  return item("hold", title, "match", `Haltedauer im selben Bereich: Median ${holdLabel(s.holdMedianMs)} bei der Idee, ${holdLabel(j.hold.medianMs)} bei dir.`, ev, `Deine Zahl stammt aus ${j.hold.n} von ${j.n} Trades (nur die mit Ausstiegszeit).`);
}

function streak(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Verlustserien";
  const exp = expectedLongestLosingStreak(j.win.share, s.n);
  const ev: FitEvidence[] = [
    { label: "Idee: längste Serie", value: `${s.longestLosing} Verlusttrades (bei ${s.n} Trades)` },
    { label: "Du: längste Serie", value: `${j.longestLosing} Verlusttrades (bei ${j.n} Trades)` },
    { label: "Erwartung bei deiner Trefferquote", value: `≈ ${de(exp, 1)} bei ${s.n} Trades` },
  ];
  const caveat = "Die längste Serie wächst mit der Tradezahl: bei mehr Trades kommen längere Serien vor. Die Erwartung ist ein Näherungswert für unabhängige Trades.";
  if (s.longestLosing - j.longestLosing >= FIT_RULES.streakExtra) {
    return item("streak", title, "friction", `Die Idee verlangt im Test bis zu ${s.longestLosing} Verlusttrades in Folge auszuhalten; deine längste Serie waren ${j.longestLosing}.`, ev, caveat);
  }
  return item("streak", title, "match", `Die längste Verlustserie der Idee (${s.longestLosing}) liegt im Bereich deiner eigenen (${j.longestLosing}).`, ev, caveat);
}

function drawdown(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Drawdown-Tiefe";
  if (j.drawdown.n < MIN_DRAWDOWN) return unknown("drawdown", title, `Nur ${j.drawdown.n} deiner Trades haben ein R (Stop gesetzt); ab ${MIN_DRAWDOWN} lässt sich deine Drawdown-Tiefe vergleichen.`);
  const ev: FitEvidence[] = [
    { label: "Idee", value: `−${de(s.drawdownR, 1)} R${s.drawdownPct != null ? ` (−${de(s.drawdownPct, 1)} % des Kontos${s.riskPct != null ? ` bei ${de(s.riskPct, 1)} % Risiko je Trade` : ""})` : ""}` },
    { label: "Du", value: `−${de(j.drawdown.depthR, 1)} R (aus ${j.drawdown.n} Trades mit R)` },
  ];
  const caveat = "Tiefster Rückgang der aufsummierten R vom bisherigen Höchststand; er hängt von der Länge der Zeitreihe ab (längere Zeiträume enthalten tiefere Rückgänge).";
  if (s.drawdownR > j.drawdown.depthR * FIT_RULES.ddFactor && s.drawdownR - j.drawdown.depthR >= FIT_RULES.ddMinExtra) {
    return item("drawdown", title, "friction", `Der tiefste Rückgang der Idee im Test war −${de(s.drawdownR, 1)} R; dein tiefster im Journal −${de(j.drawdown.depthR, 1)} R.`, ev, caveat);
  }
  return item("drawdown", title, "match", `Der tiefste Rückgang der Idee (−${de(s.drawdownR, 1)} R) liegt im Bereich deines eigenen (−${de(j.drawdown.depthR, 1)} R).`, ev, caveat);
}

function frequency(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Handelsfrequenz";
  if (s.perWeek == null) return unknown("frequency", title, "Der Testzeitraum der Idee ist kürzer als eine Woche.");
  if (j.perWeek == null) return unknown("frequency", title, "Dein Journal umfasst weniger als zwei Wochen; so lässt sich keine Wochenfrequenz bestimmen.");
  const ev: FitEvidence[] = [
    { label: "Idee", value: `${de(s.perWeek, 1)} Trades pro Woche (${s.n} Trades in ${de(s.days / 7, 0)} Wochen)` },
    { label: "Du", value: `${de(j.perWeek, 1)} Trades pro Woche (${j.n} Trades in ${de(j.spanDays / 7, 0)} Wochen)` },
  ];
  const ratio = j.perWeek > 0 ? s.perWeek / j.perWeek : Infinity;
  if (ratio >= FIT_RULES.freqFactor) return item("frequency", title, "friction", `Die Idee handelt im Schnitt ${de(s.perWeek, 1)}-mal pro Woche, du ${de(j.perWeek, 1)}-mal – etwa ${de(ratio, 1)}-fach so oft.`, ev, "Dein Journal enthält nur Trades, die du eingetragen hast.");
  if (ratio <= 1 / FIT_RULES.freqFactor) return item("frequency", title, "friction", `Die Idee wartet länger auf Signale: ${de(s.perWeek, 1)} Trades pro Woche gegen ${de(j.perWeek, 1)} bei dir.`, ev, "Dein Journal enthält nur Trades, die du eingetragen hast.");
  return item("frequency", title, "match", `Handelsfrequenz im selben Bereich: ${de(s.perWeek, 1)} Trades pro Woche bei der Idee, ${de(j.perWeek, 1)} bei dir.`, ev, "Dein Journal enthält nur Trades, die du eingetragen hast.");
}

/** Time windows where the idea enters a lot and the trader hardly ever trades. */
function windows(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Zeitfenster";
  if (j.weekday.n < MIN_WINDOW) return unknown("window", title, `Mit ${j.weekday.n} Trades ist dein Zeitprofil zu grob; ab ${MIN_WINDOW} Trades vergleiche ich Wochentage und Sessions.`);
  const found: string[] = [];
  const ev: FitEvidence[] = [];
  // Mon–Fri apart (Sat / Sun are the „Wochenende“ session)
  for (const d of [1, 2, 3, 4, 5]) {
    const mine = j.weekday.share[d] ?? 0;
    const theirs = s.weekday[d] ?? 0;
    if (mine < FIT_RULES.rareShare && theirs >= FIT_RULES.heavyShare) {
      found.push(`${pct(theirs)} der Einstiege der Idee fallen auf ${WEEKDAY_NAME[d]}; von deinen Trades liegen ${pct(mine)} dort (${j.weekday.count[d] ?? 0} von ${j.weekday.n})`);
      ev.push({ label: WEEKDAY_NAME[d]!, value: `Idee ${pct(theirs)} · du ${pct(mine)}` });
    }
  }
  for (const k of SESSIONS) {
    const mine = j.session.share[k];
    const theirs = s.session[k];
    if (mine < FIT_RULES.rareShare && theirs >= FIT_RULES.heavyShare) {
      found.push(`${pct(theirs)} der Einstiege der Idee fallen auf ${SESSION_NAME[k]}; von deinen Trades liegen ${pct(mine)} dort (${j.session.count[k]} von ${j.session.n})`);
      ev.push({ label: SESSION_NAME[k].replace(/ \(.*\)$/, ""), value: `Idee ${pct(theirs)} · du ${pct(mine)}` });
    }
  }
  const caveat = `Zeiten in UTC. Als „selten“ gilt unter ${pct(FIT_RULES.rareShare)} deiner Trades, als „viel“ ab ${pct(FIT_RULES.heavyShare)} der Einstiege der Idee.`;
  if (found.length) return item("window", title, "friction", `${found.join(". ")}.`, ev, caveat);
  return item("window", title, "match", `Die Einstiege der Idee liegen in Zeitfenstern, in denen du auch handelst: kein Wochentag und keine Session, in der die Idee ab ${pct(FIT_RULES.heavyShare)} einsteigt und du unter ${pct(FIT_RULES.rareShare)} deiner Trades hast.`, [], caveat);
}

function risk(s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Risiko je Trade";
  if (s.riskPct == null) return unknown("risk", title, "Der Lauf nennt kein Risiko je Trade.");
  if (j.risk.n < MIN_RISK || j.risk.medianPct == null) return unknown("risk", title, `Bei ${j.risk.n} deiner Trades lässt sich das Risiko in Prozent des Startkapitals bestimmen (Stop und Startkapital nötig); ab ${MIN_RISK} vergleiche ich.`);
  const ev: FitEvidence[] = [
    { label: "Idee", value: `${de(s.riskPct, 2)} % je Trade` },
    { label: "Du (Median)", value: `${de(j.risk.medianPct, 2)} % des Startkapitals · ${j.risk.n} Trades` },
  ];
  const caveat = "Dein Risiko ist auf das Startkapital des Kontos bezogen (nicht auf den aktuellen Kontostand).";
  if (s.riskPct > j.risk.medianPct * FIT_RULES.riskFactor) return item("risk", title, "friction", `Der Test riskiert ${de(s.riskPct, 2)} % je Trade; du im Median ${de(j.risk.medianPct, 2)} %. Die Idee wäre mit deinem üblichen Risiko kleiner zu fahren – ihre Ergebnisse in R bleiben gleich, die in Geld nicht.`, ev, caveat);
  return item("risk", title, "match", `Das Risiko je Trade liegt im Bereich deines üblichen: ${de(s.riskPct, 2)} % beim Test, ${de(j.risk.medianPct, 2)} % im Median bei dir.`, ev, caveat);
}

function discipline(_s: StrategyFacts, j: JournalProfile): FitItem {
  const title = "Regeln einhalten";
  const d = j.discipline;
  const problems: string[] = [];
  const ev: FitEvidence[] = [{ label: "Trades mit Stop", value: `${pct(d.stopSet.share)} (${d.stopSet.k} von ${d.stopSet.n})` }];
  if (d.stopSet.share < FIT_RULES.stopShare) problems.push(`nur ${pct(d.stopSet.share)} deiner Trades haben einen Stop`);
  ev.push({ label: "Stop weiter weg gestellt", value: `${d.widened} von ${j.n} Trades` });
  if (d.widened >= 2 && d.widened / j.n >= FIT_RULES.widenedShare) problems.push(`bei ${d.widened} von ${j.n} Trades hast du den Stop weiter weg gestellt`);
  let planNote = "";
  if (d.followed.n >= MIN_PLAN) {
    ev.push({ label: "Plan befolgt (laut dir)", value: `${pct(d.followed.share)} (${d.followed.k} von ${d.followed.n} Angaben)` });
    if (d.followed.share < FIT_RULES.planShare) problems.push(`nur ${pct(d.followed.share)} deiner Trades hast du selbst als plangemäß markiert`);
  } else {
    planNote = ` Zu „Plan befolgt“ liegen nur ${d.followed.n} Angaben vor – das bleibt außen vor.`;
  }
  const base = "Der Test setzt jedes Signal um, mit festem Stop, der nie weiter weg wandert.";
  const caveat = "Aus deinen eigenen Eintragungen und den Verhaltens-Erkennungen des Coaches; ein Befund beschreibt vergangene Trades, keine Zukunft.";
  if (problems.length) return item("discipline", title, "friction", `${base} Bei dir: ${problems.join("; ")}.${planNote}`, ev, caveat);
  return item("discipline", title, "match", `${base} Bei dir: ${pct(d.stopSet.share)} der Trades mit Stop, ${d.widened === 0 ? "kein Stop weiter weg gestellt" : `${d.widened} von ${j.n} Trades mit weiter weg gestelltem Stop`}.${planNote}`, ev, caveat);
}

export function compareFit(strategy: StrategyFacts | null, profile: JournalProfile): FitReport {
  if (profile.n === 0) return { status: "journalNone", reason: "Dein Journal enthält noch keinen abgeschlossenen Trade. Ohne eigene Trades gibt es nichts, womit sich eine Idee vergleichen ließe.", strategy, profile, items: [] };
  if (profile.n < MIN_JOURNAL) return { status: "journalFew", reason: `Dein Journal hat ${trades(profile.n)} abgeschlossen. Ab ${MIN_JOURNAL} bilde ich ein Profil – darunter wären die Zahlen Zufall.`, strategy, profile, items: [] };
  if (!strategy || strategy.n < MIN_STRATEGY) return { status: "strategyFew", reason: `Der Lauf hat ${strategy ? trades(strategy.n) : "keine Trades"}. Ab ${MIN_STRATEGY} Trades vergleiche ich ihn mit deinem Profil.`, strategy, profile, items: [] };
  return {
    status: "ok",
    reason: null,
    strategy,
    profile,
    items: [winRate(strategy, profile), hold(strategy, profile), streak(strategy, profile), drawdown(strategy, profile), frequency(strategy, profile), windows(strategy, profile), risk(strategy, profile), discipline(strategy, profile)],
  };
}

export { MIN_DRAWDOWN, MIN_HOLD, MIN_JOURNAL, MIN_STRATEGY, MIN_WINDOW };
