/**
 * Branchen-Trend (Zarattini & Antonacci 2024, „A Century of Profitable Industry Trends“): the fixed rule set of the base
 * strategy, the names of the 48 Ken-French industries and the small formatting helpers shared by the parts.
 *
 * Pure and alias-free.
 */

/** The parameters of one variant (the same five the lab script varies: `megatest.py`, `BASE`). */
export interface TrendParams {
  /** window of the upper channel (days) */
  up: number;
  /** window of the lower channel / stop (days) */
  down: number;
  /** Keltner factor: channel = EMA ± kelt × mean absolute daily change */
  kelt: number;
  /** target volatility per position (0.02 = 2 % a year) */
  tv: number;
  /** cap of the sum of all weights (2 = at most twice the capital) */
  lev: number;
}

/** The base strategy (the paper's values; `megatest.py` `BASE`): the one the app shows. Nothing here is "optimised". */
export const BASE_PARAMS: Readonly<TrendParams> = Object.freeze({ up: 20, down: 40, kelt: 2.8, tv: 0.02, lev: 2 });

/** Cost per unit of turnover in the lab run, in basis points (`megatest.py --cost-bps`, default 5). */
export const COST_BP = 5;
/** Trading days per year (`SQ = sqrt(252)` in the script). */
export const TRADING_DAYS = 252;
/** Days of signal changes the lab script lists and the protocol takes over on first use. */
export const EVENT_DAYS = 60;

/** `str(2.0)` of Python for the strategy id: integers keep one decimal (`2.0`), others print as they are (`2.8`, `0.02`). */
export function pyNumber(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** The id the lab script gives a variant (`s-65-20-1.0-0.01-2.0`): `s-` + up, down, kelt, target volatility, leverage. */
export function strategyId(p: TrendParams): string {
  return ["s", String(p.up), String(p.down), pyNumber(p.kelt), pyNumber(p.tv), pyNumber(p.lev)].join("-");
}

/** One line for a variant ("20/40 · Keltner 2,8 · Ziel-Vola 2 % · Hebel 2"); takes the lab file's keys as well as `TrendParams`. */
export function paramsText(p: { up: number; down: number; kelt: number; ziel_vola?: number; tv?: number; max_hebel?: number; lev?: number }): string {
  const vola = p.ziel_vola ?? p.tv ?? 0;
  const lev = p.max_hebel ?? p.lev ?? 0;
  const n = (v: number, d = 1): string => v.toLocaleString("de-DE", { maximumFractionDigits: d });
  return `${p.up}/${p.down} · Keltner ${n(p.kelt)} · Ziel-Vola ${n(vola * 100, 1)} % · Hebel ${n(lev)}`;
}

/** The 48 industries of Kenneth French's data library, in the order of the file: code → German name. */
export const INDUSTRY_NAMES: Readonly<Record<string, string>> = {
  Agric: "Landwirtschaft",
  Food: "Nahrungsmittel",
  Soda: "Softdrinks",
  Beer: "Bier und Spirituosen",
  Smoke: "Tabak",
  Toys: "Freizeit und Spielzeug",
  Fun: "Unterhaltung",
  Books: "Druck und Verlage",
  Hshld: "Konsumgüter",
  Clths: "Bekleidung",
  Hlth: "Gesundheitswesen",
  MedEq: "Medizintechnik",
  Drugs: "Pharma",
  Chems: "Chemie",
  Rubbr: "Gummi und Kunststoff",
  Txtls: "Textilien",
  BldMt: "Baustoffe",
  Cnstr: "Bau",
  Steel: "Stahl",
  FabPr: "Metallwaren",
  Mach: "Maschinen",
  ElcEq: "Elektrotechnik",
  Autos: "Autos und Lkw",
  Aero: "Luftfahrzeuge",
  Ships: "Schiffe und Bahnen",
  Guns: "Rüstung",
  Gold: "Edelmetalle",
  Mines: "Bergbau (ohne Energie)",
  Coal: "Kohle",
  Oil: "Öl und Gas",
  Util: "Versorger",
  Telcm: "Kommunikation",
  PerSv: "Persönliche Dienste",
  BusSv: "Unternehmensdienste",
  Comps: "Computer",
  Chips: "Elektronik und Chips",
  LabEq: "Mess- und Regeltechnik",
  Paper: "Bürobedarf",
  Boxes: "Verpackung",
  Trans: "Transport",
  Whlsl: "Großhandel",
  Rtail: "Einzelhandel",
  Meals: "Gastronomie und Hotels",
  Banks: "Banken",
  Insur: "Versicherungen",
  RlEst: "Immobilien",
  Fin: "Wertpapierhandel",
  Other: "Sonstige",
};

/** German name of an industry code; an unknown code (the library renamed something) is shown as it is. */
export const industryName = (code: string): string => INDUSTRY_NAMES[code] ?? code;

/** `20260930` / `"20260930"` → `30.09.2026`; anything else comes back unchanged (never a made-up date). */
export function fmtDay(d: number | string | null | undefined): string {
  const s = String(d ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}` : s;
}
