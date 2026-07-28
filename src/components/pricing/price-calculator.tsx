'use client'

import { useId, useMemo, useState } from 'react'
import { defaultAssumptions, priceItems, type PriceItem } from '@/content/prices'
import { publicValue } from '@/content/truth'
import { compareOffers, parseEuroToCents, sanitiseQuantity } from '@/lib/pricing'
import { formatDifferenceFromCents, formatEuroFromCents } from '@/lib/format'

/**
 * Chapter 7 — the cost calculator.
 *
 * Design decision worth stating plainly: this driving school does not publish
 * a price list, and a list that circulated during the project turned out to
 * belong to an unrelated company with the same name. Rather than invent
 * numbers, the tool does the thing a visitor actually needs — it compares two
 * real offers line by line, over identical quantities.
 *
 * That matters because comparing headline totals is how people get misled: two
 * schools quoting different numbers of practice lessons are not comparable at
 * all. Here the quantities are shared, so the difference is like for like.
 *
 * If the owner later supplies the real rates, they appear automatically in the
 * left-hand column — see src/content/prices.ts.
 */

type ClassKey = 'klasse-b' | 'bf17'

export function PriceCalculator() {
  const [classKey, setClassKey] = useState<ClassKey>('klasse-b')
  const [quantities, setQuantities] = useState<Record<string, number>>(() => initialQuantities('klasse-b'))
  const [ownPrices, setOwnPrices] = useState<Record<string, string>>({})
  const [comparePrices, setComparePrices] = useState<Record<string, string>>({})
  const headingId = useId()

  const assumptions = defaultAssumptions[classKey]

  const rows = useMemo(() => {
    return assumptions
      .map((assumption) => {
        const item = priceItems.find((p) => p.id === assumption.itemId)
        if (!item) return null
        return { item, assumption }
      })
      .filter((r): r is { item: PriceItem; assumption: (typeof assumptions)[number] } => r !== null)
  }, [assumptions])

  const comparison = useMemo(() => {
    return compareOffers(
      rows.map(({ item, assumption }) => {
        // A confirmed published rate wins; otherwise whatever the visitor typed.
        const published = publicValue(item.rate)
        const typed = parseEuroToCents(ownPrices[item.id] ?? '')
        return {
          id: item.id,
          label: item.label,
          quantity: quantities[item.id] ?? assumption.quantity,
          aUnitCents: typed ?? (published !== undefined ? Math.round(published * 100) : null),
          bUnitCents: parseEuroToCents(comparePrices[item.id] ?? ''),
        }
      }),
    )
  }, [rows, quantities, ownPrices, comparePrices])

  const hasAnyB = comparison.lines.some((l) => l.bUnitCents !== null)
  const hasAnyA = comparison.lines.some((l) => l.aUnitCents !== null)

  function switchClass(next: ClassKey) {
    setClassKey(next)
    setQuantities(initialQuantities(next))
  }

  return (
    <div className="surface overflow-hidden">
      <div className="border-b border-chalk/8 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-eyebrow mr-2 text-chalk-faint">Klasse</span>
          {(['klasse-b', 'bf17'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchClass(key)}
              aria-pressed={classKey === key}
              className={`min-h-11 rounded-lg border px-4 text-sm font-semibold transition-colors ${
                classKey === key
                  ? 'border-signal-500/50 bg-signal-500/10 text-chalk'
                  : 'border-chalk/12 text-chalk-dim hover:border-chalk/30 hover:text-chalk'
              }`}
            >
              {key === 'klasse-b' ? 'Klasse B' : 'BF17'}
            </button>
          ))}
        </div>

        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-chalk-dim">
          Trag die Positionen aus deinem Angebot ein und daneben die eines anderen Angebots. Der Rechner nutzt für
          beide Seiten <strong className="font-semibold text-chalk-soft">dieselben Mengen</strong> — nur so ist ein
          Vergleich aussagekräftig.
        </p>
      </div>

      {/* `relative` is load-bearing: the visually hidden <span> labels inside
          the cells are absolutely positioned, and without a positioning context
          here their containing block would be the page rather than this scroll
          container — which puts them at the far right of the *document* and
          gives the whole page phantom horizontal overflow on narrow screens. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only" id={headingId}>
            Kostenvergleich zweier Angebote bei gleicher Menge
          </caption>
          <thead>
            <tr className="border-b border-chalk/8 text-left">
              <th scope="col" className="p-4 font-semibold text-chalk-dim">
                Position
              </th>
              <th scope="col" className="w-28 p-4 text-center font-semibold text-chalk-dim">
                Menge
              </th>
              <th scope="col" className="w-40 p-4 font-semibold text-chalk">
                Dein Angebot
              </th>
              <th scope="col" className="w-40 p-4 font-semibold text-chalk-dim">
                Vergleichsangebot
              </th>
              <th scope="col" className="w-32 p-4 text-right font-semibold text-chalk-dim">
                Differenz
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, assumption }) => {
              const line = comparison.lines.find((l) => l.id === item.id)!
              const fixed = assumption.min === assumption.max

              return (
                <tr key={item.id} className="border-b border-chalk/6 align-top">
                  <th scope="row" className="p-4 text-left font-normal">
                    <span className="block font-semibold text-chalk">{item.label}</span>
                    <span className="block text-xs text-chalk-faint">{item.unit}</span>
                    {assumption.note && (
                      <span className="mt-1 block max-w-xs text-xs leading-relaxed text-chalk-faint">
                        {assumption.note}
                      </span>
                    )}
                  </th>

                  <td className="p-4 text-center">
                    {fixed ? (
                      <span className="tabular inline-flex min-h-11 items-center justify-center text-chalk-soft">
                        {assumption.quantity}
                      </span>
                    ) : (
                      <label className="block">
                        <span className="sr-only">Menge {item.label}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={assumption.min}
                          max={assumption.max}
                          value={quantities[item.id] ?? assumption.quantity}
                          onChange={(e) =>
                            setQuantities((q) => ({
                              ...q,
                              [item.id]: sanitiseQuantity(e.target.value, assumption.min, assumption.max),
                            }))
                          }
                          className="tabular h-11 w-20 rounded-lg border border-chalk/12 bg-ink-950/60 px-2 text-center text-chalk focus:border-signal-500"
                        />
                      </label>
                    )}
                  </td>

                  <td className="p-4">
                    <EuroInput
                      label={`Preis ${item.label}, dein Angebot`}
                      value={ownPrices[item.id] ?? ''}
                      onChange={(v) => setOwnPrices((p) => ({ ...p, [item.id]: v }))}
                      accent
                    />
                    <Subtotal cents={line.aSubtotalCents} />
                  </td>

                  <td className="p-4">
                    <EuroInput
                      label={`Preis ${item.label}, Vergleichsangebot`}
                      value={comparePrices[item.id] ?? ''}
                      onChange={(v) => setComparePrices((p) => ({ ...p, [item.id]: v }))}
                    />
                    <Subtotal cents={line.bSubtotalCents} />
                  </td>

                  <td className="tabular p-4 text-right">
                    {line.differenceCents === null ? (
                      <span className="text-chalk-faint">—</span>
                    ) : (
                      <span className={line.differenceCents > 0 ? 'text-state-done' : line.differenceCents < 0 ? 'text-signal-400' : 'text-chalk-dim'}>
                        {formatDifferenceFromCents(line.differenceCents)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot>
            <tr className="bg-chalk/[0.03]">
              <th scope="row" className="p-4 text-left font-display text-base font-bold text-chalk">
                Summe
              </th>
              <td />
              <td className="tabular p-4 font-display text-lg font-extrabold text-chalk">
                {hasAnyA ? formatEuroFromCents(comparison.aTotalCents) : '—'}
              </td>
              <td className="tabular p-4 font-display text-lg font-extrabold text-chalk-soft">
                {hasAnyB ? formatEuroFromCents(comparison.bTotalCents) : '—'}
              </td>
              <td className="tabular p-4 text-right font-display text-lg font-extrabold">
                {hasAnyA && hasAnyB ? (
                  <span className={comparison.differenceCents > 0 ? 'text-state-done' : 'text-signal-400'}>
                    {formatDifferenceFromCents(comparison.differenceCents)}
                  </span>
                ) : (
                  <span className="text-chalk-faint">—</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Live region: totals change without a page update, so announce them. */}
      <p aria-live="polite" className="sr-only">
        {hasAnyA && hasAnyB
          ? `Summe deines Angebots ${formatEuroFromCents(comparison.aTotalCents)}, Vergleichsangebot ${formatEuroFromCents(
              comparison.bTotalCents,
            )}. Differenz ${formatDifferenceFromCents(comparison.differenceCents)}.`
          : 'Noch nicht genügend Preise eingetragen für einen Vergleich.'}
      </p>

      <div className="space-y-4 border-t border-chalk/8 p-6 sm:p-8">
        {!comparison.comparable && (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm text-amber-400">
            Bei mindestens einer Position ist nur auf einer Seite ein Preis eingetragen. Die Summen sind deshalb noch
            nicht direkt vergleichbar.
          </p>
        )}

        <p className="text-xs leading-relaxed text-chalk-faint">
          Der Rechner bildet nur Leistungen der Fahrschule ab. Gebühren der Führerscheinstelle, der Prüforganisation,
          für den Sehtest und den Erste-Hilfe-Kurs kommen bei jeder Fahrschule zusätzlich dazu und unterscheiden sich
          nicht nach Anbieter. Die Zahl der Übungsfahrstunden ist gesetzlich nicht vorgeschrieben — sie ist die
          Position, die den Gesamtpreis am stärksten bewegt, und lässt sich vorab niemals exakt vorhersagen.
        </p>
      </div>
    </div>
  )
}

function EuroInput({
  label,
  value,
  onChange,
  accent = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  accent?: boolean
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="relative block">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0,00"
          aria-label={label}
          className={`tabular h-11 w-full rounded-lg border bg-ink-950/60 pl-3 pr-7 text-right text-chalk placeholder:text-chalk-faint ${
            accent ? 'border-signal-500/30 focus:border-signal-500' : 'border-chalk/12 focus:border-chalk/40'
          }`}
        />
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-chalk-faint">
          €
        </span>
      </span>
    </label>
  )
}

function Subtotal({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="mt-1.5 block text-right text-xs text-chalk-faint">—</span>
  return <span className="tabular mt-1.5 block text-right text-xs text-chalk-dim">{formatEuroFromCents(cents)}</span>
}

function initialQuantities(classKey: ClassKey): Record<string, number> {
  return Object.fromEntries(defaultAssumptions[classKey].map((a) => [a.itemId, a.quantity]))
}
