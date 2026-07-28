/**
 * Formatting helpers, all locked to de-DE.
 * Formatter instances are created once — constructing Intl formatters inside a
 * render loop is a measurable cost on low-powered phones.
 */

const euroFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const euroWholeFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('de-DE')

export function formatEuroFromCents(cents: number): string {
  return euroFormatter.format(cents / 100)
}

export function formatEuroWhole(euros: number): string {
  return euroWholeFormatter.format(euros)
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

/** Signed difference, e.g. "+ 240,00 €" / "− 240,00 €". Uses a real minus sign. */
export function formatDifferenceFromCents(cents: number): string {
  if (cents === 0) return formatEuroFromCents(0)
  const sign = cents > 0 ? '+ ' : '− '
  return sign + euroFormatter.format(Math.abs(cents) / 100)
}

/** "45 Minuten" style duration for lesson units. */
export function formatMinutes(minutes: number): string {
  return `${formatNumber(minutes)} Minuten`
}
