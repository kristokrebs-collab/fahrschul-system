import { describe, expect, it } from 'vitest'
import { calculateOffer, compareOffers, parseEuroToCents, sanitiseQuantity } from './pricing'
import { formatDifferenceFromCents, formatEuroFromCents } from './format'

/**
 * Intl separates the amount from the € sign with a non-breaking space in
 * de-DE. That is correct German typography, so the tests assert it explicitly
 * rather than the formatter being "fixed" to emit a plain space.
 */
const NBSP = ' '
const eur = (amount: string) => `${amount}${NBSP}€`

describe('parseEuroToCents', () => {
  it('parses German decimal input', () => {
    expect(parseEuroToCents('64,50')).toBe(6450)
    expect(parseEuroToCents('399')).toBe(39900)
    expect(parseEuroToCents('0,01')).toBe(1)
  })

  it('parses thousands separators in both conventions', () => {
    expect(parseEuroToCents('1.234,50')).toBe(123450)
    expect(parseEuroToCents('1,234.50')).toBe(123450)
    expect(parseEuroToCents('2.000')).toBe(200000)
  })

  it('tolerates currency symbols and whitespace', () => {
    expect(parseEuroToCents(' 64,50 € ')).toBe(6450)
    expect(parseEuroToCents('€99')).toBe(9900)
  })

  it('returns null rather than zero for empty or invalid input', () => {
    // "unknown" and "free" must never collapse into the same value.
    expect(parseEuroToCents('')).toBeNull()
    expect(parseEuroToCents('   ')).toBeNull()
    expect(parseEuroToCents('abc')).toBeNull()
    expect(parseEuroToCents('12,,5')).toBeNull()
    expect(parseEuroToCents('-40')).toBeNull()
  })

  it('reads a lone dot with three trailing digits as a thousands separator', () => {
    // German visitors type "2.000" meaning two thousand euro.
    expect(parseEuroToCents('2.000')).toBe(200000)
    expect(parseEuroToCents('1.500')).toBe(150000)
    // ...but two trailing digits is unambiguously a decimal amount.
    expect(parseEuroToCents('64.50')).toBe(6450)
    expect(parseEuroToCents('9.9')).toBe(990)
  })

  it('handles repeated thousands separators', () => {
    expect(parseEuroToCents('1.234.567')).toBe(123456700)
    expect(parseEuroToCents('1.234.567,89')).toBe(123456789)
  })

  it('rejects malformed German input with multiple commas', () => {
    expect(parseEuroToCents('1,234,567')).toBeNull()
  })

  it('strips non-breaking spaces as produced by our own formatter', () => {
    expect(parseEuroToCents('2.591,00 €')).toBe(259100)
  })

  it('rounds on the cent, not on the float', () => {
    expect(parseEuroToCents('0,1')).toBe(10)
    expect(parseEuroToCents('19,99')).toBe(1999)
    // 1.005 * 100 is 100.49999999999999 in IEEE-754
    expect(parseEuroToCents('1,005')).toBe(101)
  })
})

describe('sanitiseQuantity', () => {
  it('clamps to the allowed range', () => {
    expect(sanitiseQuantity(5, 0, 10)).toBe(5)
    expect(sanitiseQuantity(-3, 0, 10)).toBe(0)
    expect(sanitiseQuantity(99, 0, 10)).toBe(10)
  })

  it('rejects non-finite values', () => {
    expect(sanitiseQuantity(Number.NaN, 1, 10)).toBe(1)
    expect(sanitiseQuantity(Number.POSITIVE_INFINITY, 0, 10)).toBe(10)
    expect(sanitiseQuantity('abc', 2, 10)).toBe(2)
  })

  it('rounds fractional input to whole units', () => {
    expect(sanitiseQuantity(3.4)).toBe(3)
    expect(sanitiseQuantity(3.6)).toBe(4)
  })
})

describe('calculateOffer', () => {
  it('multiplies quantity by unit price and sums', () => {
    const result = calculateOffer([
      { id: 'grund', label: 'Grundbetrag', unitCents: 39900, quantity: 1 },
      { id: 'fs', label: 'Fahrstunde', unitCents: 6400, quantity: 20 },
      { id: 'sf', label: 'Sonderfahrt', unitCents: 7600, quantity: 12 },
    ])

    expect(result.totalCents).toBe(39900 + 6400 * 20 + 7600 * 12)
    expect(result.totalCents).toBe(259100)
    expect(result.isComplete).toBe(true)
    expect(formatEuroFromCents(result.totalCents)).toBe(eur('2.591,00'))
  })

  it('reports unpriced lines instead of treating them as free', () => {
    const result = calculateOffer([
      { id: 'grund', label: 'Grundbetrag', unitCents: 39900, quantity: 1 },
      { id: 'sim', label: 'Simulator', unitCents: null, quantity: 4 },
    ])

    expect(result.totalCents).toBe(39900)
    expect(result.missing).toEqual(['sim'])
    expect(result.isComplete).toBe(false)
  })

  it('does not flag unpriced lines that have no quantity', () => {
    const result = calculateOffer([
      { id: 'grund', label: 'Grundbetrag', unitCents: 39900, quantity: 1 },
      { id: 'sim', label: 'Simulator', unitCents: null, quantity: 0 },
    ])

    expect(result.missing).toEqual([])
    expect(result.isComplete).toBe(true)
  })

  it('handles an entirely empty offer', () => {
    const result = calculateOffer([])
    expect(result.totalCents).toBe(0)
    expect(result.isComplete).toBe(true)
  })

  it('clamps negative quantities to zero rather than crediting the total', () => {
    const result = calculateOffer([{ id: 'fs', label: 'Fahrstunde', unitCents: 6400, quantity: -5 }])
    expect(result.totalCents).toBe(0)
  })

  it('stays exact over many lines where float euros would drift', () => {
    const lines = Array.from({ length: 100 }, (_, i) => ({
      id: `l${i}`,
      label: `Position ${i}`,
      unitCents: 1010, // 10,10 €
      quantity: 3,
    }))
    const result = calculateOffer(lines)
    expect(result.totalCents).toBe(303000)
    expect(formatEuroFromCents(result.totalCents)).toBe(eur('3.030,00'))
  })
})

describe('compareOffers', () => {
  const lines = [
    { id: 'grund', label: 'Grundbetrag', quantity: 1, aUnitCents: 39900, bUnitCents: 45000 },
    { id: 'fs', label: 'Fahrstunde', quantity: 20, aUnitCents: 6400, bUnitCents: 6900 },
    { id: 'sf', label: 'Sonderfahrt', quantity: 12, aUnitCents: 7600, bUnitCents: 8200 },
  ]

  it('applies the same quantities to both offers', () => {
    const result = compareOffers(lines)
    const grund = result.lines.find((l) => l.id === 'grund')!
    expect(grund.aSubtotalCents).toBe(39900)
    expect(grund.bSubtotalCents).toBe(45000)
    expect(grund.differenceCents).toBe(5100)
  })

  it('computes totals and a like-for-like difference', () => {
    const result = compareOffers(lines)
    expect(result.aTotalCents).toBe(39900 + 6400 * 20 + 7600 * 12)
    expect(result.bTotalCents).toBe(45000 + 6900 * 20 + 8200 * 12)
    expect(result.differenceCents).toBe(result.bTotalCents - result.aTotalCents)
    expect(result.differenceCents).toBe(22300)
    expect(formatDifferenceFromCents(result.differenceCents)).toBe(`+ ${eur('223,00')}`)
    expect(result.comparable).toBe(true)
  })

  it('flags a line where only one side has a price', () => {
    const result = compareOffers([
      ...lines,
      { id: 'sim', label: 'Simulator', quantity: 4, aUnitCents: null, bUnitCents: 5000 },
    ])
    expect(result.incomparable).toEqual(['sim'])
    expect(result.comparable).toBe(false)
  })

  it('does not flag a one-sided line with zero quantity', () => {
    const result = compareOffers([
      ...lines,
      { id: 'sim', label: 'Simulator', quantity: 0, aUnitCents: null, bUnitCents: 5000 },
    ])
    expect(result.incomparable).toEqual([])
    expect(result.comparable).toBe(true)
  })

  it('reports a negative difference when the second offer is cheaper', () => {
    const result = compareOffers([
      { id: 'grund', label: 'Grundbetrag', quantity: 1, aUnitCents: 50000, bUnitCents: 39900 },
    ])
    expect(result.differenceCents).toBe(-10100)
    expect(formatDifferenceFromCents(result.differenceCents)).toBe(`− ${eur('101,00')}`)
  })

  it('reports no difference for identical offers', () => {
    const result = compareOffers([
      { id: 'grund', label: 'Grundbetrag', quantity: 1, aUnitCents: 39900, bUnitCents: 39900 },
    ])
    expect(result.differenceCents).toBe(0)
    expect(formatDifferenceFromCents(0)).toBe(eur('0,00'))
  })

  it('treats both sides as zero when neither has a price', () => {
    const result = compareOffers([
      { id: 'x', label: 'Unbekannt', quantity: 3, aUnitCents: null, bUnitCents: null },
    ])
    expect(result.aTotalCents).toBe(0)
    expect(result.bTotalCents).toBe(0)
    expect(result.incomparable).toEqual([])
  })
})

describe('formatting', () => {
  it('formats euro amounts in the German convention', () => {
    expect(formatEuroFromCents(259100)).toBe(eur('2.591,00'))
    expect(formatEuroFromCents(0)).toBe(eur('0,00'))
    expect(formatEuroFromCents(5)).toBe(eur('0,05'))
  })

  it('uses a typographic minus sign for negative differences', () => {
    expect(formatDifferenceFromCents(-5000)).toContain('−')
    expect(formatDifferenceFromCents(-5000)).not.toContain('-5')
  })
})
