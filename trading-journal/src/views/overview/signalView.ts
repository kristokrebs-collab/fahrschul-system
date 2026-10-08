/**
 * Pure view model of the "Einstiegs-Check" card (`SignalCard`) and the hero strip (`SignalStrip`): rung tiles,
 * meter positions, the "neuer Einstieg" detection, the status pill, the candle-close states (vorläufig / bestätigt /
 * stark bestätigt, decisions 6 + 9) and the graded parts (Top-Trader-Kombi, Divergenzen, Support / Widerstand,
 * decisions 5 + 10). No React, no market access – the card feeds it the published `SignalCheckState` (≤ 1/s), so every
 * helper here is cheap and deterministic (tested in `tests/unit/views.overview.signal*.test.tsx`).
 *
 * Countdowns are NOT computed here: the views carry the close time (`closesAt`, ms) and the components render the
 * remaining time on the shared second clock (`useNowMv`), so nothing re-renders per second.
 */
import {
  deltaRuleText,
  divCfgOf,
  divValidityText,
  intrabarOf,
  isLongKind,
  isStrongKind,
  kindText,
  mmss,
  PROVISIONAL_PREFIX,
  provisionalText,
  roleText,
  rungState,
  srCfgOf,
  strengthText,
  whaleCfgOf,
  type Divergence,
  type GradedPart,
  type IntrabarMemo,
  type TrendBreak,
  type PartId,
  type Side,
  type SignalCfg,
  type SignalState,
  type Signals,
  type TfCheck,
  type Verdict,
  type WtKind,
  type WtTurn,
  type ZoneInfo,
} from "@/domain/signals";
import type { SignalCheckState } from "@/market";
import type { StatusTone } from "@/motion/StatusPill";

export interface RungEvent {
  kind: WtKind;
  barsAgo: number;
}

/** One ladder tile. */
export interface RungView {
  tf: string;
  /** "Basis" / "Bestätigung" / "stärker" */
  role: string;
  /** part of the ladder for this side (`i < tiers`) – the tile lights up (desaturated while `provisional`) */
  lit: boolean;
  /** `null` = too few bars on this rung */
  check: TfCheck | null;
  /** event shown: the one deciding this side's candle-close state, otherwise the latest of any direction (muted) */
  event: RungEvent | null;
  /** the event points in the selected direction */
  match: boolean;
  /** Bottom/Top/Kauf/Verkauf (filled dot) vs the small zero-line crosses (outlined) */
  strong: boolean;
  /** `true` when the event's dot sits on a long kind */
  longKind: boolean;
  text: string;
  /** RSI near the extreme for this side */
  rsiNear: boolean;
  /** candle-close state of this side's signal on the rung (`none` without one) */
  state: SignalState;
  /** close (ms) of the rung's forming candle while `state` is provisional (countdown target), else `null` */
  closesAt: number | null;
  /** closed candles since the deciding event, counting its own close (0 = on the forming candle) */
  closes: number;
  /** MCB turn price of the forming candle for this side while nothing lights the rung (`null` otherwise) */
  turn: TurnView | null;
  /** an event of this side that came and went on the forming candle (greyed, never counted), `null` otherwise */
  intrabar: IntrabarView | null;
}

/** "dreht ab 82.447": the close at which the forming candle's MCB crosses for the side (long: up, short: down). */
export interface TurnView {
  price: number;
  /** `82.447` */
  value: string;
  /** what the cross would be: Kaufsignal / Kreuz (long), Verkaufssignal / Kreuz Short (short) */
  kind: WtKind;
  /** `MCB dreht ab 82.447 nach oben (Kaufsignal)` */
  aria: string;
}

/** One-word event names for narrow places (strip chips, a phone's rung tile); the dot colour carries the direction. */
export const KIND_SHORT_TEXT: Readonly<Record<WtKind, string>> = { bottom: "Bottom", buy: "Kauf", bull: "Kreuz", top: "Top", sell: "Verkauf", bear: "Kreuz" };

/** A forming-candle event that is gone now: `Kaufsignal intrabar 13:11–13:25 bei 82.466 · aktuell nicht gehalten`. */
export interface IntrabarView {
  kind: WtKind;
  /** `Kaufsignal` */
  text: string;
  /** `Kauf` (narrow tiles) */
  short: string;
  /** `13:11–13:25` (local time; one minute: `13:30`) */
  span: string;
  /** `82.466` (`–` without a price) */
  price: string;
  /** the whole sentence (screen readers, title) */
  aria: string;
}

const fmtHm = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const hmText = (ms: number): string => fmtHm.format(new Date(ms));
const fmtP0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const priceText = (x: number): string => (Number.isFinite(x) ? fmtP0.format(x) : "–");

/** The turn view of a rung for `side`: only on a forming candle without an event of that side, when the cross would count. */
export function turnView(t: WtTurn | null | undefined, c: TfCheck | null | undefined, side: Side, cfg: Partial<Pick<SignalCfg, "wtOs" | "wtOb">>): TurnView | null {
  if (!t || !c?.forming || rungState(c, side) !== "none") return null;
  const long = side === "long";
  // long: a cross is possible on this candle (wt1 ≤ wt2 one bar earlier), wt1 below wt2 now and the cross below the zero
  // line (a "Kreuz" above it would not count); short mirrored. Hand-built turns without the flags count as possible.
  if (long ? t.up === false || !(t.level < 0) || t.above : t.down === false || !(t.level > 0) || !t.above) return null;
  const kind: WtKind = long ? (t.level <= (cfg.wtOs ?? -53) ? "buy" : "bull") : t.level >= (cfg.wtOb ?? 53) ? "sell" : "bear";
  const value = priceText(t.price);
  return { price: t.price, value, kind, aria: `MCB dreht ab ${value} ${long ? "nach oben" : "nach unten"} (${kindText(kind)})` };
}

/** The intrabar view of a rung for `side` (`intrabarOf`: the rung's forming candle, nothing of that side lit now). */
export function intrabarView(memo: IntrabarMemo | null | undefined, c: TfCheck | null | undefined, side: Side): IntrabarView | null {
  const s = intrabarOf(memo, c, side);
  if (!s) return null;
  const a = hmText(s.first);
  const b = hmText(s.last);
  const span = a === b ? a : `${a}–${b}`;
  const text = kindText(s.kind);
  const price = priceText(s.price);
  return { kind: s.kind, text, short: KIND_SHORT_TEXT[s.kind], span, price, aria: `${text} intrabar ${span} bei ${price} · aktuell nicht gehalten (zählt nicht)` };
}

/** Rung tiles for `side`, one per ladder entry (a `null` check keeps its timeframe from the config). */
export function rungViews(
  sig: Pick<Signals, "checks"> & { turns?: Readonly<Record<string, WtTurn | null>>; intrabar?: IntrabarMemo },
  v: Pick<Verdict, "tiers">,
  side: Side,
  cfg: Pick<SignalCfg, "ladder" | "required"> & Partial<Pick<SignalCfg, "wtOs" | "wtOb">>,
): RungView[] {
  return sig.checks.map((c, i) => {
    const tf = c?.tf ?? cfg.ladder[i] ?? "";
    const conf = c?.conf?.[side];
    const own = conf?.event ?? (c ? (side === "long" ? c.wt.long : c.wt.short) : null);
    const event: RungEvent | null = own ?? (c && c.wt.kind ? { kind: c.wt.kind, barsAgo: c.wt.barsAgo ?? 0 } : null);
    const longKind = !!event && isLongKind(event.kind);
    const state = rungState(c, side);
    return {
      tf,
      role: roleText(i, cfg.required),
      lit: i < v.tiers,
      check: c,
      event,
      match: !!event && longKind === (side === "long"),
      strong: !!event && isStrongKind(event.kind),
      longKind,
      text: kindText(event?.kind ?? null),
      rsiNear: !!c && (side === "long" ? c.rsiLong : c.rsiShort),
      state,
      closesAt: state === "provisional" && c?.closesAt != null && Number.isFinite(c.closesAt) ? c.closesAt : null,
      closes: conf?.closes ?? 0,
      turn: turnView(sig.turns?.[tf], c, side, cfg),
      intrabar: intrabarView(sig.intrabar, c, side),
    };
  });
}

/** `value` on `[min, max]` as 0..100 (clamped; non-finite → the middle). */
export function meterPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !(max > min)) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** Position of `price` in the zone range, 0..1 (clamped; falls back to the engine's `pos`). */
export function zonePosition(price: number, zone: Pick<ZoneInfo, "hi" | "lo" | "pos">): number {
  const span = zone.hi - zone.lo;
  if (!(price > 0) || !(span > 0)) return Math.max(0, Math.min(1, zone.pos));
  return Math.max(0, Math.min(1, (price - zone.lo) / span));
}

/** Entry level of one side: its strength while valid, else 0. */
export const entryLevel = (v: Pick<Verdict, "valid" | "strength">): number => (v.valid ? v.strength : 0);

export interface EntryLevels {
  long: number;
  short: number;
  /** base-rung bar (unix s) the levels belong to: a new bar may re-announce an entry of the same strength */
  base: number;
}

export function entryLevels(sig: Pick<Signals, "long" | "short" | "checks">): EntryLevels {
  return { long: entryLevel(sig.long), short: entryLevel(sig.short), base: sig.checks[0]?.closeAt ?? 0 };
}

/**
 * "Neuer Einstieg": the side whose entry level rose against the previous evaluation (a valid entry appeared or got
 * stronger) – never on the first evaluation (`prev` null), so loading the page announces nothing. Long wins a tie.
 */
export function freshEntry(prev: EntryLevels | null, next: EntryLevels): Side | null {
  if (!prev) return null;
  if (next.long > prev.long) return "long";
  if (next.short > prev.short) return "short";
  return null;
}

export const STATUS_LABEL: Record<SignalCheckState["state"], string> = {
  loading: "Lädt",
  ok: "Live",
  stale: "Veraltet",
  offline: "Offline",
};
const STATUS_TONE: Record<SignalCheckState["state"], StatusTone> = { loading: "muted", ok: "live", stale: "warn", offline: "error" };

export function statusPill(state: SignalCheckState["state"]): { tone: StatusTone; label: string } {
  return { tone: STATUS_TONE[state], label: STATUS_LABEL[state] };
}

/** `30m → 45m → 1h → 4h` */
export const ladderText = (ladder: readonly string[]): string => ladder.join(" → ");

/** Journal colours: green long, red short (P&L semantics) and the same hues at ~50 % saturation (provisional). */
export const SIDE_COLOR: Readonly<Record<Side, string>> = { long: "#3ddc84", short: "#ff4d4f" };
export const PROV_COLOR: Readonly<Record<Side, string>> = { long: "#65b488", short: "#d27a7b" };
export const NEUTRAL_COLOR = "#9b9b9b";
/** Tailwind classes of the provisional colours (literal strings: the class scanner needs them whole). */
export const PROV_TEXT: Readonly<Record<Side, string>> = { long: "text-[#65b488]", short: "text-[#d27a7b]" };

type StatefulVerdict = Pick<Verdict, "valid" | "side"> & { state?: SignalState; lage?: Verdict["lage"] };

/** A long entry held back by the Lage-Ampel (decision 23): shown faded, it does not count. */
export const lageBlocked = (v: { lage?: Verdict["lage"] }): boolean => v.lage?.held === true;

/** Candle-close state of a verdict (hand-built verdicts without `state`: valid = confirmed). */
export const verdictState = (v: Pick<Verdict, "valid"> & { state?: SignalState }): SignalState => v.state ?? (v.valid ? "confirmed" : "none");

/** Ring / label colour of a verdict: side colour once confirmed, desaturated while provisional or held back by the Lage, grey otherwise. */
export function verdictColor(v: StatefulVerdict): string {
  const st = verdictState(v);
  return st === "provisional" || lageBlocked(v) ? PROV_COLOR[v.side] : v.valid ? SIDE_COLOR[v.side] : NEUTRAL_COLOR;
}
/** Text class of the verdict label (same rule as `verdictColor`). */
export function verdictText(v: StatefulVerdict): string {
  const st = verdictState(v);
  if (st === "provisional" || lageBlocked(v)) return PROV_TEXT[v.side];
  return v.valid ? (v.side === "long" ? "text-win" : "text-loss") : "text-fg";
}

/** Tone of the Lage line under a verdict. */
export type LageLineTone = "loss" | "warn";
export interface LageLineView {
  text: string;
  tone: LageLineTone;
  /** Kaufsignale do not count right now (mode `Sperre`); false = `nur Warnung` */
  blocked: boolean;
}
/**
 * The Lage line under a long verdict: `nur Warnung` → `Lage rot – nur Warnung (fällt noch)`; no entry while the Lage is
 * red / amber → `Lage rot – Kaufsignale zählen nicht (fällt noch)` / `Lage gelb – Umkehr bildet sich (2/4) · Kaufsignale
 * zählen erst bei Grün`; a held-back entry carries it in its label (`null`, not repeated).
 */
export function lageLine(v: Pick<Verdict, "lage">): LageLineView | null {
  const g = v.lage;
  if (!g || !g.label || g.held) return null;
  const text = !g.blocked ? g.label : g.state === "red" ? g.label.replace("zählt nicht", "Kaufsignale zählen nicht") : `${g.label} · Kaufsignale zählen erst bei Grün`;
  return { text, tone: g.state === "red" ? "loss" : "warn", blocked: g.blocked };
}

/** `Vorläufig: Starker Long-Einstieg` → `{ prefix: "Vorläufig: ", text: "Starker Long-Einstieg" }` (the state line says it visually). */
export function labelParts(label: string): { prefix: string; text: string } {
  return label.startsWith(PROVISIONAL_PREFIX) ? { prefix: PROVISIONAL_PREFIX, text: label.slice(PROVISIONAL_PREFIX.length) } : { prefix: "", text: label };
}

/** Strength dots + line: a provisional entry shows the strength it gets on the close (outlined dots). */
export interface StrengthView {
  dots: number;
  outlined: boolean;
  line: string;
  aria: string;
}
export function strengthView(v: Pick<Verdict, "strength" | "tiers" | "valid"> & { state?: SignalState; provStrength?: number; lage?: Verdict["lage"] }, ladderLength: number): StrengthView {
  const tf = `${v.tiers} von ${ladderLength} Timeframes`;
  if (v.lage?.held) {
    // held back by the Lage-Ampel: the strength it would have, outlined, and that it does not count
    const p = Math.max(0, Math.min(4, v.lage.strength));
    return { dots: p, outlined: true, line: `${strengthText(p)} · zählt nicht (Lage ${v.lage.state === "red" ? "rot" : "gelb"}) · ${tf}`, aria: `Stärke 0 von 4, gesperrt (sonst ${p})` };
  }
  if (verdictState(v) === "provisional") {
    const p = Math.max(0, Math.min(4, v.provStrength ?? 0));
    return { dots: p, outlined: true, line: `${strengthText(p)} ab Kerzenschluss · ${tf}`, aria: `Stärke 0 von 4, vorläufig ${p}` };
  }
  return { dots: v.strength, outlined: false, line: `${strengthText(v.strength)} · ${tf}`, aria: `Stärke ${v.strength} von 4` };
}

/** The state line under the verdict (and in the strip). `closesAt` = the base candle's close (countdown target). */
export interface StateLineView {
  state: SignalState;
  /** base timeframe (`30m`) */
  tf: string;
  closesAt: number | null;
  /** closed candles the base signal held (strong) */
  closes: number;
  /** a long entry held back by the Lage-Ampel (decision 23): the signal is confirmed, the entry does not count */
  held?: boolean;
}
export function verdictStateLine(
  sig: Pick<Signals, "checks">,
  v: Pick<Verdict, "side" | "valid"> & { state?: SignalState; closesAt?: number | null; lage?: Verdict["lage"] },
  cfg: Pick<SignalCfg, "ladder">,
): StateLineView {
  const base = sig.checks[0] ?? null;
  const state = verdictState(v);
  const closesAt = v.closesAt ?? (base?.forming && base.closesAt != null && Number.isFinite(base.closesAt) ? base.closesAt : null);
  return { state, tf: base?.tf ?? cfg.ladder[0] ?? "", closesAt, closes: base?.conf?.[v.side]?.closes ?? 0, held: v.lage?.held === true };
}

/** State line of a held-back entry: the candle confirmed the SIGNAL, the entry itself is blocked (label / dots agree). */
export const HELD_STATE_TEXT: Readonly<Record<"confirmed" | "strong", string>> = {
  confirmed: "Signal bestätigt · Einstieg gesperrt",
  strong: "Signal stark bestätigt · Einstieg gesperrt",
};

/**
 * Text of a state line at `now` (ms): `vorläufig · schließt in 12:04`, `bestätigt · 30m-Kerze geschlossen`, `stark
 * bestätigt · 3 Schlüsse gehalten`; held back by the Lage-Ampel `Signal bestätigt · Einstieg gesperrt` (never a plain
 * `bestätigt` next to "zählt nicht"); without an entry the base candle's countdown (`30m-Kerze schließt in 12:04`).
 */
export function stateLineText(l: StateLineView, now: number): string {
  if (l.state === "provisional") return l.closesAt != null ? provisionalText(l.closesAt - now) : "vorläufig";
  if (l.held && (l.state === "confirmed" || l.state === "strong")) return HELD_STATE_TEXT[l.state];
  if (l.state === "confirmed") return `bestätigt · ${l.tf}-Kerze geschlossen`;
  if (l.state === "strong") return `stark bestätigt · ${l.closes} ${l.closes === 1 ? "Schluss" : "Schlüsse"} gehalten`;
  return l.closesAt != null ? `${l.tf}-Kerze schließt in ${mmss(l.closesAt - now)}` : "";
}

/** Short state words of a rung tile (`vorläufig` / `bestätigt` / `stark bestätigt`). */
export const RUNG_STATE_TEXT: Readonly<Record<SignalState, string>> = { none: "", provisional: "vorläufig", confirmed: "bestätigt", strong: "stark bestätigt" };

/** RSI meter bands: near (≤ rsiOs + rsiNear / ≥ rsiOb − rsiNear) and the extreme itself (≤ rsiOs / ≥ rsiOb). */
export function rsiBands(cfg: Pick<SignalCfg, "rsiOs" | "rsiOb" | "rsiNear">): { nearLo: number; lo: number; nearHi: number; hi: number } {
  return { nearLo: cfg.rsiOs + cfg.rsiNear, lo: cfg.rsiOs, nearHi: cfg.rsiOb - cfg.rsiNear, hi: cfg.rsiOb };
}


/* ------------------------------------------------------------------ graded parts (decisions 5 + 10) */

const dec1 = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * 10) / 10).replace(".", ",").replace("-", "−") : "–");
const fmtF1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Distances in R / ATR always with one decimal (`9,0 R`, like the reasons list and the engine's texts). */
const fix1 = (x: number): string => (Number.isFinite(x) ? fmtF1.format(x).replace("-", "−") : "–");
const fmtInt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const price0 = (x: number): string => (Number.isFinite(x) ? fmtInt.format(x) : "–");

/** `ok` = holds fully (lit), `part` = partial credit, `open` = data but nothing met, `none` = keine Daten. */
export type PartTone = "ok" | "part" | "open" | "none";

export interface PartView {
  id: PartId;
  /** German title for the side (`Top-Trader long · Retail rot`) */
  title: string;
  tone: PartTone;
  /** 0 … 1 */
  grade: number;
  /** `+7,5 von 10` · `zählt nicht` · `keine Daten` */
  pointsText: string;
  /** the part gives a valid entry +1 strength (shown as `+1 Stärke` while it holds) */
  bonus: boolean;
  /** the grade rests on a forming candle */
  provisional: boolean;
  data: boolean;
  detail: string;
  part: GradedPart;
}

export function partTone(p: Pick<GradedPart, "data" | "ok" | "grade">): PartTone {
  return !p.data ? "none" : p.ok ? "ok" : p.grade > 0 ? "part" : "open";
}

export function partView(p: GradedPart): PartView {
  const pointsText = p.weight <= 0 ? "zählt nicht" : !p.data ? "keine Daten" : `+${dec1(p.points)} von ${p.weight}`;
  return { id: p.id, title: p.label, tone: partTone(p), grade: p.grade, pointsText, bonus: p.bonus, provisional: p.state === "provisional", data: p.data, detail: p.detail, part: p };
}

/** The verdict's parts in the fixed order traders · div · sr (switched-off parts are absent). */
export function partViews(v: Pick<Verdict, "parts">): PartView[] {
  const order: PartId[] = ["traders", "div", "sr"];
  return order.flatMap((id) => {
    const p = v.parts?.find((x) => x.id === id);
    return p ? [partView(p)] : [];
  });
}

/** One cell of the Top-Trader scorecard. */
export interface PartCell {
  id: string;
  /** small caps title (`Positionen`) */
  title: string;
  /** main value (`66,0 % Long`, `−3,5 pp · 1h −2,1`, `Discount · 20 %`; `–` without data) */
  value: string;
  /** what it must show (`Ziel > 64 % Long`, `Ziel rot: < 0 oder fällt ≥ 1 pp (1h)`, `Ziel Discount · 1h`) */
  sub: string;
  met: boolean | null;
}

const tfIn = (label: string): string | null => /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? null;

/** The four cells of the Top-Trader-Kombi (positions, accounts, the Whale–Retail-Delta, zone) for its side. */
export function traderCells(p: GradedPart, cfg: Pick<SignalCfg, "whale">): PartCell[] {
  const w = whaleCfgOf(cfg);
  const long = p.side === "long";
  const sideWord = long ? "Long" : "Short";
  const deltaWindow = p.reading?.deltaWindow ?? w.deltaWindow;
  const item = (id: string) => p.items.find((i) => i.id === id);
  const cell = (id: string, title: string, sub: string): PartCell => {
    const it = item(id);
    const none = !it || it.met === null;
    return { id, title, value: none ? "–" : it.value, sub, met: it?.met ?? null };
  };
  const zoneTf = tfIn(item("zone")?.label ?? "");
  return [
    cell("pos", "Positionen", `Ziel > ${dec1(w.topPct)} % ${sideWord}`),
    cell("acc", "Konten", `Ziel > ${dec1(w.topPct)} % ${sideWord}`),
    cell("retail", "Whale–Retail", `Ziel ${long ? "rot" : "grün"}: ${deltaRuleText(p.side, { ...w, deltaWindow })}`),
    cell("zone", "Zone", `Ziel ${long ? "Discount" : "Premium"}${zoneTf ? ` · ${zoneTf}` : ""}`),
  ];
}

const OSC_TEXT = { rsi: "RSI", wt: "WT" } as const;
const DIV_KIND_TEXT = { regular: "regulär", hidden: "versteckt" } as const;
const barsText = (n: number): string => (n <= 0 ? "diese Kerze" : n === 1 ? "vor 1 Kerze" : `vor ${n} Kerzen`);

/** Strongest hit of the divergence part on its best timeframe (regular before hidden, RSI before WT, newest first). */
export function bestDivHit(p: Pick<GradedPart, "hits" | "tf">): (Divergence & { tf: string }) | null {
  const hits = (p.hits ?? []).filter((h) => !p.tf || h.tf === p.tf);
  const rank = (d: Divergence): number => (d.kind === "regular" ? 4 : 0) + (d.state === "provisional" ? 0 : 2) + (d.osc === "rsi" ? 1 : 0);
  return hits.reduce<(Divergence & { tf: string }) | null>((a, d) => (!a || rank(d) > rank(a) || (rank(d) === rank(a) && d.barsAgo < a.barsAgo) ? d : a), null);
}

/** `1h · RSI regulär: Tief 81.240 → 80.950 · RSI 28,1 → 31,4 · vor 2 Kerzen` (what, where, which timeframe). */
export function divHitLine(p: Pick<GradedPart, "hits" | "tf">): string | null {
  const d = bestDivHit(p);
  if (!d) return null;
  const pivot = d.dir === 1 ? "Tief" : "Hoch";
  const state = d.state === "provisional" ? " · vorläufig" : d.state === "strong" ? " · stark bestätigt" : "";
  return `${d.tf} · ${OSC_TEXT[d.osc]} ${DIV_KIND_TEXT[d.kind]}: ${pivot} ${price0(d.from.price)} → ${price0(d.to.price)} · ${OSC_TEXT[d.osc]} ${dec1(d.from.osc)} → ${dec1(d.to.osc)} · ${barsText(d.barsAgo)}${state}`;
}

/** Support / resistance meters: distance to the level leaned on (ATR) and room to the next opposite level (R). */
export interface SrView {
  near: { label: string; level: string; value: string; distAtr: number | null; band: number; max: number; met: boolean | null };
  room: { label: string; level: string; value: string; r: number | null; free: boolean; minR: number; max: number; met: boolean | null };
  tf: string | null;
}

export function srView(p: GradedPart, cfg: Pick<SignalCfg, "sr">): SrView {
  const sc = srCfgOf(cfg);
  const long = p.side === "long";
  const lv = p.levels ?? { lean: null, target: null, stop: null, r: null };
  const near = p.items.find((i) => i.id === "near");
  const room = p.items.find((i) => i.id === "room");
  const lean = lv.lean;
  const target = lv.target;
  const r = lv.r;
  const free = r === Infinity;
  return {
    near: {
      label: near?.label ?? (long ? "Am Support / Demand" : "Am Widerstand / Supply"),
      level: lean ? `${lean.label} ${price0(lean.price)}` : !p.data ? "keine Daten" : long ? "kein Support darunter" : "kein Widerstand darüber",
      value: !lean ? "–" : lean.dist === 0 ? "im Level" : `${fix1(lean.distAtr)} ATR`,
      distAtr: lean ? lean.distAtr : null,
      band: sc.nearAtr,
      max: sc.nearAtr * 2,
      met: near?.met ?? null,
    },
    room: {
      label: room?.label ?? `Platz (≥ ${fix1(sc.minR)} R)`,
      level: target ? `${target.label} ${price0(target.price)}` : free ? `kein ${long ? "Widerstand" : "Support"}` : !p.data ? "keine Daten" : "–",
      value: r == null ? "–" : free ? "frei" : `${fix1(r)} R`,
      r: r == null ? null : free ? Infinity : r,
      free,
      minR: sc.minR,
      max: sc.minR * 2,
      met: room?.met ?? null,
    },
    tf: p.tf ?? null,
  };
}

/** Divergence settings in one line for the card footer (`RSI + WT · regulär + versteckt · Trendlinie · Pivots 5/2 · gilt bis zum Bruch`). */
export function divSetupText(cfg: Pick<SignalCfg, "div">): string {
  const d = divCfgOf(cfg);
  const osc = [d.rsi ? "RSI" : "", d.wt ? "WT" : ""].filter(Boolean).join(" + ") || "–";
  const valid = d.maxAge > 0 ? `gilt bis zum Bruch, max. ${Math.min(d.maxAge, d.rangeMax)} Kerzen` : "gilt bis zum Bruch";
  return `${osc} · regulär${d.hidden ? " + versteckt" : ""}${d.trendline === false ? "" : " · Trendlinie"} · Pivots ${d.left}/${d.right} · ${valid}`;
}

/** The divergence rule's validity in words (`bis zum Bruch des Pivots (höchstens 60 Kerzen)`), for titles. */
export const divValidity = (cfg: Pick<SignalCfg, "div">): string => divValidityText(divCfgOf(cfg));

/** Most relevant RSI trendline break of the part (confirmed before provisional, newest first). */
export function bestTrendBreak(p: Pick<GradedPart, "trends">): (TrendBreak & { tf: string }) | null {
  const ts = p.trends ?? [];
  return ts.reduce<(TrendBreak & { tf: string }) | null>((a, t) => (!a || (a.state === "provisional" && t.state !== "provisional") || (a.state === t.state && t.barsAgo < a.barsAgo) ? t : a), null);
}

/** `1h · RSI-Trendlinienbruch nach oben (fallende Linie) · vor 2 Kerzen` (`· vorläufig (laufende Kerze)`); `null` without a break. */
export function divTrendLine(p: Pick<GradedPart, "trends" | "side">): string | null {
  const t = bestTrendBreak(p);
  if (!t) return null;
  const line = p.side === "long" ? "RSI-Trendlinienbruch nach oben (fallende Linie)" : "RSI-Trendlinienbruch nach unten (steigende Linie)";
  return `${t.tf} · ${line} · ${t.state === "provisional" ? "vorläufig (laufende Kerze)" : barsText(t.barsAgo)}`;
}

/** Compact one-line summary of the parts (strip): `Top-Trader 3/4`, `Divergenz 1h`, `S/R 3,1 R`. */
export interface PartChip {
  id: PartId;
  label: string;
  value: string;
  tone: PartTone;
  provisional: boolean;
}
export function partChips(v: Pick<Verdict, "parts">): PartChip[] {
  return partViews(v).map((pv) => {
    const p = pv.part;
    const value =
      !p.data
        ? "–"
        : p.id === "traders"
          ? `${p.met ?? 0}/4`
          : p.id === "div"
            ? (p.grade > 0 ? (p.tf ?? "✓") : "–")
            : p.levels?.r == null
              ? "–"
              : p.levels.r === Infinity
                ? "frei"
                : `${fix1(p.levels.r)} R`;
    return { id: p.id, label: p.id === "traders" ? "Top-Trader" : p.id === "div" ? "Divergenz" : "S/R", value, tone: pv.tone, provisional: pv.provisional };
  });
}
