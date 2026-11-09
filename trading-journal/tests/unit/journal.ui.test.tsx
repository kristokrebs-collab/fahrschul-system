/**
 * Journal-v3 building blocks (P06): tag input, rating dots, the MAE / MFE bar maths, the fills timeline and the share
 * picture model (privacy: no money amounts by default).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fillStats } from "@/domain/fills";
import type { Fill, TradeRating } from "@/domain/types";
import { shareCardFilename, shareCardModel } from "@/journal/sharePng";
import { excursionAxis, excursionPrices, keptShare, type ExcursionTrade } from "@/journal/ui/ExcursionBar";
import { FillsTimeline, fillPositions } from "@/journal/ui/FillsTimeline";
import { RatingDots } from "@/journal/ui/RatingDots";
import { MAX_TAGS, TagInput, addTag, cleanTag, tagSuggestions } from "@/journal/ui/TagInput";
import { MotionRoot } from "@/motion/MotionRoot";
import { enriched, mkTrade } from "./domain.fixtures";

describe("tags", () => {
  it("cleanTag / addTag / suggestions", () => {
    expect(cleanTag("  ##London   Open ")).toBe("London Open");
    expect(cleanTag("x".repeat(50))).toHaveLength(32);
    expect(addTag(["London"], "#london")).toEqual(["London"]);
    expect(addTag(["London"], " ")).toEqual(["London"]);
    expect(addTag(Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`), "neu")).toHaveLength(MAX_TAGS);
    expect(addTag([], "Breakout")).toEqual(["Breakout"]);
    expect(tagSuggestions([{ tags: ["b", "a"] }, { tags: ["a"] }, {}])).toEqual(["a", "b"]);
  });

  function Harness({ initial = [] as string[] }) {
    const [tags, setTags] = useState(initial);
    return (
      <MotionRoot>
        <TagInput value={tags} onChange={setTags} suggestions={["London", "Breakout"]} />
        <output data-testid="tags">{tags.join("|")}</output>
      </MotionRoot>
    );
  }

  it("Enter / Komma adds, a chip click removes, Backspace on empty removes the last, suggestions add", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Neuer Tag");
    fireEvent.change(field, { target: { value: "#Range-Low" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "NY" } });
    fireEvent.keyDown(field, { key: "," });
    expect(screen.getByTestId("tags")).toHaveTextContent("Range-Low|NY");
    fireEvent.click(screen.getByRole("button", { name: "#London" }));
    expect(screen.getByTestId("tags")).toHaveTextContent("Range-Low|NY|London");
    expect(screen.queryByRole("button", { name: "#London" })).toBeNull(); // taken ones are not offered again
    fireEvent.click(screen.getByRole("button", { name: "Tag „NY“ entfernen" }));
    expect(screen.getByTestId("tags")).toHaveTextContent("Range-Low|London");
    fireEvent.keyDown(field, { key: "Backspace" });
    expect(screen.getByTestId("tags")).toHaveTextContent(/^Range-Low$/);
  });
});

describe("RatingDots", () => {
  function Harness() {
    const [v, setV] = useState<TradeRating | null>(null);
    return (
      <MotionRoot>
        <RatingDots value={v} onChange={setV} />
        <output data-testid="v">{v ?? "–"}</output>
      </MotionRoot>
    );
  }

  it("a radiogroup of five; choosing again clears; arrows move", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Bewertung" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
    fireEvent.click(screen.getByRole("radio", { name: "4 von 5 · Stark" }));
    expect(screen.getByTestId("v")).toHaveTextContent("4");
    expect(screen.getByRole("radio", { name: "4 von 5 · Stark" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByTestId("v")).toHaveTextContent("5");
    fireEvent.click(screen.getByRole("radio", { name: "5 von 5 · Lehrbuch" }));
    expect(screen.getByTestId("v")).toHaveTextContent("–");
  });

  it("read-only it is one image with the value in words", () => {
    render(
      <MotionRoot>
        <RatingDots value={3} />
      </MotionRoot>,
    );
    expect(screen.getByRole("img", { name: "Bewertung: 3 von 5 · Solide" })).toBeInTheDocument();
  });
});

describe("MAE / MFE bar maths", () => {
  const base: ExcursionTrade = { side: "long", entry: 100, exit: 104, stop: null, r: null, mae: 2, mfe: 5, maeR: null, mfeR: null, result: "win", status: "closed" };

  it("axis in % of the entry without a stop, in R with one", () => {
    expect(excursionAxis(base)).toEqual({ unit: "%", mae: 2, mfe: 5, exit: 4, stop: null });
    expect(excursionAxis({ ...base, maeR: 0.5, mfeR: 2, r: 1.2 })).toEqual({ unit: "R", mae: 0.5, mfe: 2, exit: 1.2, stop: 1 });
    expect(excursionAxis({ ...base, mae: null })).toBeNull();
  });

  it("kept share: exit move ÷ MFE, capped at 100 % (whole bars can understate the MFE)", () => {
    expect(keptShare(base)).toBeCloseTo(0.8, 9);
    expect(keptShare({ ...base, exit: 108 })).toBe(1);
    expect(keptShare({ ...base, exit: 98 })).toBeCloseTo(-0.4, 9);
    expect(keptShare({ ...base, result: "open" })).toBeNull();
  });

  it("with fills the Ø entry / Ø exit are the reference", () => {
    const fills: Fill[] = [
      { id: "a", at: "2026-10-01T10:00", side: "open", price: 102, qty: 1, kind: "entry" },
      { id: "b", at: "2026-10-01T11:00", side: "open", price: 98, qty: 1, kind: "add" },
      { id: "c", at: "2026-10-01T12:00", side: "close", price: 103, qty: 1, kind: "partial" },
      { id: "d", at: "2026-10-01T13:00", side: "close", price: 105, qty: 1, kind: "exit" },
    ];
    const t = { ...base, entry: 102, exit: 105, fills };
    expect(excursionPrices(t)).toEqual({ entry: 100, exit: 104 });
    expect(keptShare(t)).toBeCloseTo(0.8, 9);
  });
});

describe("FillsTimeline", () => {
  it("positions by time (even spacing without times)", () => {
    expect(fillPositions([0, 50, 100])).toEqual([0, 0.5, 1]);
    expect(fillPositions([0, Number.NaN, 100])).toEqual([0, 0.5, 1]);
    expect(fillPositions([7])).toEqual([0.5]);
  });

  it("lists every fill with its kind, price × qty; a profitable exit is tinted", () => {
    const fills: Fill[] = [
      { id: "a", at: "2026-10-01T10:00", side: "open", price: 100, qty: 1, kind: "entry" },
      { id: "b", at: "2026-10-01T12:00", side: "close", price: 110, qty: 1, kind: "exit" },
    ];
    render(
      <MotionRoot>
        <FillsTimeline stats={fillStats(fills, "long")} />
      </MotionRoot>,
    );
    const items = within(screen.getByRole("list", { name: "Fills der Position" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Einstieg01.10.26 10:00100 × 1", "Ausstieg01.10.26 12:00110 × 1"]);
    expect(items[1]!.querySelector(".text-win")).not.toBeNull();
  });
});

describe("share picture model", () => {
  const t = enriched([mkTrade({ id: "s", date: "2026-10-02T09:30", exitDate: "2026-10-02T13:30", pair: "BTC/USDT", entry: 80000, stop: 79000, exit: 84000, size: 8000, fees: 4, leverage: 4, rating: 5, tags: ["London"], market: "perp", exchange: "bitunix", mfeR: 4.5 })])[0]!;

  it("privacy first: R and % only by default, the P&L only with `full`", () => {
    const m = shareCardModel(t);
    expect(m).toMatchObject({ pair: "BTC/USDT", sideLabel: "▲ LONG", hero: "+3,96R", heroTone: "win", heroCaption: "R-Multiple", rating: 5, tags: ["London"], account: "Scalp · Perp · bitunix" });
    expect(m.facts.map((f) => f.label)).toEqual(["Einstieg", "Ausstieg", "Bewegung", "Haltedauer", "MFE", "Hebel"]);
    expect(JSON.stringify(m)).not.toContain("396"); // no money amount anywhere
    const full = shareCardModel(t, { privacy: "full", currency: "USDT" });
    expect(full.facts.find((f) => f.label === "P&L")?.value).toBe("+396,00 USDT");
  });

  it("price path normalised, entry / exit placed on it; file name", () => {
    const from = new Date("2026-10-02T09:00").getTime();
    const path = Array.from({ length: 6 }, (_, i) => ({ time: from + i * 3_600_000, close: 80000 + i * 1000 }));
    const m = shareCardModel(t, { path });
    expect(m.path?.pts).toHaveLength(6);
    expect(m.path?.entry?.[0]).toBeCloseTo(0.1, 9);
    expect(m.path?.exit?.[0]).toBeCloseTo(0.9, 9);
    expect(shareCardFilename(t)).toBe("trade-BTCUSDT-2026-10-02.png");
    expect(shareCardFilename({ pair: "", date: "" })).toBe("trade-TRADE-datum.png");
  });

  it("an open trade without R or move says so", () => {
    const open = enriched([mkTrade({ id: "o", date: "2026-10-02T09:30", status: "open", entry: 80000 })])[0]!;
    expect(shareCardModel(open)).toMatchObject({ hero: "OFFEN", heroCaption: "Position läuft" });
    vi.restoreAllMocks();
  });
});
