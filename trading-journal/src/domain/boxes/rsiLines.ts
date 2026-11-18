/**
 * Diagonal RSI trendlines (pure): resistance through falling RSI pivot highs, support through rising pivot lows.
 * When the RSI breaks its downtrend line upward, momentum turns before price — the breakout of the price box is
 * expected upward (mirrored for the support line). Horizontal RSI levels are ignored on purpose: a line needs a
 * minimum slope (owner rule "keine horizontalen RSI-Level").
 */
import { rsi as wilderRsi, type Bar } from "../signals/indicators";

export interface RsiLineCfg {
  len: number;
  /** pivot bars left / right of an RSI swing */
  pivotL: number;
  pivotR: number;
  /** bars searched for pivots */
  lookback: number;
  /** a break counts as fresh for this many bars */
  maxAge: number;
  /** RSI points of tolerance: crossing within tol is noise */
  tol: number;
  /** minimum |slope| in RSI points per bar */
  minSlope: number;
}

export const DEFAULT_RSI_LINE_CFG: Readonly<RsiLineCfg> = { len: 14, pivotL: 5, pivotR: 3, lookback: 160, maxAge: 8, tol: 1.2, minSlope: 0.02 };

export interface RsiPivot {
  i: number;
  v: number;
}

export interface RsiLine {
  kind: "res" | "sup";
  a: RsiPivot;
  b: RsiPivot;
  slope: number;
  touches: number;
  /** first bar beyond the line (index), null = unbroken */
  brokeAt: number | null;
}

export interface RsiLineState {
  rsi: number[];
  last: number;
  /** active (unbroken) downtrend / uptrend line */
  res: RsiLine | null;
  sup: RsiLine | null;
  /** freshly broken lines */
  breakUp: RsiLine | null;
  breakDown: RsiLine | null;
  ageUp: number | null;
  ageDown: number | null;
  /** RSI points below the active downtrend line / above the active uptrend line (negative = crossed, not yet confirmed) */
  distRes: number | null;
  distSup: number | null;
}

/** Value of a line at bar `i`. */
export const lineAt = (l: Pick<RsiLine, "a" | "slope">, i: number): number => l.a.v + l.slope * (i - l.a.i);

function pivots(x: readonly number[], L: number, R: number, high: boolean, from: number): RsiPivot[] {
  const out: RsiPivot[] = [];
  for (let i = Math.max(from, L); i < x.length - R; i++) {
    const v = x[i]!;
    if (!Number.isFinite(v)) continue;
    let ok = true;
    for (let k = i - L; k <= i + R && ok; k++) {
      if (k === i) continue;
      const w = x[k]!;
      if (!Number.isFinite(w)) continue;
      ok = high ? (k < i ? w < v : w <= v) : k < i ? w > v : w >= v;
    }
    if (ok) out.push({ i, v });
  }
  return out;
}

function candidates(x: readonly number[], piv: readonly RsiPivot[], kind: "res" | "sup", cfg: RsiLineCfg): RsiLine[] {
  const out: RsiLine[] = [];
  const n = x.length;
  const sgn = kind === "res" ? 1 : -1;
  const P = piv.slice(-14);
  for (let p = 0; p < P.length; p++) {
    for (let q = p + 1; q < P.length; q++) {
      const a = P[p]!;
      const b = P[q]!;
      if (b.i - a.i < 5) continue;
      const slope = (b.v - a.v) / (b.i - a.i);
      if (kind === "res" ? slope > -cfg.minSlope : slope < cfg.minSlope) continue;
      const line = { a, slope };
      let valid = true;
      for (let i = a.i + 1; i < b.i && valid; i++) if (Number.isFinite(x[i]) && sgn * (x[i]! - lineAt(line, i)) > cfg.tol) valid = false;
      if (!valid) continue;
      let brokeAt: number | null = null;
      for (let i = b.i + 1; i < n; i++) if (sgn * (x[i]! - lineAt(line, i)) > cfg.tol * 0.5) { brokeAt = i; break; }
      const end = brokeAt ?? n;
      let touches = 0;
      for (const pv of piv) if (pv.i >= a.i && pv.i < end && Math.abs(pv.v - lineAt(line, pv.i)) <= cfg.tol * 1.6) touches++;
      const v1 = lineAt(line, n - 1);
      if (v1 < 3 || v1 > 97) continue;
      out.push({ kind, a, b, slope, touches, brokeAt });
    }
  }
  return out;
}

const score = (l: RsiLine) => l.touches * 3 + (l.b.i - l.a.i) / 15 + Math.abs(l.a.v - l.b.v) / 10;

/** RSI lines of a CLOSED bar series. `null` below `len + 30` bars. */
export function rsiLines(bars: readonly Bar[], cfg: RsiLineCfg = DEFAULT_RSI_LINE_CFG): RsiLineState | null {
  if (bars.length < cfg.len + 30) return null;
  const r = wilderRsi(bars.map((b) => b.c), cfg.len);
  const n = r.length;
  const from = Math.max(0, n - cfg.lookback);
  const res = candidates(r, pivots(r, cfg.pivotL, cfg.pivotR, true, from), "res", cfg);
  const sup = candidates(r, pivots(r, cfg.pivotL, cfg.pivotR, false, from), "sup", cfg);
  const last = r[n - 1]!;
  const active = (ls: RsiLine[]) => ls.filter((l) => l.brokeAt == null).sort((x, y) => y.b.i - x.b.i || score(y) - score(x))[0] ?? null;
  const fresh = (ls: RsiLine[], sgn: 1 | -1) =>
    ls.filter((l) => l.brokeAt != null && n - 1 - l.brokeAt <= cfg.maxAge && sgn * (last - lineAt(l, n - 1)) > -cfg.tol).sort((x, y) => score(y) - score(x))[0] ?? null;
  const aRes = active(res);
  const aSup = active(sup);
  const bUp = fresh(res, 1);
  const bDown = fresh(sup, -1);
  return {
    rsi: r,
    last,
    res: aRes,
    sup: aSup,
    breakUp: bUp,
    breakDown: bDown,
    ageUp: bUp ? n - 1 - (bUp.brokeAt as number) : null,
    ageDown: bDown ? n - 1 - (bDown.brokeAt as number) : null,
    distRes: aRes ? lineAt(aRes, n - 1) - last : null,
    distSup: aSup ? last - lineAt(aSup, n - 1) : null,
  };
}

export type RsiTone = "win" | "loss" | "warn" | "mute";
const de1 = (x: number) => Math.abs(x).toFixed(1).replace(".", ",");

/** Short German summary for cards and notifications. */
export function rsiLineText(s: RsiLineState | null): { tone: RsiTone; title: string; detail: string } {
  if (!s) return { tone: "mute", title: "RSI lädt …", detail: "Zu wenig Kerzen für Trendlinien." };
  const ago = (k: number | null) => (k ? `vor ${k} Kerze${k === 1 ? "" : "n"}` : "gerade eben");
  if (s.breakUp && (!s.breakDown || (s.ageUp ?? 99) <= (s.ageDown ?? 99)))
    return { tone: "win", title: "RSI-Abwärtslinie nach oben gebrochen", detail: `${ago(s.ageUp)} · ${s.breakUp.touches} Berührungen. Momentum dreht, Ausbruch nach oben wahrscheinlicher.` };
  if (s.breakDown)
    return { tone: "loss", title: "RSI-Aufwärtslinie nach unten gebrochen", detail: `${ago(s.ageDown)} · ${s.breakDown.touches} Berührungen. Momentum kippt, Ausbruch nach unten wahrscheinlicher.` };
  const near = [
    s.distRes != null && s.distRes < 3 ? (s.distRes >= 0 ? `${de1(s.distRes)} Punkte unter der Abwärtslinie` : "knapp über der Abwärtslinie (Bruch noch nicht bestätigt)") : "",
    s.distSup != null && s.distSup < 3 ? (s.distSup >= 0 ? `${de1(s.distSup)} Punkte über der Aufwärtslinie` : "knapp unter der Aufwärtslinie (Bruch noch nicht bestätigt)") : "",
  ].filter(Boolean);
  if (near.length) return { tone: "warn", title: "RSI drückt gegen die Linie", detail: `RSI ${de1(s.last)}, ${near.join(" und ")}. Der Bruch steht kurz bevor.` };
  if (s.res || s.sup) return { tone: "mute", title: "RSI innerhalb seiner Linien", detail: `${[s.res ? "Abwärtslinie aktiv" : "", s.sup ? "Aufwärtslinie aktiv" : ""].filter(Boolean).join(", ")}. Noch kein Bruch.` };
  return { tone: "mute", title: "Keine diagonale RSI-Linie", detail: "Gerade keine fallenden Hochs oder steigenden Tiefs im RSI." };
}
