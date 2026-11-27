/**
 * Paket F2 · "Frag dein Journal": the question bar's logic against KNOWN TRUTH. The journal is the 12-trade table of
 * `ask.fixtures.ts`; every expected number below was worked out by hand from that table (see the comments), not read from the code.
 * One test group per question type, then the honest "not understood" cases and the guard that nothing is ever guessed.
 */
import { describe, expect, it } from "vitest";
import { askCards, ASK_STRINGS, exampleQuestions, FRAGETYPEN, unknownWords, type AskResult } from "@/domain/ask";
import { askJournal } from "@/domain/coach/nlq";
import { normalize } from "@/domain/coach/nlq/lexicon";
import { ASK_SETTINGS, askTrades, askWorld, NOW } from "./ask.fixtures";
import { mkTrade } from "./domain.fixtures";

const { data } = askWorld();
const ask = (q: string, d = data): AskResult => askCards(q, d);
const ok = (q: string) => {
  const r = ask(q);
  if (r.status !== "ok") throw new Error(`${q}: ${r.status}`);
  return r;
};
const values = (r: AskResult) => r.status === "ok" ? r.cards.map((c) => c.value) : [];
const labels = (r: AskResult) => r.status === "ok" ? r.cards.map((c) => c.label) : [];

describe("the fixture is what the comments say", () => {
  it("12 closed trades, net −360 in total", () => {
    expect(data.closed).toHaveLength(12);
    expect(data.closed.reduce((s, t) => s + (t.pnl ?? 0), 0)).toBe(-360);
    expect(NOW).toBe(new Date(2026, 5, 10, 12).getTime());
  });
});

describe("Fragetyp: Verluste einer Auswahl (Setup + Zeitraum)", () => {
  it("„Verluste im Setup Breakout letzten Monat“ – May: T1 +200, T2 −100, T3 −150, T6 −60, T7 −300 → 4 of 5, −610, −3,10 R, biggest −300", () => {
    const r = ok("Verluste im Setup Breakout letzten Monat");
    expect(r.kind).toBe("audit");
    expect(r.reading).toEqual(expect.arrayContaining(["Verluste", "Breakout", "Letzter Monat"]));
    expect(labels(r)).toEqual(["Verluste", "Summe der Verluste", "Größter Verlust"]);
    // T7 has no stop → no R, so the sum of R covers T2, T3, T6 only (−1 −1,5 −0,6)
    expect(values(r)).toEqual(["4 von 5 (80 %)", "−610 USDT · −3,10 R", "−300 USDT"]);
    expect(r.cards.map((c) => c.tone)).toEqual(["fg", "loss", "loss"]);
    // the trades the answer is about: the four losers, newest first (T7 27.05., T6 20.05., T3 06.05., T2 05.05.)
    expect(r.tradeIds).toEqual(["T7", "T6", "T3", "T2"]);
  });

  it("„Verluste Montag“ – Mondays T0 −500 (R −2,5), T1 +200, T11 +400 → 1 of 3, −500", () => {
    const r = ok("Verluste Montag");
    expect(values(r)).toEqual(["1 von 3 (33 %)", "−500 USDT · −2,50 R", "−500 USDT · −2,50 R"]);
    expect(r.tradeIds).toEqual(["T0"]);
  });

  it("a selection without a loss says so instead of inventing one", () => {
    // Fade in June: T10 −40 is a loss; Breakout in June: T9 +100, T11 +400 – no loss
    const r = ok("Verluste im Setup Breakout im Juni");
    expect(r.text).toContain("keiner der 2 Trades endete im Verlust");
    expect(values(r)[0]).toBe("0 von 2 (0 %)");
    expect(r.tradeIds).toEqual([]);
  });

  it("an empty selection (a month without trades) is „empty“, not zero", () => {
    const r = ask("Verluste im Januar");
    expect(r.status).toBe("empty");
    if (r.status === "empty") expect(r.text).toContain("keine abgeschlossenen Trades");
  });
});

describe("Fragetyp: Trades ohne Stopp", () => {
  it("all: T7 and T8 have no stop → 2 of 12, −250 together; Ø per trade −125 without vs −11 with a stop", () => {
    const r = ok("Trades ohne Stopp");
    expect(labels(r)).toEqual(["Ohne Stopp", "Ergebnis dieser Trades", "Ø pro Trade"]);
    // with a stop: net −360 − (−250) = −110 over 10 trades = −11
    expect(values(r)).toEqual(["2 von 12 (17 %)", "−250 USDT", "ohne −125 USDT · mit −11 USDT"]);
    expect(r.tradeIds).toEqual(["T8", "T7"]);
    expect(r.text).toContain("kein R");
  });

  it("with a period: May has 8 trades, 2 without a stop (25 %), Ø with a stop −70/6 ≈ −12", () => {
    const r = ok("Trades ohne Stopp letzten Monat");
    expect(values(r)).toEqual(["2 von 8 (25 %)", "−250 USDT", "ohne −125 USDT · mit −12 USDT"]);
  });

  it("several phrasings mean the same", () => {
    for (const q of ["Welche Trades haben keinen Stop?", "Stopp vergessen", "Trades ohne Stop Loss", "kein Stopp gesetzt"]) {
      const r = ask(q);
      expect(r.status, q).toBe("ok");
      if (r.status === "ok") expect(r.tradeIds, q).toEqual(["T8", "T7"]);
    }
  });

  it("a journal where every trade has a stop says so", () => {
    const w = askWorld(ASK_SETTINGS, askTrades().filter((t) => t.id !== "T7" && t.id !== "T8"));
    const r = ask("Trades ohne Stopp", w.data);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.text).toContain("alle 10 abgeschlossenen Trades haben einen Stopp");
      expect(r.tradeIds).toEqual([]);
    }
  });
});

describe("Fragetyp: Checkliste ausgelassen", () => {
  it("8 trades have a checklist (Breakout): 4 not complete (T0 0/2, T2 1/2, T3 0/2, T11 1/2), 2 of them nothing ticked; Ø R +0,80 vs −0,25", () => {
    const r = ok("Wie oft habe ich die Checkliste ausgelassen?");
    expect(labels(r)).toEqual(["Nicht vollständig", "Davon gar nichts abgehakt", "Ø R"]);
    // complete: T1 +2, T6 −0,6, T9 +1 (T7 has no R) → 2,4 / 3 = 0,8; incomplete: −2,5 −1 −1,5 +4 = −1 / 4 = −0,25
    expect(values(r)).toEqual(["4 von 8 (50 %)", "2", "vollständig +0,80 R · sonst −0,25 R"]);
    expect(r.tradeIds).toEqual(["T11", "T3", "T2", "T0"]);
    // the four Fade trades have no checklist and are said not to count
    expect(r.text).toContain("4 Trades haben keine Checkliste");
    expect(r.confidence.note).toContain("kein Beweis");
  });

  it("other words for the same question", () => {
    for (const q of ["Checkliste vergessen", "Trades ohne Checkliste", "Wie oft war die Checkliste nicht vollständig?", "Checkliste übersprungen"]) {
      const r = ask(q);
      expect(r.status, q).toBe("ok");
      if (r.status === "ok") expect(r.kind, q).toBe("audit");
    }
  });

  it("a journal without any checklist does not blame the trader", () => {
    const w = askWorld({ ...ASK_SETTINGS, setups: ASK_SETTINGS.setups.map((s) => ({ ...s, checklist: [] })) });
    const r = ask("Checkliste ausgelassen", w.data);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.text).toContain("hat eine Checkliste");
  });
});

describe("Fragetyp: Trades ohne Review", () => {
  it("T1, T4 (tag), T6, T9, T11 have one → 7 of 12 without (T0, T2, T3, T5, T7, T8, T10), −920 together, newest T10", () => {
    const r = ok("Trades ohne Review");
    expect(labels(r)).toEqual(["Ohne Review", "Neuester ohne Review", "Ergebnis dieser Trades"]);
    expect(values(r)).toEqual(["7 von 12 (58 %)", "03.06.2026 · BTC/USDT", "−920 USDT"]);
    expect(r.tradeIds).toEqual(["T10", "T8", "T7", "T5", "T3", "T2", "T0"]);
  });
});

describe("Fragetyp: Beste / schwächste Gruppe", () => {
  it("„Beste Wochentage“ – Mo +100 (3), Di −80 (3), Mi −430 (5); Thursday has one trade and does not rank", () => {
    const r = ok("Beste Wochentage");
    expect(r.kind).toBe("group");
    expect(labels(r)).toEqual(["Montag", "Dienstag", "Mittwoch"]);
    expect(values(r)).toEqual(["+100 USDT", "−80 USDT", "−430 USDT"]);
    expect(r.cards.map((c) => c.sub)).toEqual(["3 Trades", "3 Trades", "5 Trades"]);
  });

  it("„An welchem Wochentag verliere ich am meisten?“ turns the order round", () => {
    const r = ok("An welchem Wochentag verliere ich am meisten?");
    expect(labels(r)).toEqual(["Mittwoch", "Dienstag", "Montag"]);
  });

  it("„Was ist mein bestes Setup?“ – Breakout −410 (8), Fade +50 (4): Fade is the better one", () => {
    // Breakout: −500 +200 −100 −150 −60 −300 +100 +400 = −410; Fade: −80 +120 +50 −40 = +50
    const r = ok("Was ist mein bestes Setup?");
    expect(labels(r)).toEqual(["Fade", "Breakout"]);
    expect(values(r)).toEqual(["+50 USDT", "−410 USDT"]);
  });
});

describe("Fragetyp: eine Kennzahl", () => {
  it("„Größter Verlust dieses Jahr“ – 2026 only: T7 −300 (the −500 is from 2025); 11 trades, +140 net", () => {
    const r = ok("Größter Verlust dieses Jahr");
    expect(labels(r)).toEqual(["Größter Verlust", "Trades", "Netto"]);
    expect(values(r)).toEqual(["−300 USDT", "11", "+140 USDT"]);
    expect(r.tradeIds[0]).toBe("T7");
  });

  it("„Mein größter Verlust“ – without a period it is T0: −500, −2,5 R", () => {
    const r = ok("Mein größter Verlust");
    expect(values(r)[0]).toBe("−500 USDT (−2,50 R)");
    expect(r.tradeIds[0]).toBe("T0");
  });

  it("„Bester Trade dieses Jahr“ – T11 +400, +4 R", () => {
    const r = ok("Bester Trade dieses Jahr");
    expect(labels(r)[0]).toBe("Größter Gewinn");
    expect(values(r)[0]).toBe("+400 USDT (+4,00 R)");
  });

  it("„Größter Verlust“ over trades that all won is not answered with a win", () => {
    const wins = askTrades().filter((t) => ["T1", "T5", "T9"].includes(t.id));
    const r = ask("Größter Verlust", askWorld(ASK_SETTINGS, wins).data);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.text).toContain("Kein Verlusttrade");
      expect(r.cards[0]!.label).toBe("Schwächster Trade");
    }
  });

  it("„Win-Rate bei Fade“ – T4 −, T5 +, T8 +, T10 − → 2 of 4 = 50 %", () => {
    const r = ok("Win-Rate bei Fade");
    expect(values(r)[0]).toBe("50 %");
    expect(r.confidence.n).toBe(4);
  });
});

describe("Fragetyp: vergleichen und überblicken", () => {
  it("„Vergleiche Breakout und Fade“ – net −410 vs +50, win rate 3/8 vs 2/4", () => {
    const r = ok("Vergleiche Breakout und Fade");
    expect(r.kind).toBe("compare");
    expect(values(r)).toEqual(["−410 USDT", "+50 USDT", "38 % · 50 %"]);
    expect(r.text).toContain("Fade liegt vorn");
  });

  it("„Wie war letzte Woche?“ – 1.–7. June: T9 +100, T10 −40 → 2 trades, +60, 50 %", () => {
    const r = ok("Wie war letzte Woche?");
    expect(labels(r)).toEqual(["Trades", "Netto", "Win-Rate"]);
    expect(values(r)).toEqual(["2", "+60 USDT", "50 %"]);
    expect(r.tradeIds).toHaveLength(2);
  });
});

describe("Fragetyp: Verhaltensmuster (a tiny journal with ONE revenge entry)", () => {
  // A: loss −100, 10:00 – 11:00. B: entered 11:20 (≤ 60 min after A closed), marked „Revenge“, −150. Clean trades: only A.
  const A = mkTrade({ id: "A", date: "2026-06-01T10:00", exitDate: "2026-06-01T11:00", entry: 100, stop: 99, size: 10_000, pnlManual: -100, setups: ["s_fa"], reason: "Plan" });
  const B = mkTrade({ id: "B", date: "2026-06-01T11:20", exitDate: "2026-06-01T12:00", entry: 100, stop: 99, size: 10_000, pnlManual: -150, setups: ["s_fa"], emotion: "Revenge", reason: "Rache" });
  const w = askWorld(ASK_SETTINGS, [A, B]);

  it("counts the one event, its P&L and the excess against the clean trade (−150 − 1 · −100 = −50)", () => {
    const r = ask("Was kosten mich Revenge-Trades?", w.data);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.kind).toBe("behavior");
    expect(labels(r)).toEqual(["Vorkommen", "P&L dieser Trades", "vs. saubere Trades"]);
    expect(values(r)).toEqual(["1", "−150 USDT", "−50 USDT"]);
    expect(r.tradeIds).toEqual(["B"]);
  });

  it("no pattern → 0, said plainly", () => {
    const r = ask("Wie oft hatte ich Tilt?", w.data);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.cards[0]!.value).toBe("0");
  });
});

describe("nicht verstanden: ehrlich, drei Beispiele, nie raten", () => {
  const NOT_UNDERSTOOD = [
    "Wie wird das Wetter morgen?",
    "Was soll ich morgen traden?", // a forecast / advice is not a question about the journal
    "Win-Rate bei Bitcoinn", // a typo must not silently become "all trades"
    "Verluste im Setup Breakoutt letzten Monat",
    "Hallo",
    "Erzähl mir einen Witz",
  ];
  for (const q of NOT_UNDERSTOOD) {
    it(`„${q}“`, () => {
      const r = ask(q);
      expect(r.status).toBe("unknown");
      if (r.status !== "unknown") return;
      expect(r.message.startsWith(ASK_STRINGS.unknown)).toBe(true);
      expect(r.examples).toHaveLength(3);
      // no number, no card, no trade in the reply
      expect(JSON.stringify(r)).not.toMatch(/USDT|"cards"|tradeIds/);
    });
  }

  it("names the words it does not know", () => {
    const r = ask("Win-Rate bei Bitcoinn");
    expect(r.status === "unknown" && r.unknown).toEqual(["bitcoinn"]);
    expect(r.status === "unknown" && r.message).toContain("„bitcoinn“");
  });

  it("an empty question asks for a question", () => {
    for (const q of ["", "   "]) {
      const r = ask(q);
      expect(r.status === "unknown" && r.reason).toBe("blank");
    }
  });

  it("two questions in one are not answered by dropping one of them", () => {
    const r = ask("Vergleiche Long und Short ohne Stopp");
    expect(r.status === "unknown" && r.reason).toBe("clash");
    expect(ask("Trades ohne Stopp und beste Wochentage").status).toBe("unknown");
  });

  it("a summary of „nothing in particular“ is not guessed either", () => {
    expect(ask("Wie war es?").status).toBe("unknown");
    expect(ask("Wie war letzte Woche?").status).toBe("ok");
  });

  it("the three examples are real questions: each is answered (never unknown), for any journal", () => {
    const worlds = [data, askWorld({ ...ASK_SETTINGS, setups: [] }).data, askWorld(ASK_SETTINGS, []).data];
    for (const d of worlds) {
      const ex = exampleQuestions(d);
      expect(ex).toHaveLength(3);
      for (const q of ex) expect(ask(q, d).status, q).not.toBe("unknown");
    }
    expect(exampleQuestions(data)[0]).toBe("Verluste im Setup Breakout letzten Monat");
  });

  it("a real-world setup name (digits, umlaut word, hyphen) still makes an answerable example", () => {
    const odd = { ...ASK_SETTINGS, setups: ASK_SETTINGS.setups.map((x) => (x.id === "s_bo" ? { ...x, name: "4H-Breakout über 85.900" } : x)) };
    const w = askWorld(odd).data;
    const ex = exampleQuestions(w)[0]!;
    expect(ex).toBe("Verluste im Setup 4H-Breakout über 85.900 letzten Monat");
    const r = ask(ex, w);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(values(r)[0]).toBe("4 von 5 (80 %)");
  });

  it("every question type of the closed catalogue answers its own example", () => {
    expect(FRAGETYPEN.length).toBeGreaterThanOrEqual(9);
    for (const t of FRAGETYPEN) {
      const r = ask(t.example);
      expect(r.status, t.id).not.toBe("unknown");
    }
  });

  it("no trades at all: understood, said honestly, nothing invented", () => {
    const none = askWorld(ASK_SETTINGS, []).data;
    const r = ask("Trades ohne Stopp", none);
    expect(r.status).toBe("empty");
    if (r.status === "empty") expect(r.text).toBe(ASK_STRINGS.none);
  });
});

describe("derselbe Motor wie der Coach (keine Doppelung)", () => {
  it("the Coach chat understands the audit questions too – same engine, same numbers", () => {
    const a = askJournal("Trades ohne Stopp", data);
    expect(a.kind).toBe("audit");
    expect(a.facts[0]!.value).toBe("2 von 12 (17 %)");
    expect(a.matched).toEqual(["T8", "T7"]);
  });

  it("the old Coach questions still pass the bar's word guard", () => {
    const OLD = [
      "Wie ist meine Win-Rate am Montag?",
      "Trefferquote bei Shorts letzte Woche",
      "Wie viel habe ich diesen Monat verdient?",
      "Welche Session ist am profitabelsten?",
      "Ø R pro Setup",
      "Profit Factor im Makro-Konto",
      "Durchschnittliches R bei BTC",
      "Wie viele Trades hatte ich im September?",
      "Vergleiche Long und Short",
      "London oder New York – was ist besser?",
      "Vergleiche diesen Monat mit letztem Monat",
      "Wie oft habe ich Revenge-Trades gemacht?",
      "Was kosten mich FOMO-Einstiege?",
      "Wie oft habe ich den Stop verschoben?",
      "Bin ich zu früh raus?",
      "Tilt in den letzten 30 Tagen",
      "Zeig mir meine Shorts von gestern",
      "Win-Rate mit Hebel über 10",
      "Erwartung bei Überzeugung 5",
      "Gebühren im Q2",
      "Drawdown 2025",
      "Wie lange halte ich Verlierer?",
      "Ergebnis in der Asien-Session",
      "Trades auf 15m",
      "P&L #breakout",
      "Bin ich mit Hebel 4x profitabler als mit 1x?",
    ];
    const bad = OLD.filter((q) => ask(q).status === "unknown").map((q) => `${q} → ${JSON.stringify(unknownWords(normalize(q), { setups: ASK_SETTINGS.setups, assets: ["BTC"] }))}`);
    expect(bad).toEqual([]);
  });
});
