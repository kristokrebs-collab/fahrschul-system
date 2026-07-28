/**
 * Price calculation engine.
 *
 * Pure functions, no React, no DOM — so the arithmetic can be tested directly
 * (see src/lib/pricing.test.ts). Money is handled in whole cents throughout;
 * euros only ever appear at the formatting boundary. Floating-point euros are
 * exactly how comparison tools end up off by a cent.
 */

export interface LineInput {
  readonly id: string
  readonly label: string
  /** Unit price in cents. `null` means "no price available". */
  readonly unitCents: number | null
  readonly quantity: number
}

export interface LineResult extends LineInput {
  /** quantity × unitCents, or null when the unit price is unknown. */
  readonly subtotalCents: number | null
}

export interface OfferResult {
  readonly lines: readonly LineResult[]
  /** Sum of all known subtotals. */
  readonly totalCents: number
  /** Line ids that could not be priced, so the UI can say the total is partial. */
  readonly missing: readonly string[]
  readonly isComplete: boolean
}

/**
 * Guard against NaN, Infinity, negatives and fractional quantities.
 * NaN is meaningless and collapses to the minimum; an infinity is a magnitude
 * that is merely out of range, so it clamps to the nearer bound.
 */
export function sanitiseQuantity(value: unknown, min = 0, max = 999): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return min
  if (n === Number.POSITIVE_INFINITY) return max
  if (n === Number.NEGATIVE_INFINITY) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Parses a euro amount typed by a human into cents.
 *
 * Two subtleties this deliberately handles, both of which produce wrong money
 * if ignored:
 *
 * 1. Separator ambiguity. In German a comma is always the decimal separator
 *    and a dot is a thousands separator, so "2.000" means two thousand euro,
 *    not two. But visitors also paste "64.50" from an English-formatted offer.
 *    The rule below: whichever separator comes last is the decimal one; a lone
 *    dot followed by exactly three digits is read as a thousands separator.
 *
 * 2. Rounding. Math.round(1.005 * 100) is 100, not 101, because 1.005 is not
 *    representable in binary floating point. The fraction is therefore rounded
 *    as a string, never as a float.
 *
 * Returns null for empty or unparseable input rather than 0, because "unknown"
 * and "free" must never collapse into the same value.
 */
export function parseEuroToCents(input: string): number | null {
  if (typeof input !== 'string') return null

  // Strip currency symbols and every kind of space, including non-breaking.
  const cleaned = input.replace(/[€\s  ']/g, '')
  if (cleaned === '') return null
  if (!/^\d[\d.,]*$/.test(cleaned)) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let decimalIndex = -1
  if (lastComma >= 0 && lastDot >= 0) {
    decimalIndex = Math.max(lastComma, lastDot)
  } else if (lastComma >= 0) {
    // A comma is always the decimal separator in German input.
    decimalIndex = cleaned.indexOf(',') === lastComma ? lastComma : -1
    if (decimalIndex === -1) return null // "1,234,567" is not valid German
  } else if (lastDot >= 0) {
    const digitsAfter = cleaned.length - lastDot - 1
    const onlyOneDot = cleaned.indexOf('.') === lastDot
    // A lone dot with exactly three digits after it is a thousands separator.
    decimalIndex = onlyOneDot && digitsAfter !== 3 ? lastDot : -1
  }

  const integerRaw = decimalIndex === -1 ? cleaned : cleaned.slice(0, decimalIndex)
  const fractionRaw = decimalIndex === -1 ? '' : cleaned.slice(decimalIndex + 1)

  const integerDigits = integerRaw.replace(/[.,]/g, '')
  if (integerDigits === '' || !/^\d+$/.test(integerDigits)) return null
  if (fractionRaw !== '' && !/^\d+$/.test(fractionRaw)) return null

  const euros = Number(integerDigits)
  if (!Number.isSafeInteger(euros)) return null

  // Round the fraction to two places by inspecting the third digit as a
  // character, so no float ever touches the value.
  let cents = 0
  if (fractionRaw !== '') {
    const twoPlaces = fractionRaw.slice(0, 2).padEnd(2, '0')
    cents = Number(twoPlaces)
    const nextDigit = fractionRaw.charCodeAt(2) - 48
    if (nextDigit >= 5 && nextDigit <= 9) cents += 1
  }

  return euros * 100 + cents
}

export function calculateOffer(lines: readonly LineInput[]): OfferResult {
  const results: LineResult[] = lines.map((line) => ({
    ...line,
    subtotalCents: line.unitCents === null ? null : line.unitCents * sanitiseQuantity(line.quantity),
  }))

  const totalCents = results.reduce((sum, l) => sum + (l.subtotalCents ?? 0), 0)
  const missing = results.filter((l) => l.subtotalCents === null && l.quantity > 0).map((l) => l.id)

  return {
    lines: results,
    totalCents,
    missing,
    isComplete: missing.length === 0,
  }
}

export interface ComparisonLine {
  readonly id: string
  readonly label: string
  readonly quantity: number
  readonly aUnitCents: number | null
  readonly bUnitCents: number | null
  readonly aSubtotalCents: number | null
  readonly bSubtotalCents: number | null
  /** b − a. Positive means offer B is more expensive on this line. */
  readonly differenceCents: number | null
}

export interface ComparisonResult {
  readonly lines: readonly ComparisonLine[]
  readonly aTotalCents: number
  readonly bTotalCents: number
  /** b − a. Positive means B costs more overall. */
  readonly differenceCents: number
  /** Lines where exactly one side has a price — these make the totals not directly comparable. */
  readonly incomparable: readonly string[]
  readonly comparable: boolean
}

/**
 * Compares two offers over the *same* quantities.
 *
 * Comparing headline totals is misleading whenever the underlying assumptions
 * differ, so this deliberately takes one shared quantity per line and applies
 * it to both sides. The difference it reports is therefore a like-for-like one.
 */
export function compareOffers(
  lines: readonly { id: string; label: string; quantity: number; aUnitCents: number | null; bUnitCents: number | null }[],
): ComparisonResult {
  const resultLines: ComparisonLine[] = lines.map((line) => {
    const quantity = sanitiseQuantity(line.quantity)
    const aSubtotalCents = line.aUnitCents === null ? null : line.aUnitCents * quantity
    const bSubtotalCents = line.bUnitCents === null ? null : line.bUnitCents * quantity
    const differenceCents =
      aSubtotalCents === null || bSubtotalCents === null ? null : bSubtotalCents - aSubtotalCents

    return { ...line, quantity, aSubtotalCents, bSubtotalCents, differenceCents }
  })

  const aTotalCents = resultLines.reduce((s, l) => s + (l.aSubtotalCents ?? 0), 0)
  const bTotalCents = resultLines.reduce((s, l) => s + (l.bSubtotalCents ?? 0), 0)

  // A line counts as incomparable only when it actually contributes: a line
  // with quantity 0 is priced at 0 on both sides regardless of unit price.
  const incomparable = resultLines
    .filter((l) => l.quantity > 0 && (l.aSubtotalCents === null) !== (l.bSubtotalCents === null))
    .map((l) => l.id)

  return {
    lines: resultLines,
    aTotalCents,
    bTotalCents,
    differenceCents: bTotalCents - aTotalCents,
    incomparable,
    comparable: incomparable.length === 0,
  }
}
