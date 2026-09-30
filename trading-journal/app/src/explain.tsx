// Detail-Erklärungen für jede Kennzahl: Definition, Formel mit deinen Zahlen, Aufschlüsselung, Einordnung.
import { fmt, tDate, type ETrade, type Group, type Settings, type Stats } from './lib';
import type { DetailData } from './ui';

const cls = (v: number | null | undefined) => (v == null || v === 0 ? 'text-fg' : v > 0 ? 'text-win' : 'text-loss');
const tradeLabel = (t: ETrade | null, cur: string) => (t ? `${fmt.signed(t.pnl)} ${cur} · ${fmt.date(tDate(t))}` : '–');
const NO_DATA = { tone: 'mute' as const, text: 'Noch keine abgeschlossenen Trades. Der Wert füllt sich mit deinem ersten Trade.' };

export type MetricKey = 'net' | 'trades' | 'winRate' | 'pf' | 'avgR' | 'maxDD' | 'exp' | 'projection' | 'streak';

export function metricDetail(key: MetricKey, st: Stats, settings: Settings): DetailData {
  const g = st.g, cur = settings.currency;
  switch (key) {
    case 'net': return {
      title: 'Netto-P&L',
      what: 'Summe aller realisierten Gewinne und Verluste deiner abgeschlossenen Trades, nach Gebühren. Offene Positionen zählen erst mit dem Schließen.',
      formula: <>Bruttogewinne {fmt.n2(g.gw)} − Bruttoverluste {fmt.n2(-g.gl)} = <b className={cls(g.net)}>{fmt.signed(g.net)} {cur}</b></>,
      rows: [
        ['Rendite aufs Startkapital', st.start ? fmt.pct(g.net / st.start) : '–', cls(g.net)],
        ['Kontostand jetzt', `${fmt.n0(st.balance)} ${cur}`],
        ['Bester Trade', tradeLabel(g.best, cur), 'text-win'],
        ['Schlechtester Trade', tradeLabel(g.worst, cur), 'text-loss'],
        ['Gezahlte Gebühren', `${fmt.n2(g.fees)} ${cur}`],
        ['Offene Positionen', String(st.open.length)],
      ],
      verdict: !g.n ? NO_DATA : g.net >= 0
        ? { tone: 'win', text: `Im Plus. ${g.best && g.net > 0 && (g.best.pnl || 0) / g.net > 0.5 ? 'Achtung: mehr als die Hälfte des Gewinns stammt aus einem einzigen Trade.' : 'Der Gewinn verteilt sich auf mehrere Trades.'}` }
        : { tone: 'loss', text: 'Im Minus. Schau in die Checklisten-Auswertung, welche Regeln bei den Verlusten gefehlt haben.' },
    };
    case 'trades': return {
      title: 'Trades',
      what: 'Anzahl abgeschlossener Trades im gewählten Konto. Offene Positionen sind separat gezählt und fließen noch nicht in die Statistik ein.',
      rows: [
        ['Abgeschlossen', String(g.n)], ['Offen', String(st.open.length)],
        ['Davon Long', String(st.closed.filter((t) => t.side !== 'short').length)], ['Davon Short', String(st.closed.filter((t) => t.side === 'short').length)],
        ['Mit Checkliste komplett', String(st.closed.filter((t) => t.complete).length)], ['Pro Woche', st.proj ? fmt.n1(st.proj.perWeek) : '–'],
      ],
      verdict: g.n < 30 ? { tone: 'warn', text: `Stichprobe noch klein (${g.n}). Win-Rate und Erwartung schwanken bis etwa 30 Trades stark.` } : { tone: 'win', text: 'Genug Trades für belastbare Kennzahlen.' },
    };
    case 'winRate': return {
      title: 'Win-Rate',
      what: 'Anteil der Trades mit Gewinn. Allein sagt sie wenig: Entscheidend ist, ob sie über der Break-even-Win-Rate liegt, die sich aus deinem Verhältnis von Ø Gewinn zu Ø Verlust ergibt.',
      formula: <>{g.wins} Gewinner ÷ {g.n} Trades = <b>{fmt.pct0(g.winRate)}</b>{g.beWinRate != null && <><br />Break-even = Ø Verlust ÷ (Ø Gewinn + Ø Verlust) = {fmt.n2(-(g.avgLoss || 0))} ÷ ({fmt.n2(g.avgWin)} + {fmt.n2(-(g.avgLoss || 0))}) = <b>{fmt.pct0(g.beWinRate)}</b></>}</>,
      rows: [
        ['Gewonnen', String(g.wins), 'text-win'], ['Verloren', String(g.losses), 'text-loss'],
        ['Break-even', String(g.be)], ['Backtest-Referenz', fmt.n2(settings.backtest.winRate * 100) + ' %'],
        ['Chance-Risiko real (Ø Gewinn ÷ Ø Verlust)', g.payoff != null ? fmt.n2(g.payoff) : '–'], ['Nötige Win-Rate', fmt.pct0(g.beWinRate)],
      ],
      verdict: g.winRate == null ? NO_DATA : g.beWinRate == null ? { tone: 'mute', text: 'Für die Break-even-Rechnung brauchst du mindestens einen Gewinner und einen Verlierer.' }
        : g.winRate >= g.beWinRate ? { tone: 'win', text: `Du liegst ${fmt.n1((g.winRate - g.beWinRate) * 100)} Prozentpunkte über deiner Break-even-Win-Rate. Das System ist profitabel.` }
        : { tone: 'loss', text: `Du liegst ${fmt.n1((g.beWinRate - g.winRate) * 100)} Prozentpunkte unter deiner Break-even-Win-Rate. Entweder öfter richtig liegen oder Gewinner länger laufen lassen.` },
    };
    case 'pf': return {
      title: 'Profit-Faktor',
      what: 'Wie viel Gewinn du pro Einheit Verlust machst. Unter 1 verliert das System Geld, ab 1,5 ist es solide, über 2 stark.',
      formula: <>Bruttogewinne {fmt.n2(g.gw)} ÷ Bruttoverluste {fmt.n2(-g.gl)} = <b>{g.pf == null ? '–' : g.pf === Infinity ? '∞' : fmt.n2(g.pf)}</b></>,
      rows: [['Bruttogewinne', `${fmt.n2(g.gw)} ${cur}`, 'text-win'], ['Bruttoverluste', `${fmt.n2(g.gl)} ${cur}`, 'text-loss'], ['Ø Gewinn', `${fmt.n2(g.avgWin)} ${cur}`], ['Ø Verlust', `${fmt.n2(g.avgLoss)} ${cur}`]],
      verdict: g.pf == null ? NO_DATA : g.pf === Infinity ? { tone: 'win', text: 'Noch kein Verlust. Der Faktor wird aussagekräftig, sobald Verluste dabei sind.' }
        : g.pf < 1 ? { tone: 'loss', text: 'Unter 1: Die Verluste sind größer als die Gewinne.' } : g.pf < 1.5 ? { tone: 'warn', text: 'Zwischen 1 und 1,5: profitabel, aber knapp. Gebühren und Funding können das kippen.' }
        : g.pf < 2 ? { tone: 'win', text: 'Zwischen 1,5 und 2: solides System.' } : { tone: 'win', text: 'Über 2: starkes Verhältnis von Gewinnen zu Verlusten.' },
    };
    case 'avgR': return {
      title: 'Ø R-Multiple',
      what: 'Ergebnis pro Trade gemessen am geplanten Risiko (Einstieg bis Stop). 1 R heißt: genau so viel gewonnen, wie riskiert. Nur Trades mit Stop-Loss fließen ein.',
      formula: <>R = P&L ÷ (|Einstieg − Stop| × Menge) · Ø über {g.rN} Trades = <b className={cls(g.avgR)}>{fmt.r(g.avgR)}</b></>,
      rows: [['Trades mit Stop', `${g.rN} von ${g.n}`], ['Bester R', fmt.r(g.bestR), 'text-win'], ['Schlechtester R', fmt.r(g.worstR), 'text-loss'], ['Trades mit ≥ 2 R', g.rN ? `${g.r2} (${fmt.pct0(g.r2 / g.rN)})` : '–']],
      verdict: g.avgR == null ? { tone: 'mute', text: 'Trag bei deinen Trades einen Stop-Loss ein, dann berechne ich das R-Multiple.' }
        : g.worstR != null && g.worstR < -1.2 ? { tone: 'warn', text: `Mindestens ein Verlust war größer als 1 R (${fmt.r(g.worstR)}). Das heißt, ein Stop wurde verschoben oder nicht eingehalten.` }
        : g.avgR > 0 ? { tone: 'win', text: 'Positiver Durchschnitt: Im Schnitt holst du mehr als du riskierst.' } : { tone: 'loss', text: 'Negativer Durchschnitt: Im Schnitt verlierst du einen Teil deines Risikos pro Trade.' },
    };
    case 'maxDD': return {
      title: 'Maximaler Drawdown',
      what: 'Der größte Rückgang vom bisherigen Kontohöchststand bis zum folgenden Tiefpunkt. Zeigt, wie tief das Konto zwischendurch gefallen ist.',
      formula: <>(Tief {fmt.n0(st.dd.trough)} − Hoch {fmt.n0(st.dd.peak)}) ÷ Hoch = <b className={st.maxDD < 0 ? 'text-loss' : ''}>{fmt.pct(st.maxDD)}</b></>,
      rows: [['Höchststand', `${fmt.n0(st.peak)} ${cur}`], ['Aktueller Abstand zum Hoch', fmt.pct(st.curDD), st.curDD < 0 ? 'text-loss' : 'text-win'], ['Hoch bei', st.dd.peakI ? `Trade #${st.dd.peakI}` : 'Start'], ['Tief bei', st.dd.troughI ? `Trade #${st.dd.troughI}` : '–']],
      verdict: !g.n ? NO_DATA : st.maxDD > -0.05 ? { tone: 'win', text: 'Unter 5 %: sehr kontrolliertes Risiko.' } : st.maxDD > -0.15 ? { tone: 'warn', text: 'Zwischen 5 und 15 %: vertretbar, aber im Blick behalten.' } : { tone: 'loss', text: 'Über 15 %: Positionsgrößen oder Hebel prüfen (Regel: Scalp 4x, Makro höchstens 5x).' },
    };
    case 'exp': return {
      title: 'Erwartungswert',
      what: 'Was dir ein durchschnittlicher Trade bringt. Kombiniert Win-Rate und Größe von Gewinnen und Verlusten in einer Zahl.',
      formula: <>{fmt.pct0(g.winRate)} × {fmt.n2(g.avgWin)} + {g.n ? fmt.pct0(g.losses / g.n) : '–'} × {fmt.n2(g.avgLoss)} ≈ <b className={cls(g.exp)}>{fmt.signed(g.exp)} {cur}</b></>,
      rows: [['Pro Trade in Kursbewegung', fmt.pct(g.moveExp), cls(g.moveExp)], ['Backtest-Referenz', fmt.pct(settings.backtest.expectancy)]],
      verdict: g.exp == null ? NO_DATA : g.exp > 0 ? { tone: 'win', text: 'Positiv: Mit jedem weiteren Trade nach diesem Muster wächst das Konto im Schnitt.' } : { tone: 'loss', text: 'Negativ: Im Schnitt kostet dich jeder Trade Geld.' },
    };
    case 'projection': {
      const p = st.proj;
      return {
        title: 'Hochrechnung aufs Jahr',
        what: 'Rechnet deine bisherige Rendite auf 365 Tage hoch. Linear heißt: gleicher Betrag pro Tag. Mit Zinseszins wächst die Basis mit, der Wert wird bei kurzer Historie schnell unrealistisch.',
        formula: p ? <>Linear: {fmt.pct(p.r)} × 365 ÷ {fmt.n0(p.days)} Tage = <b className={cls(p.linear)}>{fmt.pct(p.linear)}</b><br />Zinseszins: (1 {p.r >= 0 ? '+' : '−'} {fmt.n2(Math.abs(p.r) * 100)} %)^(365 ÷ {fmt.n0(p.days)}) − 1 = {Math.abs(p.comp) > 99 ? '> 9.900 %' : fmt.pct(p.comp)}</> : undefined,
        rows: p ? [['Basis', `${fmt.n0(p.days)} Tage, ${g.n} Trades`], ['Startkapital', `${fmt.n0(st.start)} ${cur}`], ['Ø pro Monat', fmt.pct(p.monthly), cls(p.monthly)], ['Konto in 12 Monaten', `${fmt.n0(p.endLin)} ${cur}`]] : [],
        verdict: !p ? NO_DATA : p.weak ? { tone: 'warn', text: 'Wenig Daten: Die Hochrechnung wird ab etwa 30 Tagen und 10 Trades belastbar.' } : { tone: 'mute', text: 'Die Zahl beschreibt deine bisherige Performance, sie ist keine Prognose.' },
      };
    }
    case 'streak': return {
      title: 'Serie',
      what: 'Wie viele Trades in Folge zuletzt gleich ausgegangen sind. Lange Verlustserien sind ein Signal für eine Pause, lange Gewinnserien für erhöhte Vorsicht vor Übermut.',
      rows: [['Aktuell', st.streak ? `${st.streak}× ${st.streakType === 'win' ? 'Gewinn' : st.streakType === 'loss' ? 'Verlust' : 'Break-even'}` : '–']],
      verdict: st.streakType === 'loss' && st.streak >= 3 ? { tone: 'loss', text: '3 Verluste in Folge. Pause machen und die Checkliste der letzten Trades prüfen.' } : { tone: 'mute', text: 'Kein Warnsignal.' },
    };
  }
}

/** Details zu einer Zeile im Backtest-Vergleich. */
export function backtestDetail(kind: 'winRate' | 'avgWin' | 'avgLoss' | 'exp', g: Group, settings: Settings): DetailData {
  const bt = settings.backtest;
  const base = { winRate: ['Win-Rate', 'Anteil gewonnener Trades, verglichen mit den 214 Backtest-Signalen.'], avgWin: ['Ø Gewinner', 'Durchschnittliche Kursbewegung vom Einstieg zum Ausstieg bei gewonnenen Trades, ohne Hebel. So ist auch der Backtest gerechnet.'], avgLoss: ['Ø Verlierer', 'Durchschnittliche Kursbewegung bei verlorenen Trades, ohne Hebel. Ein kleinerer Wert als im Backtest heißt: du schneidest Verluste früher ab.'], exp: ['Erwartung pro Trade', 'Durchschnittliche Kursbewegung über alle Trades. Das ist die Zahl, an der sich Über- oder Unterperformance entscheidet.'] }[kind];
  const you = { winRate: g.winRate, avgWin: g.moveWin, avgLoss: g.moveLoss, exp: g.moveExp }[kind];
  const ref = { winRate: bt.winRate, avgWin: bt.avgWin, avgLoss: bt.avgLoss, exp: bt.expectancy }[kind];
  const d = you == null ? null : you - ref;
  return {
    title: base[0], what: base[1],
    formula: you == null ? undefined : <>Du {fmt.pct(you)} − Backtest {fmt.pct(ref)} = <b className={cls(d)}>{fmt.signed(d! * 100, 2)} Prozentpunkte</b></>,
    rows: [['Datenbasis', `${kind === 'winRate' ? g.n : g.moveN} Trades`], ['Backtest', bt.label]],
    verdict: d == null ? { tone: 'mute', text: 'Noch keine Trades mit Ein- und Ausstieg.' } : d >= 0 ? { tone: 'win', text: 'Besser als der Backtest.' } : { tone: 'loss', text: 'Schlechter als der Backtest.' },
  };
}

/** Details zu einer Entscheidungsgrundlage im Ranking. */
export function setupDetail(g: Group & { setup: Settings['setups'][number] }, trades: ETrade[], cur: string): DetailData {
  const mine = trades.filter((t) => (t.setups || []).includes(g.setup.id) && t.result !== 'open');
  const full = mine.filter((t) => t.complete).length;
  return {
    title: g.setup.name, what: g.setup.desc || 'Keine Regeln hinterlegt.',
    rows: [
      ['Profit-Faktor', g.pf == null ? '–' : g.pf === Infinity ? '∞' : fmt.n2(g.pf)], ['Ø Gewinn / Ø Verlust', `${fmt.n0(g.avgWin)} / ${fmt.n0(g.avgLoss)}`],
      ['Bester Trade', tradeLabel(g.best, cur), 'text-win'], ['Schlechtester Trade', tradeLabel(g.worst, cur), 'text-loss'],
      ['Checkliste komplett', mine.length ? `${full} von ${mine.length}` : '–'], ['Ø Kursbewegung', fmt.pct(g.moveExp), cls(g.moveExp)],
    ],
    verdict: !g.n ? { tone: 'mute', text: 'Noch keine abgeschlossenen Trades mit dieser Grundlage.' } : g.n < 5 ? { tone: 'warn', text: `Erst ${g.n} Trade${g.n === 1 ? '' : 's'}. Ab etwa 10 Trades lässt sich die Grundlage fair bewerten.` } : g.net > 0 ? { tone: 'win', text: 'Diese Grundlage verdient Geld. Weiter so, gleiche Regeln.' } : { tone: 'loss', text: 'Diese Grundlage kostet Geld. Regeln schärfen oder seltener handeln.' },
  };
}
