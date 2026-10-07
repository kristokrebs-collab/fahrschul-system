/**
 * Price-axis collision guard (tablet audit 3.2): level / zone / last-price labels sit on the price axis on top of the
 * tick labels, so a tick under a label showed half-covered digits ("LH W 82.829" over "83.000"). The tick formatter
 * blanks every tick label whose centre is within `gap` px of a label centre – the label carries the price there.
 */

/** Minimum distance (px) between a tick label centre and a price label centre: half a label box + half a tick line. */
export const AXIS_LABEL_GAP = 15;

/**
 * Formats `ticks` with `format`, returning "" for ticks closer than `gap` px (via `toY`) to one of `labels` (prices).
 * Ticks whose coordinate is unknown are kept.
 */
export function filterTickLabels(ticks: readonly number[], labels: readonly number[], toY: (price: number) => number | null, format: (price: number) => string, gap = AXIS_LABEL_GAP): string[] {
  const ys: number[] = [];
  for (const p of labels) {
    const y = toY(p);
    if (y != null && Number.isFinite(y)) ys.push(y);
  }
  return ticks.map((p) => {
    if (ys.length === 0) return format(p);
    const y = toY(p);
    if (y == null) return format(p);
    for (const ly of ys) if (Math.abs(ly - y) < gap) return "";
    return format(p);
  });
}
