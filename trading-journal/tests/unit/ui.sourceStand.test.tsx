/**
 * SourceStand (Selbstprüfung): the source and time line of the analysis cards – real timestamps are formatted,
 * a missing time or source is "keine Daten" (never an estimate), every feed source has a trader-facing name.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ddmmHHmm } from "@/market/format";
import { date, time } from "@/lib/format";
import { NO_DATA, SOURCE_LABEL, SourceStand, standText } from "@/ui/SourceStand";

const AT = Date.UTC(2026, 9, 24, 21, 40);

describe("SourceStand", () => {
  it("names the source and formats each time (short: day, month, time)", () => {
    const text = standText("Binance USDⓈ-M", [{ label: "Abruf", at: AT }, { label: "letzter Schluss 4h", at: AT - 3_600_000 }]);
    expect(text).toBe(`Quelle: Binance USDⓈ-M · Abruf ${ddmmHHmm(AT)} · letzter Schluss 4h ${ddmmHHmm(AT - 3_600_000)}`);
  });

  it("long adds the year for periods that span months", () => {
    expect(standText("Binance USDⓈ-M, geschlossene Kerzen", [{ label: "Zeitraum von", at: AT, long: true }])).toBe(`Quelle: Binance USDⓈ-M, geschlossene Kerzen · Zeitraum von ${date(new Date(AT))} ${time(new Date(AT))}`);
    expect(date(new Date(AT))).toMatch(/\.26$/);
  });

  it("a missing time or source is 'keine Daten' – nothing is estimated", () => {
    expect(standText(null, [{ label: "Abruf", at: null }, { label: "letzter Schluss 1D", at: undefined }, { label: "x", at: Number.NaN }])).toBe(`Quelle: ${NO_DATA} · Abruf ${NO_DATA} · letzter Schluss 1D ${NO_DATA} · x ${NO_DATA}`);
    expect(NO_DATA).toBe("keine Daten");
  });

  it("renders as one calm paragraph in the readable grey", () => {
    render(<SourceStand source="Binance USDⓈ-M" parts={[{ label: "Abruf", at: AT }]} testId="stand" />);
    const p = screen.getByTestId("stand");
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("text-mute");
    expect(p.className).not.toContain("text-faint");
    expect(p).toHaveTextContent("Quelle: Binance USDⓈ-M · Abruf");
  });

  it("every feed source has a name; Binance (also via the EU proxy) is named Binance USDⓈ-M", () => {
    for (const s of ["binance", "proxy", "bybit", "okx", "tradingview", "cache"] as const) expect(SOURCE_LABEL[s].length).toBeGreaterThan(3);
    expect(SOURCE_LABEL.binance).toBe("Binance USDⓈ-M");
    expect(SOURCE_LABEL.proxy).toContain("Binance USDⓈ-M");
    expect(SOURCE_LABEL.bybit).toContain("Ersatzquelle");
  });
});
