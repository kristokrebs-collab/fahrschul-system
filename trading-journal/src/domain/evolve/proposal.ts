/**
 * From a tested variant to a "Verbesserungsvorschlag" (pure): the plain-language list of changes (version 2 against version 1),
 * the numbers on the test windows next to the current version's, the confirmation window, the multiple-testing probability,
 * the plateau check, the expectation the live test will be held against, and the WARNINGS – every weakness is said, not
 * hidden. A proposal never changes anything by itself; the user decides per proposal.
 */
import { diffConfigs } from "../lab/versions";
import { customKey } from "../lab/rules/tree";
import type { CustomConfig, TfId } from "../lab/rules/types";
import { isPlateau } from "./plateau";
import { WARN_TRADES } from "./score";
import type { Evaluation, Expected, HoldoutPair, MutationKind, Overfit, Plateau, ProposalDraft, ProposalWindowRow, WinMetrics, WindowMs } from "./types";

const de = (v: number, d = 2): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const pct = (v: number, d = 0): string => `${de(v * 100, d)} %`;

/** The change list without the name line (the optimiser never renames). */
export function changeLines(base: CustomConfig, cand: CustomConfig): string[] {
  return diffConfigs(base, cand).filter((l) => !l.startsWith("Name:"));
}

/** The expectation a live test is held against: Ø R of the test windows and the net result per 30 days (in percent of the capital). */
export function expectedOf(test: WinMetrics, testDays: number): Expected {
  return { avgR: test.avgR, avgRCI: test.avgRCI, pctPer30d: testDays > 0 ? ((test.netPct * 100) / testDays) * 30 : null, n: test.n, days: testDays };
}

export interface WarnInput {
  test: { base: WinMetrics; cand: WinMetrics };
  train: { cand: { n: number; avgR: number | null } };
  holdout: HoldoutPair | null;
  overfit: Overfit;
  plateau: Plateau | null;
  freedom: { base: number; cand: number };
  windowsBetter: number;
  folds: number;
  /** number of lines of the change list */
  changes: number;
}

/** Every weakness of a proposal in one sentence each, strongest first. */
export function proposalWarnings(w: WarnInput): string[] {
  const out: string[] = [];
  const o = w.overfit;
  const total = o.trialsRun + Math.round(o.trialsPrior);
  if (o.p >= 0.5) out.push(`Wahrscheinlich Zufall: Nach ${total} getesteten Varianten ist ein so gutes Ergebnis zu ${pct(o.p)} allein durch Glück zu erwarten.`);
  else if (o.p >= 0.2) out.push(`Nicht klar vom Zufall zu trennen: Nach ${total} getesteten Varianten ist ein so gutes Ergebnis noch zu ${pct(o.p)} allein durch Glück zu erwarten.`);
  const n = w.test.cand.n;
  if (n < WARN_TRADES) out.push(`Kleine Stichprobe: nur ${n} Trades in den Testfenstern (ab ${WARN_TRADES} wird es belastbarer).`);
  if (w.test.cand.incomeR >= 0.5) out.push(`Funding-Einnahmen von ${de(w.test.cand.incomeR, 1)} R wurden nicht mitgezählt – der Vorschlag sitzt offenbar lange in einer Richtung, die Funding bekommt. Das ist eine Annahme, die sich ändern kann.`);
  const top = w.test.cand.best3Share;
  if (top != null && w.test.cand.n >= 6 && top > 0.6) out.push(`Hängt an wenigen Trades: die drei besten machen ${pct(top)} des Gewinns aus.`);
  if (!w.plateau) out.push("Die Nachbarwerte konnten nicht geprüft werden (keine Zahl zum Verschieben). Ob es ein Plateau oder eine Spitze ist, ist offen.");
  else if (!isPlateau(w.plateau)) out.push(`Eher eine Spitze als ein Plateau: nur ${w.plateau.ok} von ${w.plateau.checked} Nachbarwerten sind ähnlich gut.`);
  const h = w.holdout;
  if (!h) out.push("Das Bestätigungsfenster konnte nicht gerechnet werden.");
  else {
    if (h.cand.n < 5) out.push(`Im Bestätigungsfenster (nie zur Auswahl benutzt) gab es nur ${h.cand.n} Trades – das sagt wenig.`);
    else if (h.cand.avgR != null && h.cand.avgR < 0) out.push(`Im Bestätigungsfenster (nie zur Auswahl benutzt) ist der Vorschlag negativ: Ø ${de(h.cand.avgR)} R bei ${h.cand.n} Trades.`);
    else if (h.cand.avgR != null && h.base.avgR != null && h.cand.avgR < h.base.avgR) out.push(`Im Bestätigungsfenster (nie zur Auswahl benutzt) ist der Vorschlag nicht besser als die jetzige Version: Ø ${de(h.cand.avgR)} R gegen ${de(h.base.avgR)} R.`);
  }
  const need = Math.ceil(w.folds * 0.75);
  if (w.windowsBetter < need) out.push(`Nur in ${w.windowsBetter} von ${w.folds} Testfenstern besser als die jetzige Version.`);
  if (w.freedom.cand > w.freedom.base) out.push(`Mehr Freiheitsgrade: ${w.freedom.cand} statt ${w.freedom.base}. Jede zusätzliche Stellschraube macht es leichter, die Vergangenheit nachzumalen.`);
  if (w.changes > 4) out.push(`Viele Änderungen auf einmal (${w.changes}): je mehr gleichzeitig anders ist, desto schwerer ist zu sagen, welche davon etwas bringt.`);
  const t = w.train.cand;
  if (t.n >= 5 && t.avgR != null && t.avgR < 0 && (w.test.cand.avgR ?? 0) > 0) out.push(`Vor den Testfenstern war der Vorschlag negativ (Ø ${de(t.avgR)} R bei ${t.n} Trades): der Vorteil könnte an der Marktphase der Testfenster hängen.`);
  return out;
}

export interface DraftArgs {
  sid: string;
  strategyName: string;
  symbol: string;
  interval: TfId;
  seed: number;
  baseConfig: CustomConfig;
  baseEval: Evaluation;
  cand: { config: CustomConfig; ev: Evaluation; kinds: MutationKind[] };
  windows: { tests: WindowMs[] };
  holdout: HoldoutPair | null;
  overfit: Overfit;
  plateau: Plateau | null;
  baseScoreEff: number;
  testDays: number;
  dataTo: number;
  folds: number;
}

export function buildDraft(a: DraftArgs): ProposalDraft {
  const { baseEval: b, cand: c } = a;
  const rows: ProposalWindowRow[] = a.windows.tests.map((w, k) => ({ from: w.from, to: w.to, baseN: b.perWindow[k]!.n, baseSumR: b.perWindow[k]!.sumR, candN: c.ev.perWindow[k]!.n, candSumR: c.ev.perWindow[k]!.sumR }));
  const windowsBetter = rows.filter((r) => r.candSumR > r.baseSumR).length;
  const freedom = { base: b.freedom, cand: c.ev.freedom };
  const test = { base: b.test, cand: c.ev.test };
  const train = { base: b.train, cand: c.ev.train };
  const changes = changeLines(a.baseConfig, c.config);
  const warnings = proposalWarnings({ test, train, holdout: a.holdout, overfit: a.overfit, plateau: a.plateau, freedom, windowsBetter, folds: a.folds, changes: changes.length });
  return {
    sid: a.sid,
    strategyName: a.strategyName,
    symbol: a.symbol,
    interval: a.interval,
    seed: a.seed,
    baseKey: customKey(a.baseConfig),
    baseConfig: a.baseConfig,
    config: c.config,
    key: c.ev.key,
    kinds: c.kinds,
    changes,
    windows: rows,
    test,
    train,
    holdout: a.holdout,
    score: c.ev.score ?? 0,
    baseScore: b.score,
    windowsBetter,
    overfit: a.overfit,
    plateau: a.plateau,
    freedom,
    expected: expectedOf(c.ev.test, a.testDays),
    warnings,
    dataTo: a.dataTo,
  };
}
