/**
 * Times and time zones as a screenshot shows them (F29) – pure.
 *
 * `parseShotTime` reads the displayed text ("17.10.2026 14:32:08", "2026-10-17 14:32", "10-17 14:32", "Oct 17, 2:32 PM",
 * "14:32") into a date + wall clock and says what it had to ASSUME (year, day/month order). `toLocalWall` moves a
 * wall-clock time from the screenshot's zone into the journal's (the trade form's `date` is a local wall clock), via
 * `Intl` so daylight saving is right on the day in question. A zone the picture names ("UTC+8", "CET") wins over the
 * trader's choice, which wins over "same as the journal".
 */

export type Assumption = "year" | "order" | "date";

export interface ParsedTime {
  /** `YYYY-MM-DD`, `null` for a time of day alone. */
  date: string | null;
  /** `HH:mm`. */
  time: string;
  seconds: number | null;
  assumed: Assumption[];
}

export interface TimeContext {
  /** "Now" (tests pin it) – decides the year of a date without one. */
  now: Date;
  /** Day/month order of a numeric date that does not say (`"dmy"` | `"mdy"`); `null` = the text decides, else `dmy`. */
  order?: "dmy" | "mdy" | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, mär: 3, maer: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const p2 = (n: number) => String(n).padStart(2, "0");
const validDay = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Time of day part: `14:32`, `14:32:08`, `2:32 PM`, `02.32.08 pm`. */
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?`;

function clock(h: string, mi: string, s: string | undefined, ap: string | undefined): { h: number; mi: number; s: number | null } | null {
  let hh = Number(h);
  const mm = Number(mi);
  const ss = s == null ? null : Number(s);
  if (ap) {
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (ap.toLowerCase() === "p" ? 12 : 0);
  }
  if (hh > 23 || mm > 59 || (ss != null && ss > 59)) return null;
  return { h: hh, mi: mm, s: ss };
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Reads a displayed time; `null` when nothing time-like is there. */
export function parseShotTime(raw: string | null | undefined, ctx: TimeContext): ParsedTime | null {
  if (!raw) return null;
  const text = String(raw).trim().replace(/\u00A0|\u202F/g, " ");
  const assumed: Assumption[] = [];
  const out = (date: { y: number | null; mo: number; d: number } | null, c: { h: number; mi: number; s: number | null } | null): ParsedTime | null => {
    if (!c) return null;
    let iso: string | null = null;
    if (date) {
      let y = date.y;
      if (y == null) {
        assumed.push("year");
        y = ctx.now.getUTCFullYear();
        // a day without a year that would lie (clearly) in the future belongs to last year
        if (Date.UTC(y, date.mo - 1, date.d, c.h, c.mi) > ctx.now.getTime() + 2 * 86_400_000) y -= 1;
      }
      if (!validDay(y, date.mo, date.d)) return null;
      iso = `${y}-${p2(date.mo)}-${p2(date.d)}`;
    }
    return { date: iso, time: `${p2(c.h)}:${p2(c.mi)}`, seconds: c.s, assumed };
  };

  // 2026-10-17 14:32[:08] · 2026/10/17 · 2026.10.17
  let m = new RegExp(String.raw`(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s,]+)${TIME}`).exec(text);
  if (m) return out({ y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }, clock(m[4]!, m[5]!, m[6], m[7]));

  // 17.10.2026 14:32 · 17.10.26 14:32 (German: day first)
  m = new RegExp(String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[,\s]+(?:um\s+)?)${TIME}`).exec(text);
  if (m) return out({ y: fullYear(m[3]!), mo: Number(m[2]), d: Number(m[1]) }, clock(m[4]!, m[5]!, m[6], m[7]));

  // 10/17/2026 02:32 PM · 17-10-2026 · numeric with the year last: the text decides, else the context, else day first
  m = new RegExp(String.raw`(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+)${TIME}`).exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let order: "dmy" | "mdy";
    if (a > 12) order = "dmy";
    else if (b > 12) order = "mdy";
    else {
      order = ctx.order ?? "dmy";
      assumed.push("order");
    }
    return out({ y: fullYear(m[3]!), mo: order === "dmy" ? b : a, d: order === "dmy" ? a : b }, clock(m[4]!, m[5]!, m[6], m[7]));
  }

  // 17 Okt 2026 14:32 · Oct 17, 2026 2:32 PM · 17. Okt. 14:32 · Oct 17 14:32
  m = new RegExp(String.raw`(\d{1,2})\.?\s*([A-Za-zÄäÖöÜü]{3,9})\.?,?(?:\s+(\d{4}))?[,\s]+(?:um\s+)?${TIME}`).exec(text);
  if (m && MONTHS[m[2]!.toLowerCase().slice(0, 3)]) return out({ y: m[3] ? Number(m[3]) : null, mo: MONTHS[m[2]!.toLowerCase().slice(0, 3)]!, d: Number(m[1]) }, clock(m[4]!, m[5]!, m[6], m[7]));
  m = new RegExp(String.raw`([A-Za-zÄäÖöÜü]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?[,\s]+${TIME}`).exec(text);
  if (m && MONTHS[m[1]!.toLowerCase().slice(0, 3)]) return out({ y: m[3] ? Number(m[3]) : null, mo: MONTHS[m[1]!.toLowerCase().slice(0, 3)]!, d: Number(m[2]) }, clock(m[4]!, m[5]!, m[6], m[7]));

  // 17.10. 14:32 (German, no year)
  m = new RegExp(String.raw`(?:^|\s)(\d{1,2})\.(\d{1,2})\.?[,\s]+${TIME}`).exec(text);
  if (m && Number(m[2]) <= 12) return out({ y: null, mo: Number(m[2]), d: Number(m[1]) }, clock(m[3]!, m[4]!, m[5], m[6]));

  // 10-17 14:32 · 10/17 14:32 (no year; exchange apps write month first, a value above 12 settles it)
  m = new RegExp(String.raw`(?:^|\s)(\d{1,2})[/-](\d{1,2})[,\s]+${TIME}`).exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let order: "dmy" | "mdy";
    if (a > 12) order = "dmy";
    else if (b > 12) order = "mdy";
    else {
      order = ctx.order ?? "mdy";
      assumed.push("order");
    }
    return out({ y: null, mo: order === "dmy" ? b : a, d: order === "dmy" ? a : b }, clock(m[3]!, m[4]!, m[5], m[6]));
  }

  // 14:32[:08] alone
  m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?\s*$/.exec(text);
  if (m) {
    const c = clock(m[1]!, m[2]!, m[3], m[4]);
    return c ? { date: null, time: `${p2(c.h)}:${p2(c.mi)}`, seconds: c.s, assumed } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ zones */

/** A zone: a fixed offset in minutes east of UTC, or an IANA id. */
export type ZoneSpec = { kind: "offset"; minutes: number; label: string } | { kind: "iana"; id: string; label: string };

const ABBREVIATIONS: Record<string, number> = {
  utc: 0, gmt: 0, z: 0,
  cet: 60, mez: 60, cest: 120, mesz: 120, eet: 120, eest: 180,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
  sgt: 480, hkt: 480, jst: 540, kst: 540, ist: 330, msk: 180,
};

/** `UTC+8`, `UTC+08:00`, `GMT-5`, `UTC +5:30`, `CET`, `Europe/Berlin` → a zone; `null` for anything else. */
export function parseZone(text: string | null | undefined): ZoneSpec | null {
  if (!text) return null;
  const t = text.trim().replace(/−/g, "-");
  const off = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (off) {
    const minutes = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0));
    if (Math.abs(minutes) > 14 * 60) return null;
    return { kind: "offset", minutes, label: `UTC${minutes < 0 ? "−" : "+"}${Math.floor(Math.abs(minutes) / 60)}${Math.abs(minutes) % 60 ? `:${p2(Math.abs(minutes) % 60)}` : ""}`.replace("UTC+0", "UTC") };
  }
  const abbr = ABBREVIATIONS[t.toLowerCase()];
  if (abbr != null) return { kind: "offset", minutes: abbr, label: t.toUpperCase() };
  if (/^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(t)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: t });
      return { kind: "iana", id: t, label: t };
    } catch {
      return null;
    }
  }
  return null;
}

/** The browser's zone (the journal's wall clock), `Europe/Berlin` where the runtime cannot tell. */
export function localZoneId(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
}

const dtf = new Map<string, Intl.DateTimeFormat>();
function formatter(id: string): Intl.DateTimeFormat {
  let f = dtf.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: id, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtf.set(id, f);
  }
  return f;
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Wall clock of an instant in an IANA zone. */
function wallIn(epoch: number, id: string): Wall {
  const g: Record<string, number> = {};
  for (const p of formatter(id).formatToParts(new Date(epoch))) if (p.type !== "literal") g[p.type] = Number(p.value);
  return { y: g.year!, mo: g.month!, d: g.day!, h: g.hour! % 24, mi: g.minute!, s: g.second! };
}

const asUtc = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

/** The instant at which `w` is the wall clock in `zone`. */
function epochOf(w: Wall, zone: ZoneSpec): number {
  const guess = asUtc(w);
  if (zone.kind === "offset") return guess - zone.minutes * 60_000;
  let epoch = guess - (asUtc(wallIn(guess, zone.id)) - guess);
  // daylight-saving edge: check the offset at the candidate instant once more
  const again = guess - (asUtc(wallIn(epoch, zone.id)) - epoch);
  if (again !== epoch) epoch = again;
  return epoch;
}

/**
 * `date` + `time` read in zone `from`, as `YYYY-MM-DDTHH:mm[:ss]` in the IANA zone `toId` (seconds only when known).
 */
export function toLocalWall(date: string, time: string, seconds: number | null, from: ZoneSpec, toId: string): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const epoch = epochOf({ y, mo, d, h, mi, s: seconds ?? 0 }, from);
  const w = wallIn(epoch, toId);
  const base = `${w.y}-${p2(w.mo)}-${p2(w.d)}T${p2(w.h)}:${p2(w.mi)}`;
  return seconds == null ? base : `${base}:${p2(w.s)}`;
}

/** Minutes between two `YYYY-MM-DDTHH:mm[:ss]` wall clocks (same zone), `NaN` when one does not parse. */
export function minutesBetween(a: string, b: string): number {
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  if (!ok.test(a) || !ok.test(b)) return NaN;
  const pa = Date.parse(`${a}${a.length <= 16 ? ":00" : ""}Z`);
  const pb = Date.parse(`${b}${b.length <= 16 ? ":00" : ""}Z`);
  return (pb - pa) / 60_000;
}

/** Zones offered in the preview besides "wie im Bild / Journal". */
export const ZONE_CHOICES: readonly { id: string; label: string; zone: ZoneSpec }[] = [
  { id: "utc", label: "UTC", zone: { kind: "offset", minutes: 0, label: "UTC" } },
  { id: "utc+1", label: "UTC+1 (MEZ)", zone: { kind: "offset", minutes: 60, label: "UTC+1" } },
  { id: "utc+2", label: "UTC+2 (MESZ)", zone: { kind: "offset", minutes: 120, label: "UTC+2" } },
  { id: "utc+8", label: "UTC+8 (Singapur, Hongkong)", zone: { kind: "offset", minutes: 480, label: "UTC+8" } },
  { id: "ny", label: "New York (Börsenzeit)", zone: { kind: "iana", id: "America/New_York", label: "America/New_York" } },
];
