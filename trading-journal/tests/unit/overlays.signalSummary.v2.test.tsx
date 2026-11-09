import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { parseSignalSnapshot, type SignalSnapshot } from "@/domain/signals";
import { knifeRows, SignalSummary, snapshotPartViews, StrengthBars } from "@/overlays/SignalSummary";

/** A v2 snapshot as `toSignalSnapshot` stores it (candle-close states, graded parts, falling-knife filter). */
const RAW = {
  at: "2026-10-08T07:30:00.000Z",
  side: "long",
  score: 81,
  strength: 3,
  tiers: 2,
  label: "Starker Long-Einstieg",
  valid: true,
  rsiOk: true,
  zoneOk: true,
  zone: "discount",
  tfs: [
    { tf: "30m", kind: "bottom", wt: -60, rsi: 31, ok: true, state: "strong", closes: 3 },
    { tf: "45m", kind: "buy", wt: -55, rsi: 35, ok: true, state: "provisional", closes: 0 },
    { tf: "1h", kind: null, wt: -20, rsi: 44, ok: false, state: "none", closes: 0 },
  ],
  v: 2,
  mode: "live",
  ladder: ["30m", "45m", "1h", "4h"],
  required: 2,
  state: "confirmed",
  confTiers: 1,
  provStrength: 3,
  partPoints: 25.5,
  parts: [
    {
      id: "traders",
      grade: 0.75,
      points: 7.5,
      weight: 10,
      ok: true,
      data: true,
      state: "confirmed",
      met: 3,
      period: "5m",
      items: [
        { id: "pos", met: true, raw: 66 },
        { id: "acc", met: true, raw: 65.2 },
        { id: "retail", met: true, raw: -0.5 },
        { id: "zone", met: false, raw: 0.62 },
      ],
    },
    {
      id: "div",
      grade: 0.8,
      points: 8,
      weight: 10,
      ok: true,
      data: true,
      state: "confirmed",
      tf: "1h",
      hits: [
        { tf: "1h", osc: "rsi", kind: "regular", state: "confirmed", barsAgo: 2 },
        { tf: "30m", osc: "wt", kind: "hidden", state: "provisional", barsAgo: 0 },
      ],
      items: [
        { id: "30m", met: true, raw: 0.25 },
        { id: "45m", met: false, raw: 0 },
        { id: "1h", met: true, raw: 0.8 },
        { id: "4h", met: null, raw: null },
      ],
    },
    {
      id: "sr",
      grade: 1,
      points: 10,
      weight: 10,
      ok: true,
      data: true,
      state: "confirmed",
      items: [
        { id: "near", met: true, raw: 0.4 },
        { id: "room", met: true, raw: 2.3 },
      ],
      lean: { label: "Demand-OB", price: 82450, distAtr: 0.4 },
      target: { label: "Supply-OB", price: 86100 },
      r: 2.3,
    },
  ],
  knife: { n: 2, items: [{ id: "structure", met: true }, { id: "divergence", met: true }, { id: "whale", met: false }] },
};
const SNAP = parseSignalSnapshot(RAW) as SignalSnapshot;

describe("SignalSummary – v2 snapshot (candle-close state, graded parts, falling-knife filter)", () => {
  it("the stored snapshot parses with every v2 field", () => {
    expect(SNAP).toBeTruthy();
    expect(SNAP.state).toBe("confirmed");
    expect(SNAP.parts).toHaveLength(3);
    expect(SNAP.knife?.n).toBe(2);
  });

  it("shows the state chip, per-timeframe states and the graded parts with their values", () => {
    render(<SignalSummary snap={SNAP} side="long" />);
    const root = screen.getByTestId("signal-summary");
    expect(root).toHaveAttribute("data-state", "confirmed");
    expect(screen.getByTestId("signal-summary-state")).toHaveTextContent("bestätigt");
    const pills = within(screen.getByRole("list", { name: "Timeframes" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(pills.slice(0, 3)).toEqual(["30m · Bottom · RSI 31,0 · stark", "45m · Kaufsignal · RSI 35,0 · vorläufig", "1h · kein Signal · RSI 44,0"]);

    const traders = screen.getByTestId("signal-summary-part-traders");
    expect(traders).toHaveTextContent("Top-Trader long · Retail rot");
    expect(traders).toHaveTextContent("3 von 4 · +7,5 Punkte");
    expect(traders).toHaveTextContent("erfüllt: Top-Trader Positionen66,0 % Long");
    expect(traders).toHaveTextContent("Retail rot (5m)−0,5 pp");
    expect(traders).toHaveTextContent("offen: Preis im DiscountDiscount · 62 %");

    const div = screen.getByTestId("signal-summary-part-div");
    expect(div).toHaveTextContent("Bullische Divergenz");
    expect(div).toHaveTextContent("1h · +8,0 Punkte");
    expect(div).toHaveTextContent("1hRSI regulär");
    expect(div).toHaveTextContent("30mWT versteckt · vorläufig");
    expect(div).toHaveTextContent("keine Daten: 4hkeine Daten");

    const sr = screen.getByTestId("signal-summary-part-sr");
    expect(sr).toHaveTextContent("2,3 R · +10,0 Punkte");
    expect(sr).toHaveTextContent("Am Support / DemandDemand-OB 82.450 · 0,4 ATR");
    expect(sr).toHaveTextContent("Platz bis WiderstandSupply-OB 86.100 · 2,3 R");

    const knife = screen.getByTestId("signal-summary-part-knife");
    expect(knife).toHaveTextContent("Falling-Knife-Filter");
    expect(knife).toHaveTextContent("2 von 3");
    expect(knife).toHaveTextContent("offen: Whale vs. Retailoffen");
  });

  it("a provisional entry: label without the prefix, ⚠ chip (live countdown on the shared clock), strength on the close outlined", () => {
    const prov = { ...SNAP, state: "provisional" as const, valid: false, strength: 0, provStrength: 3, label: "Vorläufig: Starker Long-Einstieg" };
    const { rerender } = render(<SignalSummary snap={prov} side="long" />);
    expect(screen.getByText("Starker Long-Einstieg")).toBeInTheDocument();
    expect(screen.queryByText(/^Vorläufig:/)).toBeNull();
    expect(screen.getByTestId("signal-summary-state")).toHaveTextContent("⚠vorläufig");
    expect(screen.getByRole("img", { name: "Stärke 3 von 4 bei Kerzenschluss (vorläufig)" })).toBeInTheDocument();
    expect(screen.getByText(/bei Kerzenschluss$/)).toBeInTheDocument();
    rerender(<SignalSummary snap={prov} side="long" closesAt={Date.now() + 240_500} />);
    expect(screen.getByTestId("signal-summary-state").textContent).toMatch(/^⚠vorläufig · schließt in 4:0\d$/);
  });

  it("short side mirrors the shares and words", () => {
    const short = parseSignalSnapshot({ ...RAW, side: "short", zone: "premium" }) as SignalSnapshot;
    const views = snapshotPartViews(short);
    expect(views[0]!.title).toBe("Top-Trader short · Retail grün");
    expect(views[0]!.rows[0]!.value).toBe("34,0 % Short");
    expect(views[0]!.rows[3]).toMatchObject({ label: "Preis im Premium", value: "Premium · 62 %" });
    expect(views[1]!.title).toBe("Bärische Divergenz");
    expect(views[2]!.rows.map((r) => r.label)).toEqual(["Am Widerstand / Supply", "Platz bis Support"]);
    expect(knifeRows(short).map((r) => r.label)[0]).toBe("Lower High / BOS 1H·4H");
  });

  it("a snapshot with a delta window shows the Whale–Retail-Delta with its change (long rot, short grün)", () => {
    const withDelta = (side: "long" | "short", chg: number | null) => {
      const traders = { ...RAW.parts[0]!, items: RAW.parts[0]!.items.map((i) => (i.id === "retail" ? { ...i, raw: side === "long" ? -3.7 : 3.7 } : i)), delta: side === "long" ? -3.7 : 3.7, deltaChg: chg, deltaWindow: "2h" };
      return parseSignalSnapshot({ ...RAW, side, zone: side === "long" ? "discount" : "premium", parts: [traders, ...RAW.parts.slice(1)] }) as SignalSnapshot;
    };
    expect(snapshotPartViews(withDelta("long", -2.7))[0]!.rows[2]).toMatchObject({ id: "retail", label: "Whale–Retail-Delta rot", value: "−3,7 pp · 2h −2,7", met: true });
    expect(snapshotPartViews(withDelta("short", 4.7))[0]!.rows[2]).toMatchObject({ label: "Whale–Retail-Delta grün", value: "+3,7 pp · 2h +4,7" });
    // no older point stored: the level alone
    expect(snapshotPartViews(withDelta("long", null))[0]!.rows[2]!.value).toBe("−3,7 pp");
    render(<SignalSummary snap={withDelta("long", -2.7)} side="long" />);
    expect(screen.getByTestId("signal-summary-part-traders")).toHaveTextContent("Whale–Retail-Delta rot−3,7 pp · 2h −2,7");
  });

  it("an older snapshot has no state chip and no parts section", () => {
    const old = parseSignalSnapshot({ ...RAW, state: undefined, parts: undefined, knife: undefined, v: undefined }) as SignalSnapshot;
    render(<SignalSummary snap={old} side="long" />);
    expect(screen.queryByTestId("signal-summary-state")).toBeNull();
    expect(screen.queryByTestId("signal-summary-parts")).toBeNull();
  });

  it("no data parts say so instead of failing; free room reads `frei`", () => {
    const views = snapshotPartViews({
      side: "long",
      zone: null,
      parts: [
        { id: "traders", grade: 0, points: 0, weight: 10, ok: false, data: false, state: "none", met: 0, items: [{ id: "pos", met: null, raw: null }] },
        { id: "sr", grade: 0.8, points: 8, weight: 10, ok: false, data: true, state: "confirmed", items: [{ id: "room", met: true, raw: null }], lean: null, target: null, r: null, free: true },
      ],
    });
    expect(views[0]).toMatchObject({ detail: "keine Daten", data: false });
    expect(views[0]!.rows[0]).toMatchObject({ value: "keine Daten", met: null });
    expect(views[1]!.rows[1]!.value).toBe("frei (kein Widerstand)");
    expect(views[1]!.detail).toBe("Platz frei · +8,0 Punkte");
  });

  it("strength bars of a provisional entry name the strength on the close", () => {
    render(<StrengthBars snap={{ side: "long", valid: false, strength: 0, state: "provisional", provStrength: 2 }} />);
    expect(screen.getByRole("img", { name: "Signal vorläufig, Stärke 2 von 4 bei Kerzenschluss" })).toHaveAttribute("data-state", "provisional");
  });
});
