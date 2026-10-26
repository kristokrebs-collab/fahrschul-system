/**
 * F64 views: der Indikator-Vertrag (aufklappbar, gemessener erster Wert, was den Wert gestützt hat) und der Abgleich einer
 * TradingView-Chartdaten-CSV mit der eigenen Berechnung – im Browser gelesen, Spalten zugeordnet, Urteil mit Zahlen.
 * Die Datei ist nach dem Format des Exports nachgebaut (Spalten aus den Funktionen des Labors auf der festen Testreihe).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { INDICATORS, testBars, type IndicatorId } from "@/domain/tvimport";
import { IndicatorCheckCard } from "@/views/labor/IndicatorCheckCard";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const csvFile = (text: string, name = "chart.csv") => new File([text], name, { type: "text/csv" });
const iso = (sec: number): string => new Date(sec * 1000).toISOString().replace(".000Z", "Z");

/** a chart-data export of the test series with one plot column made by the lab's own function (`tweak` changes the values) */
function exportOf(id: IndicatorId, output: string, header: string, tweak?: (v: number[]) => number[], n = 400): string {
  // the candles as the file writes them (4 places): TradingView calculated on exactly these
  const bars = testBars(n).map((b) => ({ ...b, o: +b.o.toFixed(4), h: +b.h.toFixed(4), l: +b.l.toFixed(4), c: +b.c.toFixed(4) }));
  const d = INDICATORS.find((x) => x.id === id)!;
  const inputs = Object.fromEntries(d.params.map((p) => [p.key, p.def]));
  const values = (tweak ?? ((v: number[]) => v))(d.compute(bars, inputs)[output]!);
  const rows = bars.map((b, i) => `${iso(b.t)},${b.o.toFixed(4)},${b.h.toFixed(4)},${b.l.toFixed(4)},${b.c.toFixed(4)},${b.v},${Number.isFinite(values[i]!) ? values[i]!.toFixed(6) : ""}`);
  return [`time,open,high,low,close,Volume,${header}`, ...rows].join("\n");
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
});

const mount = () => render(<MotionRoot><IndicatorCheckCard /></MotionRoot>);
async function pick(text: string) {
  const input = screen.getByTestId("labor-tv-ind-file") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [csvFile(text)] } });
  });
  await waitFor(() => expect(screen.getByTestId("labor-tv-ind-read")).toBeTruthy());
}

describe("Indikator-Vertrag", () => {
  it("zugeklappt; aufgeklappt für jeden Indikator Pine-Aufruf, Eingaben, Reihen, erster Wert (gemessen) und was ihn gestützt hat", () => {
    mount();
    const contract = screen.getByTestId("labor-tv-contract");
    expect(within(contract).getByTestId("labor-tv-known")).toHaveTextContent("kein Wiederzeichnen");
    expect(screen.queryAllByTestId("labor-tv-contract-item")).toHaveLength(0);
    fireEvent.click(within(contract).getByTestId("labor-tv-contract-toggle"));
    const items = screen.getAllByTestId("labor-tv-contract-item");
    expect(items).toHaveLength(INDICATORS.length);
    const rsi = items.find((i) => i.getAttribute("data-indicator") === "rsi")!;
    expect(rsi).toHaveTextContent("ta.rsi(close, 14)");
    expect(within(rsi).getByTestId("labor-tv-warmup")).toHaveTextContent("ab Kerze 15 · eingeschwungen nach etwa");
    expect(rsi).toHaveTextContent("gegen TradingView-Werte geprüft");
    const sma = items.find((i) => i.getAttribute("data-indicator") === "sma")!;
    expect(within(sma).getByTestId("labor-tv-warmup")).toHaveTextContent("ab Kerze 20 · keine Rekursion, kein Einschwingen");
    const keltner = items.find((i) => i.getAttribute("data-indicator") === "keltner")!;
    expect(keltner).toHaveTextContent("nach Definition nachgebaut");
    expect(keltner).toHaveTextContent("nicht gegen TradingView-Zahlen geprüft");
    fireEvent.click(within(contract).getByTestId("labor-tv-contract-toggle"));
    expect(screen.queryAllByTestId("labor-tv-contract-item")).toHaveLength(0);
  });
});

describe("Indikator-Abgleich mit einem Export", () => {
  it("liest die Datei im Browser, ordnet „RSI“ dem RSI zu und meldet „gleichwertig validiert“ – nichts wird hochgeladen", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();
    await pick(exportOf("rsi", "rsi", "RSI"));
    expect(screen.getByTestId("labor-tv-ind-summary").textContent).toMatch(/400 Kerzen gelesen .* Zeiteinheit 1D · 1 Spalte mit Werten/);
    const col = screen.getByTestId("labor-tv-ind-col");
    expect(col).toHaveAttribute("data-column", "RSI");
    expect(within(col).getByTestId("labor-tv-ind-select")).toHaveTextContent("RSI · RSI");
    const res = within(col).getByTestId("labor-tv-ind-result");
    expect(res).toHaveAttribute("data-verdict", "equal");
    expect(res).toHaveTextContent("gleichwertig validiert");
    expect(within(res).getByTestId("labor-tv-ind-text")).toHaveTextContent("stimmt die Berechnung des Labors innerhalb der Rundung des Exports");
    expect(within(res).getByTestId("labor-tv-ind-numbers")).toHaveTextContent(/Erster WertTV 15 · Labor 15/);
    expect(within(res).queryByTestId("labor-tv-ind-worst")).toBeNull();
    expect(screen.getByTestId("labor-tv-ind-note")).toHaveTextContent("kein allgemeines Zertifikat");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("andere Eingaben als im Chart weichen ab – mit den größten Abweichungen; mit den richtigen Eingaben stimmt es", async () => {
    mount();
    await pick(exportOf("rsi", "rsi", "RSI"));
    const col = screen.getByTestId("labor-tv-ind-col");
    const len = within(col).getByTestId("labor-tv-ind-in-len");
    fireEvent.change(len, { target: { value: "21" } });
    fireEvent.blur(len);
    await waitFor(() => expect(within(col).getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "differs"));
    const res = within(col).getByTestId("labor-tv-ind-result");
    expect(res).toHaveTextContent("weicht ab");
    expect(within(res).getByTestId("labor-tv-ind-text")).toHaveTextContent("andere Eingaben als im Chart");
    expect(within(within(res).getByTestId("labor-tv-ind-worst")).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.change(len, { target: { value: "14" } });
    fireEvent.blur(len);
    await waitFor(() => expect(within(col).getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "equal"));
  });

  it("eine doppeldeutige Spalte („Basis“) bleibt ohne Vorgabe, bis du wählst; ein Fehler in der Datei nennt die Zeile", async () => {
    mount();
    const lines = exportOf("bollinger", "mid", "Basis").split("\n");
    lines[7] = "gestern,1,2,0.5,1.5,1,5";
    await pick(lines.join("\n"));
    expect(screen.getByTestId("labor-tv-ind-errors")).toHaveTextContent("Zeile 8");
    const col = screen.getByTestId("labor-tv-ind-col");
    expect(within(col).getByTestId("labor-tv-ind-select")).toHaveTextContent("– nicht vergleichen –");
    expect(within(col).queryByTestId("labor-tv-ind-result")).toBeNull();
    fireEvent.click(within(col).getByTestId("labor-tv-ind-select"));
    fireEvent.click(screen.getByRole("option", { name: "Bollinger-Bänder · Mittellinie" }));
    await waitFor(() => expect(within(col).getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "equal"));
  });

  it("zu wenige gemeinsame Werte und eine zu kurze, nicht eingeschwungene Datei sagen es – kein „weicht ab“", async () => {
    mount();
    await pick(exportOf("sma", "sma", "SMA", undefined, 40));
    expect(within(screen.getByTestId("labor-tv-ind-col")).getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "few");
    // EMA(200) mit anderem Startwert auf 120 Kerzen: offen – die Länge steht im Namen der Spalte
    await pick(exportOf("ema", "ema", "EMA200", (v) => v.map((x) => x * 1.01), 120));
    await waitFor(() => expect(screen.getByTestId("labor-tv-ind-col")).toHaveAttribute("data-column", "EMA200"));
    const res = await within(screen.getByTestId("labor-tv-ind-col")).findByTestId("labor-tv-ind-result");
    expect(res).toHaveAttribute("data-verdict", "open");
    expect(res).toHaveTextContent("Datei zu kurz zum Einschwingen");
  });

  it("ohne passende Kopfzeile oder ohne Indikatorspalte: eine Meldung mit Grund, kein Absturz", async () => {
    mount();
    await pick("foo,bar\n1,2");
    expect(screen.getByTestId("labor-tv-ind-errors")).toHaveTextContent("fehlen die Spalten");
    expect(screen.queryByTestId("labor-tv-ind-col")).toBeNull();
    const bare = exportOf("rsi", "rsi", "RSI").split("\n").map((l) => l.split(",").slice(0, 6).join(",")).join("\n");
    await pick(bare);
    expect(screen.getByTestId("labor-tv-ind-read")).toHaveTextContent("keine Spalte mit Indikatorwerten");
  });
});
