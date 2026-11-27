/**
 * "Was ist ein Flip?" (Paket W): the explainer on top of the Top-Trader card. Pure model (the window, flip detection, the sentence
 * from what the history gives, gaps that stay gaps, the empty states, the alarm note) and the component in jsdom (text only since the
 * Rücknahme R4: title, flip sentence, provenance, hint, "Wie lese ich das?", the alert link – no chart of its own, no schema). Wording: no string of the explainer – nor any sentence the model
 * builds – may contain the word for on-chain big holders, a data vendor's name or "Abverkauf kommt"; the actors are always
 * "Top-Trader (oberste 20 % nach Einsatz, Binance)". Mock series only; nothing here is checked against real Binance values.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTraderNet, type NetPoint, type NetPriceBar, type NetRatioPoint } from "@/domain/signals";
import { findNetGaps } from "@/domain/signals/netSeries";
import { installDomPolyfills } from "./views.overview.harness";

const opened = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/app/featureOpen", () => ({ openFeature: (id: string) => void opened.ids.push(id) }));

import FlipExplainer from "@/views/markt/FlipExplainer";
import { alarmNote, emptyCaption, flipModel, FLIP_WINDOW_DAYS, windowOf } from "@/views/markt/flipExplainerModel";
import { FLIP, FLIP_WHO, flipStringsFlat } from "@/views/markt/flipExplainerStrings";
import { provenanceOf, type WalState } from "@/views/markt/traderNetWal";

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 1);
const pts = (longs: number[], t0 = T0): NetRatioPoint[] => longs.map((l, i) => ({ time: t0 + i * H, longPct: l, shortPct: 100 - l }));
const bars = (n: number, t0 = T0): NetPriceBar[] => Array.from({ length: n }, (_, i) => ({ time: t0 + i * H, open: 70_000 + i * 20, close: 70_010 + i * 20 }));
const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);
const viewOf = (longs: number[], t0 = T0) => buildTraderNet(pts(longs, t0), bars(longs.length, t0), t0 + longs.length * H, H);
const netPoints = (longs: number[], t0 = T0): NetPoint[] => viewOf(longs, t0).points;
const FORBIDDEN = /\bWal(e|en|s)?\b|Glassnode|Abverkauf (kommt|folgt)|kommt ein Abverkauf|garantiert/i;

/** 100 h net long (55 %), then 60 h net short (44 %): ONE flip to Short 60 h ago, none before it. */
const SHORT_FLIP = [...rep(55, 100), ...rep(44, 60)];
/** short (45 %) for 60 h, long (56 %) for 80 h, short again for 60 h: a flip to Short and an earlier flip to Long. */
const TWO_FLIPS = [...rep(45, 60), ...rep(56, 80), ...rep(44, 60)];

function input(longs: number[], state: WalState = "ok", extra: Partial<Parameters<typeof flipModel>[0]> = {}) {
  const v = viewOf(longs);
  return { state, points: v.points, gaps: [], view: v, ...extra };
}

describe("flipModel: the flip and its sentence come from the history", () => {
  it("a flip to Short inside the window: sentence 'im geladenen Verlauf … erstmals', the price since the flip", () => {
    const m = flipModel(input(SHORT_FLIP));
    expect(m.kind).toBe("flip");
    expect(m.side).toBe("short");
    expect(m.flip).toMatchObject({ from: "long", to: "short" });
    expect(m.caption).toMatch(new RegExp(`^Flip am \\d\\d\\.\\d\\d\\.: ${FLIP_WHO.replace(/[()]/g, "\\$&")} sind im geladenen Verlauf von 6 Tagen erstmals netto Short\\. Preis seit dem Flip: [+−]\\d`));
    expect(m.netNow).toBe("−12,0 Pkt.");
    expect(m.windowLabel).toBe("geladener Verlauf: 6 Tage");
    expect(m.points).toHaveLength(160);
  });

  it("an earlier flip in the history: 'erstmals seit <Datum> netto Short' with the date of the flip before", () => {
    const m = flipModel(input(TWO_FLIPS));
    expect(m.kind).toBe("flip");
    const prev = new Date(T0 + 60 * H + 0).getUTCDate();
    expect(prev).toBeGreaterThan(0);
    expect(m.caption).toMatch(/sind erstmals seit \d\d\.\d\d\. netto Short\./);
    expect(m.caption).not.toMatch(/im geladenen Verlauf/);
  });

  it("a flip to Long says Long (the label is not always 'short')", () => {
    const m = flipModel(input([...rep(44, 60), ...rep(56, 100)]));
    expect(m.kind).toBe("flip");
    expect(m.side).toBe("long");
    expect(m.caption).toMatch(/netto Long\./);
  });

  it("the window is the newest 14 days; a flip before it is said honestly and not drawn", () => {
    const longs = [...rep(55, 24), ...rep(44, 20 * 24)]; // flip on day 1 of 21
    const m = flipModel(input(longs));
    expect(windowOf(netPoints(longs)).windowLabel).toBe(`letzte ${FLIP_WINDOW_DAYS} Tage`);
    expect(m.kind).toBe("flip-before");
    expect(m.flip).toBeNull();
    expect(m.caption).toMatch(/^Kein Flip in den gezeigten Tagen: .* sind seit \d\d\.\d\d\. netto Short\./);
    expect(m.points[m.points.length - 1]!.t - m.points[0]!.t).toBeLessThanOrEqual(FLIP_WINDOW_DAYS * DAY);
  });

  it("never flipped: 'Kein Flip im geladenen Verlauf …', no marker", () => {
    const m = flipModel(input(rep(55, 160)));
    expect(m.kind).toBe("no-flip");
    expect(m.flip).toBeNull();
    expect(m.caption).toMatch(/^Kein Flip im geladenen Verlauf von 6 Tagen: .* sind durchgehend netto Long\.$/);
  });

  it("balanced (inside the dead band): neither side is claimed", () => {
    const m = flipModel(input([...rep(55, 100), ...rep(50.2, 60)]));
    expect(m.kind).toBe("balanced");
    expect(m.side).toBeNull();
    expect(m.caption).toContain("gerade ausgeglichen");
    expect(m.caption).not.toMatch(/sind (erstmals|im geladenen|durchgehend|seit).* netto (Long|Short)/);
  });

  it("gaps stay gaps: the window keeps them, nothing is bridged, and the flip is that of the newest gap-free run", () => {
    // a hole of 30 h in the middle of a net long stretch, then the flip to Short after it
    const t = [...Array.from({ length: 60 }, (_, i) => i), ...Array.from({ length: 80 }, (_, i) => 90 + i)];
    const longs = t.map((i) => (i < 110 ? 55 : 44));
    const points: NetPoint[] = t.map((i, k) => ({ t: T0 + i * H, net: 2 * longs[k]! - 100, longPct: longs[k]!, price: 70_000 + i, s: H }));
    const gaps = findNetGaps(points, H);
    expect(gaps).toHaveLength(1);
    const run = points.slice(gaps[0]!.index + 1);
    const view = buildTraderNet(
      run.map((p) => ({ time: p.t, longPct: p.longPct, shortPct: 100 - p.longPct })),
      [],
      T0 + 200 * H,
      H,
    );
    const m = flipModel({ state: "ok", points, gaps, view });
    expect(m.gaps).toHaveLength(1);
    expect(m.gaps[0]).toMatchObject({ from: T0 + 59 * H, to: T0 + 90 * H });
    expect(m.points).toHaveLength(points.length);
  });

  it("no data / loading / too little history: an honest state with the reason, no chart", () => {
    const loading = flipModel({ state: "loading", points: [], gaps: [], view: null });
    expect(loading.kind).toBe("loading");
    expect(loading.caption).toBe(FLIP.loading);
    const none = flipModel({ state: "none", points: [], gaps: [], view: null, reason: "Binance blockiert (Region)" });
    expect(none).toMatchObject({ kind: "empty", points: [], flip: null, caption: "Binance blockiert (Region)" });
    expect(emptyCaption("none")).toContain("kein Satz zum Flip");
    expect(emptyCaption("none")).not.toMatch(/Schema|Grafik/);
    const short = flipModel({ state: "short", points: [], gaps: [], view: viewOf(rep(55, 5)) });
    expect(short.kind).toBe("empty");
    expect(short.caption).toMatch(/^Zu wenig Verlauf/);
  });

  it("stale and stored-only states still draw what is there (the card marks them itself)", () => {
    expect(flipModel(input(SHORT_FLIP, "stale")).kind).toBe("flip");
    expect(flipModel(input(SHORT_FLIP, "archive")).kind).toBe("flip");
  });
});

describe("the alarm note: only what the plan really has", () => {
  const base = { cloud: true, signedIn: true, channels: 1, phoneCalls: 0, planLabel: "Free" };
  it("says what the build and the account allow", () => {
    expect(alarmNote({ ...base, cloud: false })).toBe("In dieser Version ohne Konto gibt es die Alarme nicht.");
    expect(alarmNote({ ...base, signedIn: false })).toMatch(/brauchen ein Konto/);
  });
  it("names the plan's channels and calls (from PLAN_LIMITS) – and nothing when nothing is gated", () => {
    expect(alarmNote(base)).toBe("Dein Tarif Free: 1 Alarm-Kanal, Anrufe ab Premium.");
    expect(alarmNote({ ...base, channels: 3, phoneCalls: 30, planLabel: "Premium" })).toBe("Dein Tarif Premium: 3 Alarm-Kanäle, Anrufe bis 30 im Monat.");
    expect(alarmNote({ ...base, channels: Infinity })).toBe("");
  });
});

describe("wording", () => {
  it("no string of the explainer, no sentence of the model carries a forbidden word; the actors have their fixed name", () => {
    const sentences = [
      ...flipStringsFlat(),
      ...[SHORT_FLIP, TWO_FLIPS, rep(55, 160), [...rep(55, 100), ...rep(50.2, 60)], [...rep(55, 24), ...rep(44, 20 * 24)]].flatMap((l) => {
        const m = flipModel(input(l));
        return [m.caption];
      }),
      emptyCaption("none"),
      emptyCaption("short"),
      alarmNote({ cloud: true, signedIn: true, channels: 1, phoneCalls: 0, planLabel: "Free" }),
    ];
    for (const s of sentences) expect(s, s).not.toMatch(FORBIDDEN);
    expect(FLIP_WHO).toBe("Top-Trader (oberste 20 % nach Einsatz, Binance)");
    expect(FLIP.lead).toContain(FLIP_WHO);
    // a hint, never a forecast or advice
    expect(FLIP.hint).toMatch(/keine Prognose und keine Anlageempfehlung/);
    expect(FLIP.hint).not.toMatch(/wird (fallen|sinken)|es kommt/i);
    expect(FLIP.how.map((h) => h.term)).toEqual(["Netto", "Nulllinie", "Flip", "Grenzen"]);
    expect(FLIP.how.find((h) => h.id === "limits")!.text).toMatch(/Verzug/);
  });
});

describe("FlipExplainer in jsdom", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    opened.ids.length = 0;
  });
  const v = viewOf(SHORT_FLIP);
  const prov = provenanceOf({ series: "position", state: "ok", source: "binance", measuredAt: v.last!.t, now: v.last!.t + 600_000, stepMs: H });
  const props = { state: "ok" as const, points: v.points, gaps: [], view: v, prov, series: "position" as const };

  it("text only (Rücknahme R4): title and definition, the flip sentence, the hint, the provenance – no chart, no schema, no legend", () => {
    const { container } = render(<FlipExplainer {...props} />);
    const root = screen.getByTestId("flip-explainer");
    expect(root).toHaveAttribute("data-kind", "flip");
    expect(root).toHaveAttribute("data-points", "160");
    expect(root).not.toHaveAttribute("data-flip", "none");
    expect(screen.getByRole("heading", { name: "Was ist ein Flip?" })).toBeInTheDocument();
    expect(screen.getByTestId("flip-explainer-lead")).toHaveTextContent(FLIP_WHO);
    expect(screen.getByTestId("flip-explainer-caption")).toHaveTextContent(/^Flip am \d\d\.\d\d\.: .* erstmals netto Short\. Preis seit dem Flip: /);
    expect(screen.getByTestId("flip-explainer-hint")).toHaveTextContent("keine Prognose und keine Anlageempfehlung");
    expect(screen.getByTestId("flip-explainer-prov-source")).toHaveTextContent("Binance Futures");
    expect(screen.getByTestId("flip-explainer-prov-cohort")).toHaveTextContent("Obere 20 % der Konten nach Einsatz");
    expect(screen.getByTestId("flip-explainer-prov-time")).toHaveTextContent("UTC");
    expect(root.textContent ?? "").not.toMatch(FORBIDDEN);
    // the explainer's own chart and the three-panel schema are gone, with the legend that only described the chart
    expect(container.querySelector("svg")).toBeNull();
    for (const id of ["flip-explainer-chart", "flip-explainer-schema", "flip-explainer-legend", "flip-explainer-net", "flip-explainer-window"]) expect(screen.queryByTestId(id), id).toBeNull();
    expect(root.textContent ?? "").not.toMatch(/Schema, keine Daten|Echte Daten/);
  });

  it("'Wie lese ich das?' is a native disclosure with the four explanations (Netto, Nulllinie, Flip, Grenzen)", () => {
    render(<FlipExplainer {...props} />);
    const how = screen.getByTestId("flip-explainer-how") as HTMLDetailsElement;
    expect(how.open).toBe(false);
    expect(how.querySelector("summary")).toHaveTextContent("Wie lese ich das?");
    const text = how.textContent ?? "";
    expect(text).toContain("Long-Anteil minus Short-Anteil");
    expect(text).toContain("Nulllinie");
    expect(text).toContain("Zittern um die Null ist kein Flip");
    expect(text).toContain("Kein Kursziel");
  });

  it("the alert button only OPENS the alarm setting (openFeature 'vier-alarme') and says nothing is switched on from here", () => {
    render(<FlipExplainer {...props} />);
    expect(screen.getByTestId("flip-explainer-alarm-note")).toHaveTextContent("hier wird nichts aktiviert");
    fireEvent.click(screen.getByRole("button", { name: "Bei Flip benachrichtigen" }));
    return waitFor(() => expect(opened.ids).toEqual(["vier-alarme"]));
  });

  it("without data: the sentence says why (the card's reason), nothing else changes", () => {
    render(<FlipExplainer {...props} state="none" points={[]} view={null} prov={provenanceOf({ series: "position", state: "none", source: null, measuredAt: null, now: 0, stepMs: null })} reason="Binance blockiert (Region)" />);
    expect(screen.getByTestId("flip-explainer")).toHaveAttribute("data-kind", "empty");
    expect(screen.getByTestId("flip-explainer")).toHaveAttribute("data-flip", "none");
    expect(screen.getByTestId("flip-explainer-caption")).toHaveTextContent("Binance blockiert (Region)");
    expect(screen.getByRole("button", { name: "Bei Flip benachrichtigen" })).toBeInTheDocument();
  });
});
