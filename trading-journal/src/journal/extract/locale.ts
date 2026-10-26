import type { NumberStyle } from "./numbers";

/**
 * The decimal style of the device language (a German phone shows 67.000 for 67000 and 0,05 for 0.05). It only settles
 * numbers the screenshot itself does not prove, and those stay marked as ambiguous.
 */
export function detectLocaleStyle(): NumberStyle | null {
  try {
    const lang = typeof navigator !== "undefined" ? navigator.language : undefined;
    const sample = new Intl.NumberFormat(lang).format(1.1);
    return sample.includes(",") ? "comma" : sample.includes(".") ? "point" : null;
  } catch {
    return null;
  }
}
