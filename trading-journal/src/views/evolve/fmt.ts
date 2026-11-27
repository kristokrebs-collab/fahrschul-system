/** Number and date text of the optimiser cards (German decimal comma, true minus). */
import { DASH } from "@/lib/format";

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export const dec = (v: number, d = 2): string => v.toFixed(d).replace(".", ",").replace("-", "−");
/** "+0,42 R" */
export const rText = (v: number | null | undefined, d = 2): string => (fin(v) ? `${v > 0 ? "+" : ""}${dec(v, d)} R` : DASH);
/** "+0,42" (no unit) */
export const num = (v: number | null | undefined, d = 2, sign = false): string => (fin(v) ? `${sign && v > 0 ? "+" : ""}${dec(v, d)}` : DASH);
/** fraction → "62 %" */
export const pctText = (v: number | null | undefined, d = 0, sign = false): string => (fin(v) ? `${sign && v > 0 ? "+" : ""}${dec(v * 100, d)} %` : DASH);
/** a value already in percent → "+1,8 %" */
export const pctValue = (v: number | null | undefined, d = 1, sign = true): string => (fin(v) ? `${sign && v > 0 ? "+" : ""}${dec(v, d)} %` : DASH);
export const toneOf = (v: number | null | undefined): string => ((v ?? 0) > 0 ? "text-win" : (v ?? 0) < 0 ? "text-loss" : "text-fg");

const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const dayShortFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const dayText = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? dayFmt.format(new Date(ms)) : DASH);
export const dayShort = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? dayShortFmt.format(new Date(ms)) : DASH);
export const stampText = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? timeFmt.format(new Date(ms)) : DASH);
