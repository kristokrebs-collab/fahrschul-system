/**
 * Cleaning of the texts the engine read (PURE): numbers, times, signs. Nothing here guesses a VALUE – it repairs
 * what is certainly an engine slip (a letter O inside a number, a space, a unicode minus) and says so.
 */

export interface Cleaned {
  text: string;
  /** Characters were replaced (a letter that looks like a digit …): the reading is less sure. */
  repaired: boolean;
}

const MINUS = /[−‒–—﹣－]/g;

/** „− 14.66 “ → „-14.66“; digit look-alikes between digits repaired; unit / junk around the number dropped, a „%“ kept. */
export function cleanNumberText(raw: string): Cleaned {
  let t = raw.trim().replace(MINUS, "-");
  let repaired = false;
  // brackets / icons glued to the number („[4“, „)“, „›“)
  t = t.replace(/^[^\d+\-.,]+(?=[+-]?\d)/, "").replace(/[)\]›>»]+$/g, "");
  // everything after a „%“ is the icon next to it („-2.99%4“), not part of the number
  const pct = /%/.test(t);
  t = t.replace(/%.*$/, "");
  // letters that are digits in a number: O o → 0, l I | → 1 – only inside a token that is mostly digits
  const digits = (t.match(/\d/g) ?? []).length;
  const odd = (t.match(/[OolI|]/g) ?? []).length;
  if (digits >= 2 && odd > 0 && odd <= Math.max(1, Math.floor(digits / 3))) {
    t = t.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
    repaired = true;
  }
  // the unit after the number („USDT“) is not part of it
  t = t.replace(/\s*[A-Za-z]{2,6}$/, "");
  t = t.replace(/\s+/g, "");
  t = t.replace(/^\+?-?[.,]+(?=\d)/, (m) => m.replace(/[.,]/g, "")); // a stray separator before the first digit
  t = t.replace(/[.,]+$/, "");
  return { text: pct ? `${t} %` : t, repaired };
}

const CLOCK_SEP = /^(\d{1,2})[.;:](\d{2})(?:[.;:](\d{2}))?$/;
const DATE_ISO = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;

/** „2026-10-22 17.07.22“ → „2026-10-22 17:07:22“ (a separator slip is repaired only AFTER a full date). */
export function cleanTimeText(raw: string): Cleaned {
  const t = raw.trim().replace(/\s+/g, " ").replace(/[Tt](?=\d{1,2}[:.;]\d{2})/, " ");
  const parts = t.split(" ");
  let repaired = false;
  if (parts.length >= 2 && (DATE_ISO.test(parts[0]!) || /^\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?$/.test(parts[0]!))) {
    const m = CLOCK_SEP.exec(parts[1]!);
    if (m) {
      const fixed = `${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ""}`;
      if (fixed !== parts[1]) repaired = true;
      parts[1] = fixed;
    }
  }
  return { text: parts.join(" "), repaired };
}

/** True when the cleaned text is a complete date + clock (`2026-10-22 17:07:22`, `22.10.2026 17:07`, `10-22 17:07:22`). */
export function isFullTime(t: string): boolean {
  return /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?) \d{1,2}:\d{2}(:\d{2})?$/.test(t.trim());
}

/** The number of digits after the decimal separator of a displayed price (`81,214.3` → 1, `0.0224` → 4, `81214` → 0). */
export function decimalsOf(t: string): number {
  const m = /[.,](\d+)\s*%?$/.exec(t.trim());
  if (!m) return 0;
  // „81,214“ (a thousands group) is not a decimal part when a comma is followed by exactly three digits and no point follows
  if (/,\d{3}$/.test(t.trim()) && !/\./.test(t)) return 0;
  return m[1]!.length;
}

/** `true` when the text starts with an explicit sign. */
export const hasSign = (t: string): boolean => /^\s*[+\-−–]/.test(t);
