/**
 * The building blocks of "Eigene Idee" (F73): each one is a pure function over CLOSED bars of ONE timeframe that returns a
 * tri-state per bar (0 false · 1 true · 2 unknown). The value at index i uses bars ≤ i only; a higher timeframe is mapped
 * onto the execution bars by `mapToExec` (tree.ts) from its CLOSED bars only.
 *
 * Reused from the app: RSI / EMA / SMA / WaveTrend / MCB events (`@/domain/signals`, same parameters as the user's MCB
 * setting), the MCB ladder verdict (`strategies/mcbLadder`), premium / discount (LuxAlgo swing range, per-bar series
 * equal to `luxZone`), the RSI trendline (`@/domain/boxes/rsiLines`, evaluated on the window ending at every bar).
 */
import { rsiLines, DEFAULT_RSI_LINE_CFG } from "../../boxes/rsiLines";
import type { SignalCfg } from "../../signals/config";
import { rolling, rsi as rsiOf, sma, waveTrend } from "../../signals/indicators";
import { mcbEvents, type WtKind } from "../../signals/mcb";
import { atr as atrOf } from "../../signals/structure";
import { zoneOf } from "../../signals/zones";
import { loopStepper } from "../../backtest/strategies/types";
import { bollingerSeries, luxZoneSeries, macdSeries, percentRank, triFrom, withinBars } from "./indicators";
import { PLUS_BLOCKS } from "./blocksPlus";
import { FALSE, TRUE, UNKNOWN, type BlockId, type LeafParams } from "./types";
import { type BlockDef, type EvalCtx, makeCtx, sessionOfSec, num, str, de, swap, within, REL_OPTIONS, REL_MIRROR, REL_WORD, isCross, WITHIN, whenCross, relate, closeOf, highOf, lowOf, maOf, maWarm, MA_TYPE, type Rel } from "./kit";
export { makeCtx, sessionOfSec, type BlockDef, type EvalCtx };

// ── momentum ──────────────────────────────────────────────────────────────────────────────────────────────────

const rsiBlock: BlockDef = {
  id: "rsi",
  label: "RSI Niveau",
  family: "momentum",
  help: "RSI (Wilder) über / unter einem Niveau oder beim Kreuzen des Niveaus.",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 14, min: 2, max: 100 },
    { key: "mode", label: "Bedingung", kind: "select", def: "below", options: REL_OPTIONS },
    { key: "level", label: "Niveau", kind: "float", def: 30, min: 1, max: 99, step: 1 },
    { ...WITHIN, when: whenCross },
  ],
  warmup: (p) => num(p, "len") + 2,
  eval(c, p) {
    const r = c.memo(`rsi${num(p, "len")}`, () => rsiOf(closeOf(c), num(p, "len")));
    return relate(c.n, r, num(p, "level"), str(p, "mode") as Rel, num(p, "within"), num(p, "len") + 1);
  },
  text: (p) => `RSI(${num(p, "len")}) ${REL_WORD[str(p, "mode") as Rel]} ${de(num(p, "level"))}${isCross(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => ({ ...swap(p, "mode", REL_MIRROR), level: Math.round((100 - num(p, "level")) * 100) / 100 }),
};

const rsiMaBlock: BlockDef = {
  id: "rsiMa",
  label: "RSI gegen seinen Durchschnitt",
  family: "momentum",
  help: "RSI über / unter seinem gleitenden Durchschnitt (SMA) oder beim Kreuzen.",
  params: [
    { key: "len", label: "RSI-Länge", kind: "int", def: 14, min: 2, max: 100 },
    { key: "maLen", label: "Durchschnitt", kind: "int", def: 14, min: 2, max: 100, hint: "Standard: die RSI-MA-Länge deiner MCB-Einstellung." },
    { key: "mode", label: "Bedingung", kind: "select", def: "crossUp", options: REL_OPTIONS },
    { ...WITHIN, when: whenCross },
  ],
  warmup: (p) => num(p, "len") + num(p, "maLen") + 2,
  eval(c, p) {
    const len = num(p, "len");
    const r = c.memo(`rsi${len}`, () => rsiOf(closeOf(c), len));
    const m = c.memo(`rsiMa${len}_${num(p, "maLen")}`, () => sma(r, num(p, "maLen")));
    return relate(c.n, r, m, str(p, "mode") as Rel, num(p, "within"), len + num(p, "maLen"));
  },
  text: (p) => `RSI(${num(p, "len")}) ${REL_WORD[str(p, "mode") as Rel]} seinem Durchschnitt (${num(p, "maLen")})${isCross(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", REL_MIRROR),
};

// ── MCB / WaveTrend ───────────────────────────────────────────────────────────────────────────────────────────

const WT_GROUPS: Record<string, readonly WtKind[]> = {
  bottom: ["bottom"],
  buy: ["buy"],
  bull: ["bull"],
  top: ["top"],
  sell: ["sell"],
  bear: ["bear"],
  anyLong: ["bottom", "buy", "bull"],
  anyShort: ["top", "sell", "bear"],
  majorLong: ["bottom", "buy"],
  majorShort: ["top", "sell"],
};
const WT_LABEL: Record<string, string> = {
  bottom: "MCB Bottom",
  buy: "MCB Kaufsignal (Kreuz im überverkauften Bereich)",
  bull: "MCB Kreuz nach oben",
  top: "MCB Top",
  sell: "MCB Verkaufssignal (Kreuz im überkauften Bereich)",
  bear: "MCB Kreuz nach unten",
  anyLong: "irgendein MCB-Long-Ereignis",
  anyShort: "irgendein MCB-Short-Ereignis",
  majorLong: "großer MCB-Punkt Long (Bottom oder Kauf)",
  majorShort: "großer MCB-Punkt Short (Top oder Verkauf)",
};
const WT_MIRROR: Record<string, string> = { bottom: "top", top: "bottom", buy: "sell", sell: "buy", bull: "bear", bear: "bull", anyLong: "anyShort", anyShort: "anyLong", majorLong: "majorShort", majorShort: "majorLong" };
const wtWarm = (s: SignalCfg): number => (s.wtChannel + s.wtAverage) * 3 + s.revRange + 2;

const wtEventBlock: BlockDef = {
  id: "wtEvent",
  label: "MCB-Ereignis",
  family: "mcb",
  help: "Ein MCB-/WaveTrend-Punkt deiner Einstellung (Bottom, Top, Kauf, Verkauf, Kreuz) ist gerade aufgetreten.",
  params: [
    { key: "kind", label: "Ereignis", kind: "select", def: "majorLong", options: Object.keys(WT_GROUPS).map((v) => ({ v, label: WT_LABEL[v]! })) },
    { ...WITHIN, def: 3, hint: "Wie viele Kerzen ein Punkt gelten soll (deine Einstellung: Signal-Rückblick)." },
  ],
  warmup: () => 120,
  eval(c, p) {
    const s = c.signal;
    const masks = c.memo("mcbMasks", () => {
      const { wt1, wt2 } = c.memo("wt", () => waveTrend(c.bars, s));
      const m: Partial<Record<WtKind, Uint8Array>> = {};
      for (const e of mcbEvents(wt1, wt2, s, closeOf(c), 1)) (m[e.kind] ??= new Uint8Array(c.n))[e.index] = 1;
      return m;
    });
    const kinds = WT_GROUPS[str(p, "kind")] ?? WT_GROUPS.majorLong!;
    const warm = wtWarm(s);
    const ev = new Uint8Array(c.n);
    for (let i = 0; i < c.n; i++) {
      if (i < warm) {
        ev[i] = UNKNOWN;
        continue;
      }
      ev[i] = kinds.some((k) => masks[k]?.[i] === 1) ? TRUE : FALSE;
    }
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => `${WT_LABEL[str(p, "kind")] ?? str(p, "kind")}${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "kind", WT_MIRROR),
};

const wtStateBlock: BlockDef = {
  id: "wtState",
  label: "WaveTrend Zustand",
  family: "mcb",
  help: "wt1 liegt unter / über einem Niveau (überverkauft / überkauft) oder über / unter wt2.",
  params: [
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "below",
      options: [
        { v: "below", label: "wt1 unter Niveau" },
        { v: "above", label: "wt1 über Niveau" },
        { v: "wt1AboveWt2", label: "wt1 über wt2" },
        { v: "wt1BelowWt2", label: "wt1 unter wt2" },
      ],
    },
    { key: "level", label: "Niveau", kind: "float", def: -53, min: -150, max: 150, step: 1, when: (p) => str(p, "mode") === "below" || str(p, "mode") === "above" },
  ],
  warmup: () => 120,
  eval(c, p) {
    const { wt1, wt2 } = c.memo("wt", () => waveTrend(c.bars, c.signal));
    const warm = wtWarm(c.signal);
    const mode = str(p, "mode");
    if (mode === "wt1AboveWt2") return relate(c.n, wt1, wt2, "above", 1, warm);
    if (mode === "wt1BelowWt2") return relate(c.n, wt1, wt2, "below", 1, warm);
    return relate(c.n, wt1, num(p, "level"), mode as Rel, 1, warm);
  },
  text: (p) => {
    const m = str(p, "mode");
    return m === "wt1AboveWt2" ? "WaveTrend wt1 über wt2" : m === "wt1BelowWt2" ? "WaveTrend wt1 unter wt2" : `WaveTrend wt1 ${m === "below" ? "unter" : "über"} ${de(num(p, "level"))}`;
  },
  mirror: (p) => ({ ...swap(p, "mode", { below: "above", above: "below", wt1AboveWt2: "wt1BelowWt2", wt1BelowWt2: "wt1AboveWt2" }), level: -num(p, "level") }),
};

const ladderBlock: BlockDef = {
  id: "mcbLadder",
  label: "MCB-Leiter Urteil",
  family: "mcb",
  help: "Dein Einstiegs-Check über alle Zeitebenen der Leiter (Stärke und gültig), Kerze für Kerze wie live.",
  params: [
    {
      key: "mode",
      label: "Urteil",
      kind: "select",
      def: "validLong",
      options: [
        { v: "validLong", label: "Long gültig" },
        { v: "validShort", label: "Short gültig" },
      ],
    },
    { key: "minStrength", label: "Mindest-Stärke", kind: "int", def: 3, min: 1, max: 5 },
  ],
  warmup: () => 0,
  execOnly: "Die Leiter wertet alle Zeitebenen deiner Einstellung gemeinsam aus und läuft auf der Ausführungskerze (1h oder 4h).",
  heavy: "Rechenintensiv: der echte Einstiegs-Check läuft auf jeder Kerze.",
  eval(c, p) {
    const facts = c.ladder;
    const side = str(p, "mode") === "validShort" ? "short" : "long";
    const min = num(p, "minStrength");
    return triFrom(c.n, (i) => {
      const f = facts?.[i];
      if (!f) return null;
      const v = f[side];
      if (!v) return false;
      return v.valid && v.strength >= min;
    });
  },
  text: (p) => `MCB-Leiter: ${str(p, "mode") === "validShort" ? "Short" : "Long"} gültig mit Stärke ≥ ${num(p, "minStrength")}`,
  mirror: (p) => swap(p, "mode", { validLong: "validShort", validShort: "validLong" }),
};

// ── structure & zones ─────────────────────────────────────────────────────────────────────────────────────────

const ZONE_LABEL: Record<string, string> = { discount: "Discount", premium: "Premium", equilibrium: "Gleichgewicht", deepDiscount: "tiefer Discount (untere 5 %)", deepPremium: "hoher Premium (obere 5 %)" };

const zoneBlock: BlockDef = {
  id: "zone",
  label: "Premium / Discount",
  family: "structure",
  help: "Der Schlusskurs liegt in der Discount- oder Premium-Zone der LuxAlgo-Swing-Spanne.",
  params: [
    { key: "mode", label: "Zone", kind: "select", def: "discount", options: Object.keys(ZONE_LABEL).map((v) => ({ v, label: ZONE_LABEL[v]! })) },
    { key: "size", label: "Swing-Länge", kind: "int", def: 50, min: 5, max: 200, unit: "Kerzen", hint: "Standard: die Swing-Länge deiner Einstellung." },
  ],
  warmup: (p) => num(p, "size") * 2,
  eval(c, p) {
    const size = num(p, "size");
    const pos = c.memo(`lux${size}`, () => luxZoneSeries(c.bars, size));
    const mode = str(p, "mode");
    return triFrom(c.n, (i) => {
      const v = pos[i]!;
      if (!Number.isFinite(v) || i < size) return null;
      if (mode === "deepDiscount") return v <= 0.05;
      if (mode === "deepPremium") return v >= 0.95;
      return zoneOf(v) === mode;
    });
  },
  text: (p) => `Kurs in der Zone „${ZONE_LABEL[str(p, "mode")] ?? str(p, "mode")}“ (Swing ${num(p, "size")})`,
  mirror: (p) => swap(p, "mode", { discount: "premium", premium: "discount", deepDiscount: "deepPremium", deepPremium: "deepDiscount", equilibrium: "equilibrium" }),
};

const breakoutBlock: BlockDef = {
  id: "breakout",
  label: "Ausbruch aus N Kerzen",
  family: "structure",
  help: "Schlusskurs über dem Hoch (unter dem Tief) der letzten N Kerzen davor.",
  params: [
    {
      key: "mode",
      label: "Richtung",
      kind: "select",
      def: "up",
      options: [
        { v: "up", label: "über dem Hoch" },
        { v: "down", label: "unter dem Tief" },
      ],
    },
    { key: "n", label: "Rückblick", kind: "int", def: 20, min: 2, max: 400, unit: "Kerzen" },
    { ...WITHIN, def: 1 },
  ],
  warmup: (p) => num(p, "n") + 1,
  eval(c, p) {
    const n = num(p, "n");
    const up = str(p, "mode") === "up";
    const ext = c.memo(`ext${up ? "H" : "L"}${n}`, () => rolling(up ? highOf(c) : lowOf(c), n, up));
    const close = closeOf(c);
    const ev = triFrom(c.n, (i) => (i < n ? null : up ? close[i]! > ext[i - 1]! : close[i]! < ext[i - 1]!));
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => `Schluss ${str(p, "mode") === "up" ? "über dem Hoch" : "unter dem Tief"} der letzten ${num(p, "n")} Kerzen${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "mode", { up: "down", down: "up" }),
};

const LEVEL_MODES = [
  { v: "touch", label: "Kurs berührt das Niveau" },
  { v: "closeAbove", label: "Schluss darüber" },
  { v: "closeBelow", label: "Schluss darunter" },
  { v: "crossAbove", label: "Schluss kreuzt nach oben" },
  { v: "crossBelow", label: "Schluss kreuzt nach unten" },
  { v: "nAbove", label: "N Schlusskurse in Folge darüber" },
  { v: "nBelow", label: "N Schlusskurse in Folge darunter" },
  { v: "retestUp", label: "Rücktest von oben hält" },
  { v: "retestDown", label: "Rücktest von unten hält" },
] as const;
const LEVEL_TEXT: Record<string, string> = {
  touch: "berührt",
  closeAbove: "Schluss über",
  closeBelow: "Schluss unter",
  crossAbove: "Schluss kreuzt nach oben",
  crossBelow: "Schluss kreuzt nach unten",
  nAbove: "Schlusskurse in Folge über",
  nBelow: "Schlusskurse in Folge unter",
  retestUp: "Rücktest hält über",
  retestDown: "Rücktest hält unter",
};

const keyLevelBlock: BlockDef = {
  id: "keyLevel",
  label: "Eigenes Preisniveau",
  family: "structure",
  help: "Dein Preisniveau: Berührung, Schluss darüber / darunter, N Schlüsse in Folge oder ein Rücktest.",
  params: [
    { key: "level", label: "Preis", kind: "float", def: 0, min: 0, max: 1e9, hint: "Dein Niveau in der Quote-Währung (z. B. 65000)." },
    { key: "mode", label: "Bedingung", kind: "select", def: "closeAbove", options: LEVEL_MODES },
    { key: "n", label: "Anzahl Schlüsse", kind: "int", def: 2, min: 1, max: 50, when: (p) => str(p, "mode") === "nAbove" || str(p, "mode") === "nBelow" },
    { key: "lookback", label: "Rücktest-Fenster", kind: "int", def: 20, min: 2, max: 200, unit: "Kerzen", hint: "So weit darf der Ausbruch zurückliegen.", when: (p) => str(p, "mode") === "retestUp" || str(p, "mode") === "retestDown" },
    { key: "tol", label: "Toleranz", kind: "float", def: 0.2, min: 0, max: 5, step: 0.1, unit: "%", hint: "Wie nah der Kurs ans Niveau kommen muss.", when: (p) => str(p, "mode") === "retestUp" || str(p, "mode") === "retestDown" },
    { ...WITHIN, when: (p) => str(p, "mode") === "crossAbove" || str(p, "mode") === "crossBelow" },
  ],
  warmup: (p) => Math.max(num(p, "n"), num(p, "lookback")) + 1,
  eval(c, p) {
    const lv = num(p, "level");
    const mode = str(p, "mode");
    const close = closeOf(c);
    const bars = c.bars;
    const n = Math.max(1, num(p, "n"));
    const m = num(p, "lookback");
    const tol = num(p, "tol") / 100;
    if (!(lv > 0)) return new Uint8Array(c.n).fill(UNKNOWN);
    const ev = triFrom(c.n, (i) => {
      const b = bars[i]!;
      switch (mode) {
        case "touch":
          return b.h >= lv && b.l <= lv;
        case "closeAbove":
          return b.c > lv;
        case "closeBelow":
          return b.c < lv;
        case "crossAbove":
          return i < 1 ? null : close[i - 1]! <= lv && b.c > lv;
        case "crossBelow":
          return i < 1 ? null : close[i - 1]! >= lv && b.c < lv;
        case "nAbove":
        case "nBelow": {
          if (i < n - 1) return null;
          for (let k = i - n + 1; k <= i; k++) if (mode === "nAbove" ? !(close[k]! > lv) : !(close[k]! < lv)) return false;
          return true;
        }
        case "retestUp":
        case "retestDown": {
          if (i < 1) return null;
          const up = mode === "retestUp";
          if (up ? !(b.c > lv && b.l <= lv * (1 + tol)) : !(b.c < lv && b.h >= lv * (1 - tol))) return false;
          for (let k = Math.max(0, i - m); k < i; k++) if (up ? close[k]! > lv : close[k]! < lv) return true;
          return false;
        }
        default:
          return null;
      }
    });
    return mode === "crossAbove" || mode === "crossBelow" ? withinBars(ev, num(p, "within")) : ev;
  },
  text: (p) => {
    const m = str(p, "mode");
    const lv = de(num(p, "level"));
    if (m === "nAbove" || m === "nBelow") return `${num(p, "n")} ${LEVEL_TEXT[m]} ${lv}`;
    if (m === "touch") return `Kurs berührt ${lv}`;
    return `${LEVEL_TEXT[m] ?? m} ${lv}${m === "crossAbove" || m === "crossBelow" ? within(num(p, "within")) : ""}`;
  },
  mirror: (p) => swap(p, "mode", { closeAbove: "closeBelow", closeBelow: "closeAbove", crossAbove: "crossBelow", crossBelow: "crossAbove", nAbove: "nBelow", nBelow: "nAbove", retestUp: "retestDown", retestDown: "retestUp", touch: "touch" }),
};

const rsiLineBlock: BlockDef = {
  id: "rsiLine",
  label: "RSI-Trendlinienbruch",
  family: "structure",
  help: "Der RSI bricht seine diagonale Abwärts- (Aufwärts-)Linie nach oben (unten), gerechnet nur mit den Kerzen bis zur aktuellen.",
  params: [
    {
      key: "mode",
      label: "Richtung",
      kind: "select",
      def: "breakUp",
      options: [
        { v: "breakUp", label: "Abwärtslinie nach oben" },
        { v: "breakDown", label: "Aufwärtslinie nach unten" },
      ],
    },
    { key: "within", label: "Frisch seit höchstens", kind: "int", def: 3, min: 1, max: 8, unit: "Kerzen" },
  ],
  warmup: () => DEFAULT_RSI_LINE_CFG.len + 30,
  heavy: "Rechenintensiv: die Trendlinien werden auf jeder Kerze neu gesucht (lieber ab 1h).",
  eval(c, p) {
    const up = str(p, "mode") === "breakUp";
    const maxAge = num(p, "within") - 1;
    const WINDOW = 320;
    const out = new Uint8Array(c.n);
    return loopStepper(
      c.n,
      (i) => {
        const win = c.bars.slice(Math.max(0, i - WINDOW + 1), i + 1);
        const s = rsiLines(win);
        if (!s) {
          out[i] = UNKNOWN;
          return;
        }
        const age = up ? s.ageUp : s.ageDown;
        out[i] = (up ? s.breakUp : s.breakDown) && age != null && age <= maxAge ? TRUE : FALSE;
      },
      () => out,
    );
  },
  text: (p) => `RSI bricht seine ${str(p, "mode") === "breakUp" ? "Abwärtslinie nach oben" : "Aufwärtslinie nach unten"} (höchstens ${num(p, "within")} Kerzen her)`,
  mirror: (p) => swap(p, "mode", { breakUp: "breakDown", breakDown: "breakUp" }),
};

// ── trend ─────────────────────────────────────────────────────────────────────────────────────────────────────

const maCrossBlock: BlockDef = {
  id: "maCross",
  label: "MA-Kreuzung",
  family: "trend",
  help: "Der schnelle gleitende Durchschnitt kreuzt den langsamen (EMA oder SMA).",
  params: [
    MA_TYPE,
    { key: "fast", label: "Schnell", kind: "int", def: 21, min: 2, max: 400 },
    { key: "slow", label: "Langsam", kind: "int", def: 55, min: 3, max: 400 },
    {
      key: "mode",
      label: "Richtung",
      kind: "select",
      def: "up",
      options: [
        { v: "up", label: "nach oben" },
        { v: "down", label: "nach unten" },
      ],
    },
    WITHIN,
  ],
  warmup: (p) => maWarm(str(p, "type"), num(p, "slow")) + 1,
  fix: (p) => {
    const f = Math.min(num(p, "fast"), num(p, "slow"));
    const s = Math.max(num(p, "fast"), num(p, "slow"));
    return { ...p, fast: f, slow: s > f ? s : f + 1 };
  },
  eval(c, p) {
    const t = str(p, "type");
    const f = maOf(c, t, num(p, "fast"));
    const s = maOf(c, t, num(p, "slow"));
    return relate(c.n, f, s, str(p, "mode") === "up" ? "crossUp" : "crossDown", num(p, "within"), maWarm(t, num(p, "slow")));
  },
  text: (p) => `${str(p, "type").toUpperCase()} ${num(p, "fast")} kreuzt ${str(p, "type").toUpperCase()} ${num(p, "slow")} nach ${str(p, "mode") === "up" ? "oben" : "unten"}${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "mode", { up: "down", down: "up" }),
};

const maPriceBlock: BlockDef = {
  id: "maPrice",
  label: "Kurs gegen Durchschnitt",
  family: "trend",
  help: "Schlusskurs über / unter einem gleitenden Durchschnitt oder beim Kreuzen.",
  params: [MA_TYPE, { key: "len", label: "Länge", kind: "int", def: 200, min: 2, max: 400 }, { key: "mode", label: "Bedingung", kind: "select", def: "above", options: REL_OPTIONS }, { ...WITHIN, when: whenCross }],
  warmup: (p) => maWarm(str(p, "type"), num(p, "len")) + 1,
  eval(c, p) {
    const t = str(p, "type");
    return relate(c.n, closeOf(c), maOf(c, t, num(p, "len")), str(p, "mode") as Rel, num(p, "within"), maWarm(t, num(p, "len")));
  },
  text: (p) => `Schluss ${REL_WORD[str(p, "mode") as Rel]} ${str(p, "type").toUpperCase()} ${num(p, "len")}${isCross(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", REL_MIRROR),
};

const macdBlock: BlockDef = {
  id: "macd",
  label: "MACD",
  family: "trend",
  help: "MACD kreuzt seine Signallinie oder die Nulllinie, oder liegt darüber / darunter.",
  params: [
    { key: "fast", label: "Schnell", kind: "int", def: 12, min: 2, max: 100 },
    { key: "slow", label: "Langsam", kind: "int", def: 26, min: 3, max: 200 },
    { key: "signal", label: "Signal", kind: "int", def: 9, min: 2, max: 100 },
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "crossUp",
      options: [
        { v: "crossUp", label: "kreuzt Signal nach oben" },
        { v: "crossDown", label: "kreuzt Signal nach unten" },
        { v: "zeroUp", label: "kreuzt Null nach oben" },
        { v: "zeroDown", label: "kreuzt Null nach unten" },
        { v: "aboveZero", label: "über Null" },
        { v: "belowZero", label: "unter Null" },
        { v: "histPos", label: "Histogramm positiv" },
        { v: "histNeg", label: "Histogramm negativ" },
        { v: "histRising", label: "Histogramm steigt (Momentum nimmt zu)" },
        { v: "histFalling", label: "Histogramm fällt (Momentum lässt nach)" },
      ],
    },
    { ...WITHIN, when: (p) => /cross|zero(Up|Down)/.test(str(p, "mode")) },
  ],
  warmup: (p) => num(p, "slow") * 3 + num(p, "signal") + 1,
  fix: (p) => {
    const f = Math.min(num(p, "fast"), num(p, "slow"));
    const s = Math.max(num(p, "fast"), num(p, "slow"));
    return { ...p, fast: f, slow: s > f ? s : f + 1 };
  },
  eval(c, p) {
    const m = c.memo(`macd${num(p, "fast")}_${num(p, "slow")}_${num(p, "signal")}`, () => macdSeries(closeOf(c), num(p, "fast"), num(p, "slow"), num(p, "signal")));
    const warm = num(p, "slow") * 3 + num(p, "signal");
    const w = num(p, "within");
    switch (str(p, "mode")) {
      case "crossUp":
        return relate(c.n, m.macd, m.sig, "crossUp", w, warm);
      case "crossDown":
        return relate(c.n, m.macd, m.sig, "crossDown", w, warm);
      case "zeroUp":
        return relate(c.n, m.macd, 0, "crossUp", w, warm);
      case "zeroDown":
        return relate(c.n, m.macd, 0, "crossDown", w, warm);
      case "aboveZero":
        return relate(c.n, m.macd, 0, "above", 1, warm);
      case "histPos":
        return relate(c.n, m.hist, 0, "above", 1, warm);
      case "histNeg":
        return relate(c.n, m.hist, 0, "below", 1, warm);
      case "histRising":
      case "histFalling": {
        const rising = str(p, "mode") === "histRising";
        return triFrom(c.n, (i) => (i < warm + 1 || !Number.isFinite(m.hist[i]!) ? null : rising ? m.hist[i]! > m.hist[i - 1]! : m.hist[i]! < m.hist[i - 1]!));
      }
      default:
        return relate(c.n, m.macd, 0, "below", 1, warm);
    }
  },
  text: (p) => {
    const lab: Record<string, string> = { crossUp: "kreuzt die Signallinie nach oben", crossDown: "kreuzt die Signallinie nach unten", zeroUp: "kreuzt Null nach oben", zeroDown: "kreuzt Null nach unten", aboveZero: "liegt über Null", belowZero: "liegt unter Null", histPos: "Histogramm ist positiv", histNeg: "Histogramm ist negativ", histRising: "Histogramm steigt", histFalling: "Histogramm fällt" };
    const m = str(p, "mode");
    return `MACD(${num(p, "fast")},${num(p, "slow")},${num(p, "signal")}) ${lab[m]}${/cross|zero(Up|Down)/.test(m) ? within(num(p, "within")) : ""}`;
  },
  mirror: (p) => swap(p, "mode", { crossUp: "crossDown", crossDown: "crossUp", zeroUp: "zeroDown", zeroDown: "zeroUp", aboveZero: "belowZero", belowZero: "aboveZero", histPos: "histNeg", histNeg: "histPos", histRising: "histFalling", histFalling: "histRising" }),
};

// ── volatility ────────────────────────────────────────────────────────────────────────────────────────────────

const BB_LABEL: Record<string, string> = {
  touchLower: "berührt das untere Band",
  touchUpper: "berührt das obere Band",
  closeBelow: "Schluss unter dem unteren Band",
  closeAbove: "Schluss über dem oberen Band",
  backInLower: "Schluss kehrt über das untere Band zurück",
  backInUpper: "Schluss kehrt unter das obere Band zurück",
  midUp: "Schluss kreuzt die Mittellinie nach oben",
  midDown: "Schluss kreuzt die Mittellinie nach unten",
  squeeze: "Bänder eng (Squeeze)",
};

const bollingerBlock: BlockDef = {
  id: "bollinger",
  label: "Bollinger-Bänder",
  family: "volatility",
  help: "Kurs berührt oder schließt außerhalb eines Bands, oder die Bänder sind ungewöhnlich eng (Squeeze).",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 20, min: 5, max: 200 },
    { key: "mult", label: "Abweichung", kind: "float", def: 2, min: 0.5, max: 5, step: 0.1, unit: "σ" },
    { key: "mode", label: "Bedingung", kind: "select", def: "touchLower", options: Object.keys(BB_LABEL).map((v) => ({ v, label: BB_LABEL[v]! })) },
    { key: "pct", label: "Squeeze: unterste", kind: "float", def: 20, min: 1, max: 50, step: 1, unit: "%", hint: "Bandbreite im untersten Anteil der letzten Kerzen.", when: (p) => str(p, "mode") === "squeeze" },
    { key: "lookback", label: "Squeeze: Rückblick", kind: "int", def: 120, min: 20, max: 500, unit: "Kerzen", when: (p) => str(p, "mode") === "squeeze" },
    { ...WITHIN, hint: "Das Ereignis (bei Squeeze: der enge Zustand) darf so viele Kerzen zurückliegen." },
  ],
  warmup: (p) => num(p, "len") + (str(p, "mode") === "squeeze" ? num(p, "lookback") : 0) + 1,
  eval(c, p) {
    const len = num(p, "len");
    const bb = c.memo(`bb${len}_${num(p, "mult")}`, () => bollingerSeries(closeOf(c), len, num(p, "mult")));
    const mode = str(p, "mode");
    if (mode === "squeeze") {
      const rank = c.memo(`bbw${len}_${num(p, "mult")}_${num(p, "lookback")}`, () => percentRank(bb.width, num(p, "lookback")));
      return withinBars(triFrom(c.n, (i) => (Number.isFinite(rank[i]!) ? rank[i]! <= num(p, "pct") : null)), num(p, "within"));
    }
    const ev = triFrom(c.n, (i) => {
      const b = c.bars[i]!;
      if (!Number.isFinite(bb.upper[i]!)) return null;
      const prev = i > 0 ? c.bars[i - 1]! : null;
      switch (mode) {
        case "backInLower":
          return prev != null && Number.isFinite(bb.lower[i - 1]!) ? prev.c < bb.lower[i - 1]! && b.c >= bb.lower[i]! : null;
        case "backInUpper":
          return prev != null && Number.isFinite(bb.upper[i - 1]!) ? prev.c > bb.upper[i - 1]! && b.c <= bb.upper[i]! : null;
        case "midUp":
          return prev != null && Number.isFinite(bb.mid[i - 1]!) ? prev.c <= bb.mid[i - 1]! && b.c > bb.mid[i]! : null;
        case "midDown":
          return prev != null && Number.isFinite(bb.mid[i - 1]!) ? prev.c >= bb.mid[i - 1]! && b.c < bb.mid[i]! : null;
        case "touchLower":
          return b.l <= bb.lower[i]!;
        case "touchUpper":
          return b.h >= bb.upper[i]!;
        case "closeBelow":
          return b.c < bb.lower[i]!;
        default:
          return b.c > bb.upper[i]!;
      }
    });
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => {
    const m = str(p, "mode");
    return m === "squeeze" ? `Bollinger(${num(p, "len")}) Bandbreite unter den untersten ${de(num(p, "pct"))} % der letzten ${num(p, "lookback")} Kerzen${within(num(p, "within"))}` : `Kurs: ${BB_LABEL[m]} (${num(p, "len")}, ${de(num(p, "mult"))}σ)${within(num(p, "within"))}`;
  },
  mirror: (p) => swap(p, "mode", { touchLower: "touchUpper", touchUpper: "touchLower", closeBelow: "closeAbove", closeAbove: "closeBelow", backInLower: "backInUpper", backInUpper: "backInLower", midUp: "midDown", midDown: "midUp", squeeze: "squeeze" }),
};

const atrPctBlock: BlockDef = {
  id: "atrPct",
  label: "Volatilitäts-Filter (ATR-Perzentil)",
  family: "volatility",
  help: "Die aktuelle ATR liegt im oberen oder unteren Bereich ihrer letzten Werte (Markt aktiv oder ruhig).",
  params: [
    { key: "len", label: "ATR-Länge", kind: "int", def: 14, min: 2, max: 100 },
    { key: "lookback", label: "Rückblick", kind: "int", def: 100, min: 20, max: 1000, unit: "Kerzen" },
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "above",
      options: [
        { v: "above", label: "ATR mindestens im Perzentil" },
        { v: "below", label: "ATR höchstens im Perzentil" },
      ],
    },
    { key: "pct", label: "Perzentil", kind: "float", def: 50, min: 1, max: 99, step: 1, unit: "%" },
  ],
  warmup: (p) => num(p, "len") + num(p, "lookback"),
  eval(c, p) {
    const len = num(p, "len");
    const rank = c.memo(`atrRank${len}_${num(p, "lookback")}`, () => percentRank(c.memo(`atr${len}`, () => atrOf(c.bars, len)), num(p, "lookback")));
    const above = str(p, "mode") === "above";
    return triFrom(c.n, (i) => (Number.isFinite(rank[i]!) ? (above ? rank[i]! >= num(p, "pct") : rank[i]! <= num(p, "pct")) : null));
  },
  text: (p) => `ATR(${num(p, "len")}) ${str(p, "mode") === "above" ? "mindestens im" : "höchstens im"} ${de(num(p, "pct"))}. Perzentil der letzten ${num(p, "lookback")} Kerzen`,
  mirror: (p) => p,
};

// ── price & volume ────────────────────────────────────────────────────────────────────────────────────────────

const volumeBlock: BlockDef = {
  id: "volume",
  label: "Volumen-Spitze",
  family: "price",
  help: "Das Kerzenvolumen ist ein Vielfaches des Durchschnitts der Kerzen davor – optional nur bei grüner / roter Kerze.",
  params: [
    { key: "len", label: "Durchschnitt", kind: "int", def: 20, min: 3, max: 200, unit: "Kerzen" },
    { key: "mult", label: "Faktor", kind: "float", def: 2, min: 1, max: 10, step: 0.1, unit: "×" },
    {
      key: "candle",
      label: "Kerze",
      kind: "select",
      def: "any",
      options: [
        { v: "any", label: "egal" },
        { v: "bull", label: "grün (Schluss > Eröffnung)" },
        { v: "bear", label: "rot (Schluss < Eröffnung)" },
      ],
    },
    WITHIN,
  ],
  warmup: (p) => num(p, "len") + 1,
  needsVolume: true,
  eval(c, p) {
    const len = num(p, "len");
    const ev = triFrom(c.n, (i) => {
      if (i < len) return null;
      const b = c.bars[i]!;
      if (!Number.isFinite(b.v)) return null;
      let sum = 0;
      for (let k = i - len; k < i; k++) {
        const v = c.bars[k]!.v;
        if (v === undefined || !Number.isFinite(v)) return null;
        sum += v;
      }
      if (!(b.v! > num(p, "mult") * (sum / len))) return false;
      const candle = str(p, "candle");
      return candle === "bull" ? b.c > b.o : candle === "bear" ? b.c < b.o : true;
    });
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => `Volumen über ${de(num(p, "mult"))}× dem Ø der letzten ${num(p, "len")} Kerzen${str(p, "candle") === "bull" ? " bei grüner Kerze" : str(p, "candle") === "bear" ? " bei roter Kerze" : ""}${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "candle", { bull: "bear", bear: "bull", any: "any" }),
};

// ── time ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Session bands in UTC, the same as the journal's "Zeit & Session" (`insights/time.ts` `sessionOf`; a test keeps them equal). */
const SESSION_OPTIONS = [
  { v: "any", label: "egal" },
  { v: "asia", label: "Asien (00–07 UTC)" },
  { v: "london", label: "London (07–13 UTC)" },
  { v: "ny", label: "New York (13–21 UTC)" },
  { v: "late", label: "Spät (21–24 UTC)" },
  { v: "weekend", label: "Wochenende (Sa–So UTC)" },
] as const;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_NAME: Record<string, string> = { mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag" };
const SESSION_NAME: Record<string, string> = { asia: "Asien", london: "London", ny: "New York", late: "Spät", weekend: "Wochenende" };

const timeWindowBlock: BlockDef = {
  id: "timeWindow",
  label: "Wochentag / Session",
  family: "time",
  help: "Die Kerze öffnet an einem bestimmten Wochentag und / oder in einer Handels-Session (alles in UTC).",
  params: [
    {
      key: "weekday",
      label: "Wochentag",
      kind: "select",
      def: "any",
      options: [{ v: "any", label: "egal" }, ...(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((v) => ({ v, label: WEEKDAY_NAME[v]! }))],
    },
    { key: "session", label: "Session", kind: "select", def: "any", options: SESSION_OPTIONS },
  ],
  warmup: () => 0,
  execOnly: "Der Zeitfilter gilt für die Ausführungskerze (UTC).",
  eval(c, p) {
    const wd = str(p, "weekday");
    const se = str(p, "session");
    return triFrom(c.n, (i) => {
      const t = c.bars[i]!.t;
      if (!Number.isFinite(t)) return null;
      if (wd !== "any" && WEEKDAY_KEYS[new Date(t * 1000).getUTCDay()] !== wd) return false;
      return se === "any" || sessionOfSec(t) === se;
    });
  },
  text(p) {
    const wd = str(p, "weekday");
    const se = str(p, "session");
    const parts = [wd !== "any" ? `am ${WEEKDAY_NAME[wd] ?? wd}` : "", se !== "any" ? `in der Session ${SESSION_NAME[se] ?? se}` : ""].filter(Boolean);
    return parts.length ? `Kerze öffnet ${parts.join(" ")} (UTC)` : "Zeitfilter ohne Einschränkung";
  },
  mirror: (p) => ({ ...p }),
};

export const BLOCKS: Readonly<Record<BlockId, BlockDef>> = {
  rsi: rsiBlock,
  rsiMa: rsiMaBlock,
  wtEvent: wtEventBlock,
  wtState: wtStateBlock,
  mcbLadder: ladderBlock,
  zone: zoneBlock,
  maCross: maCrossBlock,
  maPrice: maPriceBlock,
  macd: macdBlock,
  bollinger: bollingerBlock,
  atrPct: atrPctBlock,
  breakout: breakoutBlock,
  keyLevel: keyLevelBlock,
  volume: volumeBlock,
  rsiLine: rsiLineBlock,
  timeWindow: timeWindowBlock,
  ...PLUS_BLOCKS,
};

/** Order the picker shows them in. */
export const BLOCK_ORDER: readonly BlockId[] = ["rsi", "rsiMa", "wtEvent", "wtState", "mcbLadder", "maPrice", "maCross", "macd", "zone", "breakout", "keyLevel", "rsiLine", "bollinger", "atrPct", "volume", "timeWindow", "donchian", "adx", "stoch", "keltner", "ichimoku", "cci", "willr", "obv", "vwap", "orb", "insideBar", "heikin", "pivotBreak", "fib", "funding", "supertrend", "chandelier"];

export const isBlockId = (v: unknown): v is BlockId => typeof v === "string" && Object.prototype.hasOwnProperty.call(BLOCKS, v);

/** Default parameters of a block. */
export function defaultParams(id: BlockId): LeafParams {
  const out: LeafParams = {};
  for (const d of BLOCKS[id].params) out[d.key] = d.def;
  return out;
}

/** Clamps / repairs the parameters of a block: unknown keys dropped, bad values → default, ranges, cross-parameter rules. */
export function sanitizeParams(id: BlockId, raw: unknown): LeafParams {
  const def = BLOCKS[id];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let out: LeafParams = {};
  for (const d of def.params) {
    const v = src[d.key];
    if (d.kind === "select") {
      out[d.key] = typeof v === "string" && d.options?.some((o) => o.v === v) ? v : d.def;
      continue;
    }
    let x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
    if (!Number.isFinite(x)) x = Number(d.def);
    if (d.min != null) x = Math.max(d.min, x);
    if (d.max != null) x = Math.min(d.max, x);
    out[d.key] = d.kind === "int" ? Math.round(x) : Math.round(x * 10_000) / 10_000;
  }
  if (def.fix) out = def.fix(out);
  return out;
}
