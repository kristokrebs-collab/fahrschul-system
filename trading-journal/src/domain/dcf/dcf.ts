/**
 * Discounted cash flow, deterministic. The arithmetic is the one of the user's `/dcf` skill (`scripts/dcf.py`):
 *
 *   PV of the explicit years   = Σ FCF_t / (1 + WACC)^t                 (t = 1 … N, cash flows at the END of each year)
 *   terminal value (Gordon)    = FCF_N · (1 + g) / (WACC − g)
 *   PV of the terminal value   = TV / (1 + WACC)^N
 *   enterprise value           = PV explicit + PV terminal
 *   equity value               = enterprise value − net debt
 *   value per share            = equity value / shares
 *
 * and the FCF itself comes from the value-driver form: revenue_t = revenue_{t−1} · (1 + growth_t), EBIT_t = revenue_t · margin_t,
 * NOPAT_t = EBIT_t · (1 − tax), FCF_t = NOPAT_t · (1 − reinvestment rate_t). Every assumption is an input and is shown with
 * the result; nothing here is guessed, and the result is a RANGE (the sensitivity table), never one number to trust.
 */

export const MAX_YEARS = 15;
export const MIN_YEARS = 1;

export interface DcfAssumptions {
  /** revenue of the base year (last twelve months), in the currency of the amounts */
  baseRevenue: number;
  /** revenue growth per projection year (fractions: 0.08 = 8 %) – the length is the horizon */
  growth: readonly number[];
  /** EBIT margin per year (fractions), same length */
  ebitMargin: readonly number[];
  /** tax rate on EBIT (fraction) */
  taxRate: number;
  /** share of NOPAT that is re-invested (net capex + working capital) per year, same length */
  reinvestmentRate: readonly number[];
  /** discount rate (fraction) */
  wacc: number;
  /** growth after the last explicit year (fraction) */
  terminalGrowth: number;
  /** financial debt − cash and securities (negative = net cash) */
  netDebt: number;
  /** diluted shares */
  shares: number;
}

export interface DcfYear {
  year: number;
  growth: number;
  revenue: number;
  margin: number;
  ebit: number;
  nopat: number;
  reinvestmentRate: number;
  reinvestment: number;
  fcf: number;
  discountFactor: number;
  presentValue: number;
}

export type DcfStatus =
  /** a value was computed */
  | "ok"
  /** inputs are missing or impossible (see `issues`) – no value */
  | "invalid"
  /** the last explicit year's FCF is zero or negative: the terminal value would be meaningless – no value */
  | "no-terminal";

export interface DcfIssue {
  level: "error" | "warn";
  /** which input it is about (`wacc`, `terminalGrowth`, `shares`, `growth`, `margin`, `reinvestment`, `tax`, `baseRevenue`, `fcf`, `netDebt`, `horizon`) */
  field: string;
  text: string;
}

export interface DcfValue {
  explicit: number;
  terminalValue: number;
  terminalPv: number;
  enterpriseValue: number;
  equityValue: number;
  /** equity value / shares; may be zero or negative when debt exceeds the enterprise value */
  perShare: number;
  /** share of the enterprise value that sits in the terminal value (0 – 1); `null` when the enterprise value is not positive */
  terminalShare: number | null;
}

export interface DcfResult {
  status: DcfStatus;
  years: DcfYear[];
  value: DcfValue | null;
  issues: DcfIssue[];
}

/** Present value of a cash-flow list plus the Gordon terminal value (the `value()` of `dcf.py`). `null` when WACC ≤ g or there are no cash flows. */
export function valueFromFcf(fcf: readonly number[], wacc: number, g: number): { explicit: number; terminalValue: number; terminalPv: number; enterpriseValue: number } | null {
  if (!fcf.length || !(wacc > g) || !Number.isFinite(wacc) || !Number.isFinite(g)) return null;
  let explicit = 0;
  fcf.forEach((c, i) => {
    explicit += c / (1 + wacc) ** (i + 1);
  });
  const terminalValue = (fcf[fcf.length - 1]! * (1 + g)) / (wacc - g);
  const terminalPv = terminalValue / (1 + wacc) ** fcf.length;
  return { explicit, terminalValue, terminalPv, enterpriseValue: explicit + terminalPv };
}

const fin = (x: number): boolean => typeof x === "number" && Number.isFinite(x);

/** Checks the inputs. Errors stop the calculation, warnings do not. */
export function checkAssumptions(a: DcfAssumptions): DcfIssue[] {
  const out: DcfIssue[] = [];
  const err = (field: string, text: string): void => void out.push({ level: "error", field, text });
  const warn = (field: string, text: string): void => void out.push({ level: "warn", field, text });
  const n = a.growth.length;
  if (n < MIN_YEARS || n > MAX_YEARS) err("horizon", `Der Zeitraum muss zwischen ${MIN_YEARS} und ${MAX_YEARS} Jahren liegen.`);
  if (a.ebitMargin.length !== n || a.reinvestmentRate.length !== n) err("horizon", "Wachstum, Marge und Reinvestition brauchen für jedes Jahr einen Wert.");
  if (![a.baseRevenue, a.taxRate, a.wacc, a.terminalGrowth, a.netDebt, a.shares, ...a.growth, ...a.ebitMargin, ...a.reinvestmentRate].every(fin)) err("inputs", "Mindestens eine Annahme fehlt oder ist keine Zahl.");
  if (out.some((i) => i.level === "error")) return out;
  if (!(a.baseRevenue > 0)) err("baseRevenue", "Der Umsatz des Basisjahres muss größer als 0 sein.");
  if (!(a.shares > 0)) err("shares", "Die Aktienzahl muss größer als 0 sein.");
  if (a.taxRate < 0 || a.taxRate >= 1) err("tax", "Der Steuersatz muss zwischen 0 % und 100 % liegen.");
  if (!(a.wacc > 0)) err("wacc", "Der Kapitalkostensatz (WACC) muss größer als 0 sein.");
  if (a.wacc <= a.terminalGrowth) err("terminalGrowth", "Der WACC muss größer sein als das Endwachstum – sonst ist der Endwert nicht berechenbar.");
  if (a.growth.some((g) => g <= -1)) err("growth", "Ein Umsatzrückgang von 100 % oder mehr in einem Jahr ist nicht rechenbar.");
  if (a.reinvestmentRate.some((r) => r >= 1.5 || r < -1)) warn("reinvestment", "Eine Reinvestitionsquote außerhalb von −100 % bis 150 % ist ungewöhnlich – bitte prüfen.");
  if (a.terminalGrowth > 0.04) warn("terminalGrowth", "Ein Endwachstum über 4 % liegt über dem, was als langfristiges Wirtschaftswachstum gilt – der Endwert reagiert stark darauf.");
  if (a.terminalGrowth < 0) warn("terminalGrowth", "Ein negatives Endwachstum bedeutet, dass das Geschäft nach dem letzten Jahr schrumpft.");
  if (a.wacc < 0.05) warn("wacc", "Ein WACC unter 5 % ist sehr niedrig und treibt den Wert hoch.");
  if (a.wacc > 0.2) warn("wacc", "Ein WACC über 20 % ist sehr hoch.");
  if (a.growth.some((g) => g > 0.5)) warn("growth", "Mehr als 50 % Umsatzwachstum in einem Jahr ist selten – bitte prüfen.");
  if (a.ebitMargin.some((m) => m > 0.6)) warn("margin", "Eine EBIT-Marge über 60 % ist selten – bitte prüfen.");
  return out;
}

/** The year-by-year projection (revenue → EBIT → NOPAT → FCF) with the discount factors of `a.wacc`. Inputs must have passed `checkAssumptions`. */
function project(a: DcfAssumptions): DcfYear[] {
  const years: DcfYear[] = [];
  let revenue = a.baseRevenue;
  for (let i = 0; i < a.growth.length; i++) {
    const growth = a.growth[i]!;
    const margin = a.ebitMargin[i]!;
    const reinvestmentRate = a.reinvestmentRate[i]!;
    revenue *= 1 + growth;
    const ebit = revenue * margin;
    const nopat = ebit * (1 - a.taxRate);
    const reinvestment = nopat * reinvestmentRate;
    const fcf = nopat - reinvestment;
    const discountFactor = 1 / (1 + a.wacc) ** (i + 1);
    years.push({ year: i + 1, growth, revenue, margin, ebit, nopat, reinvestmentRate, reinvestment, fcf, discountFactor, presentValue: fcf * discountFactor });
  }
  return years;
}

/** The projection and the value. `status` says whether a value exists; the issues say why not. */
export function runDcf(a: DcfAssumptions): DcfResult {
  const issues = checkAssumptions(a);
  if (issues.some((i) => i.level === "error")) return { status: "invalid", years: [], value: null, issues };
  const years = project(a);
  const negative = years.filter((y) => y.fcf < 0).map((y) => y.year);
  if (negative.length) issues.push({ level: "warn", field: "fcf", text: `Der freie Cashflow ist in Jahr ${negative.join(", ")} negativ (Verlust oder sehr hohe Reinvestition) – das drückt den Barwert.` });
  const last = years[years.length - 1]!;
  if (!(last.fcf > 0)) {
    issues.push({ level: "error", field: "fcf", text: "Der freie Cashflow im letzten Jahr ist null oder negativ. Ein Endwert nach dem Gordon-Modell ist dann nicht sinnvoll – Marge oder Reinvestition anpassen oder den Zeitraum verlängern." });
    return { status: "no-terminal", years, value: null, issues };
  }
  const v = valueFromFcf(
    years.map((y) => y.fcf),
    a.wacc,
    a.terminalGrowth,
  )!;
  const equityValue = v.enterpriseValue - a.netDebt;
  const value: DcfValue = { ...v, equityValue, perShare: equityValue / a.shares, terminalShare: v.enterpriseValue > 0 ? v.terminalPv / v.enterpriseValue : null };
  if (equityValue <= 0) issues.push({ level: "warn", field: "netDebt", text: "Die Schulden sind größer als der Unternehmenswert: der Eigenkapitalwert ist null oder negativ." });
  return { status: "ok", years, value, issues };
}

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  /** value per share, `null` where WACC ≤ g or the cash flows give no terminal value */
  perShare: number | null;
}

export interface Sensitivity {
  waccs: number[];
  growths: number[];
  /** rows = WACC, columns = terminal growth */
  cells: SensitivityCell[][];
  /** index of the base case in each direction */
  center: { row: number; col: number };
}

export interface SensitivityOptions {
  waccStep?: number;
  growthStep?: number;
  /** points on each side of the base case (default 2: five rows, five columns) */
  radius?: number;
}

/** Value per share for WACC (rows) × terminal growth (columns), the base case in the middle. The FCF projection does not depend on either. */
export function sensitivity(a: DcfAssumptions, opts: SensitivityOptions = {}): Sensitivity | null {
  // everything but the WACC / growth relation must be valid; cells where WACC ≤ g simply stay empty
  if (checkAssumptions(a).some((i) => i.level === "error" && i.field !== "terminalGrowth" && i.field !== "wacc")) return null;
  const years = project(a);
  const fcf = years.map((y) => y.fcf);
  const ws = opts.waccStep ?? 0.01;
  const gs = opts.growthStep ?? 0.005;
  const r = opts.radius ?? 2;
  const waccs = Array.from({ length: 2 * r + 1 }, (_, i) => a.wacc + (i - r) * ws);
  const growths = Array.from({ length: 2 * r + 1 }, (_, i) => a.terminalGrowth + (i - r) * gs);
  const cells = waccs.map((wacc) =>
    growths.map((terminalGrowth): SensitivityCell => {
      const v = fcf[fcf.length - 1]! > 0 && wacc > 0 ? valueFromFcf(fcf, wacc, terminalGrowth) : null;
      return { wacc, terminalGrowth, perShare: v ? (v.enterpriseValue - a.netDebt) / a.shares : null };
    }),
  );
  return { waccs, growths, cells, center: { row: r, col: r } };
}

export interface DcfRange {
  low: number;
  /** the base case */
  mid: number | null;
  high: number;
  /** what the range spans, for the label: WACC ± one step, terminal growth ± one step */
  waccSpan: [number, number];
  growthSpan: [number, number];
}

/** The honest result: the range over the inner 3 × 3 block of the sensitivity table (WACC ± 1 point, g ± 0,5 point by default). */
export function rangeOf(s: Sensitivity): DcfRange | null {
  const { row, col } = s.center;
  const vals: number[] = [];
  for (let i = row - 1; i <= row + 1; i++) for (let j = col - 1; j <= col + 1; j++) {
    const v = s.cells[i]?.[j]?.perShare;
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  return { low: Math.min(...vals), mid: s.cells[row]?.[col]?.perShare ?? null, high: Math.max(...vals), waccSpan: [s.waccs[row - 1]!, s.waccs[row + 1]!], growthSpan: [s.growths[col - 1]!, s.growths[col + 1]!] };
}
