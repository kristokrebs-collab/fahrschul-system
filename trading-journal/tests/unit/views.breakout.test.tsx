/**
 * Scanner „Wer bricht aus?“ – der Block der Markt-Seite (`BreakoutSection`) mit eingespeister Kerzenquelle (Festkerzen der Tests):
 * der ehrliche Leerzustand, der Lauf (Zähler = echte Antworten), Karten mit Note, Gründen, echten Mini-Kerzen, die Zahlen der gewählten
 * Karte, Sitzungswechsel ohne neuen Abruf, Teil- und Totalausfall, die Übernahme in den Rechner (nur Vorbelegung) – und was die Seite
 * NICHT hat: keinen Orderknopf, kein Drängen, kein Versprechen.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_SYMBOLS } from "@/domain/breakout";
import { __setBreakoutLoader, type BreakoutLoad, type BreakoutLoader, type BreakoutSource } from "@/market/breakout/candles";
import { MotionRoot } from "@/motion/MotionRoot";
import BreakoutSection, { distText, pxText } from "@/views/markt/breakout/BreakoutSection";
import { __resetBreakoutScan, useBreakoutScan } from "@/views/markt/breakout/scanStore";
import { BREAKOUT } from "@/views/markt/breakout/strings";
import { EMPTY_CALC, useRiskUi } from "@/views/risiko/riskStore";
import { hhmm, ddmmHHmm } from "@/market/format";
import { BREAK_SLOT, BREAKOUT_NOW, BREAKOUT_OPEN, BREAKOUT_SCENARIOS, breakoutCandles, IV } from "../e2e/mocks/breakout";
import { installDomPolyfills } from "./views.overview.harness";

const openFeature = vi.fn();
vi.mock("@/app/featureOpen", () => ({ openFeature: (...a: unknown[]) => openFeature(...a) }));

interface FakeOpts {
  fail?: (symbol: string) => string | null;
  source?: BreakoutSource;
  scenario?: (symbol: string) => string;
}
function fakeLoader(opts: FakeOpts = {}) {
  const load = vi.fn(async (symbol: string): Promise<BreakoutLoad> => {
    const why = opts.fail?.(symbol);
    if (why) return { ok: false, symbol, kind: "network", message: why };
    const from = opts.scenario?.(symbol) ?? symbol;
    return { ok: true, symbol, candles: breakoutCandles(from), source: opts.source ?? "binance", fetchedAt: BREAKOUT_NOW };
  });
  const loader: BreakoutLoader = { load, route: () => opts.source ?? "binance", reset: vi.fn() };
  __setBreakoutLoader(loader);
  return { load, loader };
}

const view = () =>
  render(
    <MotionRoot>
      <BreakoutSection />
    </MotionRoot>,
  );
/** clock times as the viewer's own clock shows them (the test machine's zone is not pinned) */
const SIGNAL_AT = hhmm(BREAKOUT_OPEN + (BREAK_SLOT + 1) * IV);
const STAND_AT = ddmmHHmm(BREAKOUT_NOW);
const card = (symbol: string): HTMLElement => screen.getByTestId("breakout-grid").querySelector<HTMLElement>(`[data-symbol="${symbol}"]`)!;
const order = (): string[] => [...screen.getByTestId("breakout-grid").querySelectorAll("[data-testid=breakout-card]")].map((el) => el.getAttribute("data-symbol")!);
async function scan(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("breakout-rescan"));
  });
  await waitFor(() => expect(screen.getByTestId("breakout-section")).toHaveAttribute("data-phase", "done"));
}

beforeAll(installDomPolyfills);
beforeEach(() => {
  __resetBreakoutScan(() => BREAKOUT_NOW);
  useRiskUi.setState({ calc: EMPTY_CALC, fillSeq: 0, prefillNote: null });
  openFeature.mockClear();
});
afterEach(() => __setBreakoutLoader(null));

describe("Scanner „Wer bricht aus?“", () => {
  it("vor dem ersten Lauf: zwölf feste Plätze, ein ehrlicher Satz, kein Abruf", () => {
    const { load } = fakeLoader();
    view();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Wer bricht aus?");
    expect(screen.getAllByTestId("breakout-card")).toHaveLength(12);
    expect(order()).toEqual([...BREAKOUT_SYMBOLS]);
    for (const el of screen.getAllByTestId("breakout-card")) {
      expect(el).toHaveAttribute("data-state", "pending");
      expect(el).toBeDisabled();
    }
    expect(screen.getByTestId("breakout-msg")).toHaveTextContent(BREAKOUT.idle);
    expect(screen.getByTestId("breakout-checked")).toHaveTextContent("0/12");
    expect(screen.getByTestId("breakout-stand")).toHaveTextContent("Quelle: keine Daten · Abruf keine Daten · letzter Schluss 5m keine Daten");
    expect(screen.getByTestId("breakout-rescan")).toHaveTextContent("Scan starten");
    expect(load).not.toHaveBeenCalled();
  });

  it("der Lauf: zwölf Abrufe, Zähler und Noten aus den echten Antworten, sortiert nach erfüllten Gründen", async () => {
    const { load } = fakeLoader();
    view();
    await scan();
    expect(load).toHaveBeenCalledTimes(12);
    expect(new Set(load.mock.calls.map((c) => c[0]))).toEqual(new Set(BREAKOUT_SYMBOLS));
    // die Zähler laufen auf den echten Stand (MotionNumber)
    await waitFor(() => expect(screen.getByTestId("breakout-checked")).toHaveTextContent("12/12"));
    // A+ / A: LTC, BNB (A+) und SUI (A)
    await waitFor(() => expect(screen.getByTestId("breakout-top")).toHaveTextContent("3"));
    expect(order().slice(0, 5)).toEqual(["LTCUSDT", "BNBUSDT", "SUIUSDT", "XRPUSDT", "DOGEUSDT"]);
    expect(order()[11]).toBe("TONUSDT");
    expect(screen.getByTestId("breakout-grid")).toHaveAttribute("data-done");

    const ltc = card("LTCUSDT");
    expect(ltc).toHaveAttribute("data-grade", "A+");
    expect(ltc).toHaveAttribute("data-status", "breakout");
    expect(ltc).toHaveAttribute("data-best");
    expect(ltc).toHaveTextContent(BREAKOUT.best);
    expect(ltc).toHaveTextContent(`Short-Ausbruch um ${SIGNAL_AT}`);
    expect(ltc).toHaveTextContent("Vol 4,0×");
    expect(ltc).toHaveAttribute("aria-pressed", "true");
    expect(ltc.getAttribute("aria-label")).toContain("Note A+");
    expect(ltc.getAttribute("aria-label")).toContain("Ausbruch: erfüllt");
    // die drei Gründe einzeln: DOGE hat nur den Ausbruch
    const chips = (el: HTMLElement): (string | null)[] => [...el.querySelectorAll(".bo-chip")].map((c) => c.getAttribute("data-s"));
    expect(chips(ltc)).toEqual(["y", "y", "y"]);
    expect(chips(card("DOGEUSDT"))).toEqual(["y", "n", "n"]);
    expect(chips(card("XRPUSDT"))).toEqual(["y", "n", "y"]);
    expect(chips(card("BTCUSDT"))).toEqual(["n", "u", "u"]);
    // nur EINE Karte ist markiert
    expect(screen.getByTestId("breakout-grid").querySelectorAll("[data-best]")).toHaveLength(1);
    // ohne Kerzen: gesagt, nicht geschätzt
    expect(card("TONUSDT")).toHaveTextContent("Keine Kerzen für diese Sitzung");
    expect(card("TONUSDT").querySelector("[data-testid=breakout-chart]")).toBeNull();
    expect(card("BTCUSDT")).toHaveTextContent("In der Spanne – noch kein Ausbruch");

    expect(screen.getByTestId("breakout-stand")).toHaveTextContent(`Quelle: Binance USDⓈ-M · Abruf ${STAND_AT} · letzter Schluss 5m ${STAND_AT}`);
  });

  it("der Mini-Chart zeichnet die geladenen Kerzen: je Kerze ein Körper, dazu Spanne und der eine Punkt auf dem Ausbruch", async () => {
    fakeLoader();
    view();
    await scan();
    const read = useBreakoutScan.getState().rows.LTCUSDT!;
    if (read.state !== "ok") throw new Error("expected ok");
    const chart = within(card("LTCUSDT")).getByTestId("breakout-chart");
    const bars = read.read.preview.length;
    expect(bars).toBeGreaterThan(20);
    expect(chart).toHaveAttribute("data-bars", String(bars));
    expect(chart.querySelectorAll("rect.up, rect.dn")).toHaveLength(bars);
    expect(chart.querySelectorAll("rect.rg")).toHaveLength(1);
    expect(chart.querySelectorAll("line.ed")).toHaveLength(2);
    expect(chart.querySelectorAll(".bo-mark")).toHaveLength(1);
    expect(chart).toHaveAccessibleName(`Mini-Chart LTC: ${bars} echte 5-Minuten-Kerzen mit der Spanne`);
    // ohne Ausbruch kein Punkt
    expect(within(card("BTCUSDT")).getByTestId("breakout-chart").querySelectorAll(".bo-mark")).toHaveLength(0);
  });

  it("die gewählte Karte in Zahlen: Stärke, Volumen-Faktor, Marke, Abstand, Zeitpunkt – und die Gründe in Worten", async () => {
    fakeLoader();
    view();
    await scan();
    const d = screen.getByTestId("breakout-detail");
    expect(d).toHaveAttribute("data-symbol", "LTCUSDT");
    expect(within(d).getByRole("heading", { level: 4 })).toHaveTextContent("LTC · Short");
    expect(within(d).getByTestId("breakout-fact-grade")).toHaveTextContent("A+ · 3 von 3 Gründen, Volumen stark");
    expect(within(d).getByTestId("breakout-fact-volume")).toHaveTextContent("4,0×");
    expect(within(d).getByTestId("breakout-fact-time")).toHaveTextContent(`${SIGNAL_AT} Uhr`);
    const row = useBreakoutScan.getState().rows.LTCUSDT!;
    if (row.state !== "ok") throw new Error("expected ok");
    expect(within(d).getByTestId("breakout-fact-dist")).toHaveTextContent(distText(row.read));
    expect(distText(row.read)).toMatch(/^\+0,\d\d % · \d+,\d ATR$/);
    expect(d).toHaveTextContent(pxText(51.9 * 0.9985));
    expect(d).toHaveTextContent("4,0× der Durchschnitt der 20 Kerzen davor");
    expect(d).toHaveTextContent("EMA 50");

    // eine andere Karte wählen
    await act(async () => {
      fireEvent.click(card("BTCUSDT"));
    });
    const b = screen.getByTestId("breakout-detail");
    expect(b).toHaveAttribute("data-symbol", "BTCUSDT");
    expect(within(b).getByTestId("breakout-fact-grade")).toHaveTextContent(BREAKOUT.noGrade);
    expect(within(b).getByTestId("breakout-to-calc")).toBeDisabled();
    expect(b).toHaveTextContent(BREAKOUT.noPrefill);
    expect(card("BTCUSDT")).toHaveAttribute("aria-pressed", "true");
    expect(card("LTCUSDT")).toHaveAttribute("aria-pressed", "false");
  });

  it("die Regeln stehen auf der Seite – mit den Schwellen des Rechenkerns", async () => {
    fakeLoader();
    view();
    const rules = screen.getByTestId("breakout-rules");
    expect(within(rules).getByText(BREAKOUT.rulesTitle)).toBeInTheDocument();
    expect(rules.querySelectorAll("li")).toHaveLength(6);
    expect(rules).toHaveTextContent("ersten 30 Minuten");
    expect(rules).toHaveTextContent("ab 1,5× gilt es als bestätigt, ab 2× als stark");
    expect(rules).toHaveTextContent("EMA 50");
    expect(rules).toHaveTextContent("ATR 14");
    expect(rules).toHaveTextContent("240 Minuten");
    expect(rules).toHaveTextContent("Die Note zählt Gründe – sie sagt nichts über einen Gewinn.");
  });

  it("Sitzungswechsel rechnet auf denselben Kerzen neu – ohne neuen Abruf; „Neu scannen“ lädt neu", async () => {
    const { load } = fakeLoader();
    view();
    await scan();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: BREAKOUT.sessions.london }));
    });
    await waitFor(() => expect(screen.getByTestId("breakout-section")).toHaveAttribute("data-session", "london"));
    expect(load).toHaveBeenCalledTimes(12);
    expect(screen.getByTestId("breakout-section")).toHaveAttribute("data-phase", "done");
    expect(screen.getByTestId("breakout-section").querySelector(".bo-lead")).toHaveTextContent(/London 8:00 \(UTC/);
    await scan();
    expect(load).toHaveBeenCalledTimes(24);
  });

  it("ein einzelner Markt fällt aus: sein Grund steht auf seiner Karte, die anderen bleiben", async () => {
    fakeLoader({ fail: (s) => (s === "AVAXUSDT" ? "Die Börse antwortet zu langsam." : null) });
    view();
    await scan();
    const avax = card("AVAXUSDT");
    expect(avax).toHaveAttribute("data-state", "error");
    expect(avax).toHaveTextContent("Die Börse antwortet zu langsam.");
    expect(avax).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId("breakout-checked")).toHaveTextContent("12/12"));
    expect(card("LTCUSDT")).toHaveAttribute("data-grade", "A+");
    expect(screen.queryByTestId("breakout-retry")).toBeNull();
  });

  it("Totalausfall: der Grund, „keine Ersatzdaten“, erneut versuchen – und keine einzige Zahl", async () => {
    const { load } = fakeLoader({ fail: () => "Du bist offline." });
    view();
    await scan();
    const msg = screen.getByTestId("breakout-msg");
    expect(msg).toHaveAttribute("data-tone", "error");
    expect(msg).toHaveTextContent("Keine Kerzen erhalten: Du bist offline. Ohne echte Kerzen prüft der Scanner nichts – es gibt keine Ersatzdaten.");
    expect(screen.getByTestId("breakout-grid").querySelectorAll("[data-testid=breakout-chart]")).toHaveLength(0);
    expect(screen.getByTestId("breakout-grid")).not.toHaveAttribute("data-done");
    expect(screen.getByTestId("breakout-top")).toHaveTextContent("0");
    expect(screen.getByTestId("breakout-detail")).toHaveAttribute("data-empty");
    expect(screen.getByTestId("breakout-stand")).toHaveTextContent("Quelle: keine Daten");
    await act(async () => {
      fireEvent.click(screen.getByTestId("breakout-retry"));
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(24));
  });

  it("erfüllt kein Markt alle Gründe, sagt die Seite das ruhig – keine Karte wird hervorgehoben", async () => {
    // jeder Markt bekommt das Drehbuch von XRP (Note B) – in seinem eigenen Preis macht das keinen Unterschied für die Note
    fakeLoader({ scenario: () => "XRPUSDT" });
    view();
    await scan();
    expect(screen.getByTestId("breakout-top")).toHaveTextContent("0");
    expect(screen.getByTestId("breakout-grid").querySelectorAll("[data-best]")).toHaveLength(0);
    expect(screen.getByTestId("breakout-msg")).toHaveTextContent(/Kein Markt erfüllt gerade alle Gründe\. Am weitesten ist \w+ mit Note B – nichts zu erzwingen ist auch eine Entscheidung\./);
  });

  it("gar kein Ausbruch: der Satz dazu, keine Note", async () => {
    fakeLoader({ scenario: () => "BTCUSDT" });
    view();
    await scan();
    expect(screen.getByTestId("breakout-msg")).toHaveTextContent(BREAKOUT.none);
    expect(screen.getByTestId("breakout-grid").querySelectorAll("[data-grade]")).toHaveLength(0);
  });

  it("die Ersatzquelle wird beim Namen genannt", async () => {
    fakeLoader({ source: "bybit" });
    view();
    await scan();
    expect(screen.getByTestId("breakout-stand")).toHaveTextContent("Quelle: Bybit USDT-Perp (Ersatzquelle, nicht Binance)");
  });

  it("„In den Rechner übernehmen“ belegt nur Paar, Richtung, Einstieg und Stop vor – kein Trade, kein Ziel", async () => {
    fakeLoader();
    view();
    await scan();
    const row = useBreakoutScan.getState().rows.LTCUSDT!;
    if (row.state !== "ok") throw new Error("expected ok");
    await act(async () => {
      fireEvent.click(screen.getByTestId("breakout-to-calc"));
    });
    const ui = useRiskUi.getState();
    expect(ui.calc).toMatchObject({ pair: "LTCUSDT", side: "short", target: "", capital: "", riskPct: "" });
    expect(Number(ui.calc.entry.replace(",", "."))).toBeCloseTo(row.read.price!, 2);
    // Stop = andere Seite der Spanne (Short: das Hoch)
    expect(Number(ui.calc.stop.replace(",", "."))).toBeCloseTo(BREAKOUT_SCENARIOS.LTCUSDT!.price * 1.0015, 2);
    expect(ui.prefillNote).toContain("Aus dem Ausbruch-Scanner vorbelegt – nur eine Vorbelegung, kein Trade:");
    expect(ui.prefillNote).toContain("LTCUSDT · Short");
    expect(ui.prefillNote).toContain("andere Seite der Spanne");
    await waitFor(() => expect(openFeature).toHaveBeenCalledWith("positionsrechner"));
    // tippt der Trader den Stop selbst, gehört der Wert ihm – der Hinweis geht
    act(() => useRiskUi.getState().setCalc({ stop: "52,5" }));
    expect(useRiskUi.getState().prefillNote).toBeNull();
  });

  it("kein Orderknopf, kein Drängen, kein Versprechen – und der Hinweis, dass es keine Beratung und kein Signal ist", async () => {
    fakeLoader();
    const { container } = view();
    await scan();
    const names = [...container.querySelectorAll("button")].map((b) => (b.textContent ?? "") + " " + (b.getAttribute("aria-label") ?? ""));
    for (const n of names) expect(n).not.toMatch(/kaufen|verkaufen|order|handeln|trade eröffnen|long gehen|short gehen/i);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bjetzt\b|schnell|nur noch|verpass|garantiert|sicherer gewinn|gewinnchance|beste chance|🎉/i);
    expect(text).toContain(BREAKOUT.note);
    expect(text).toContain("Nichts wird gehandelt oder gespeichert.");
  });
});
