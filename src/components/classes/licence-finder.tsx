'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { finderQuestions, recommend, type FinderAnswers } from '@/lib/licence-finder'
import { publicValue } from '@/content/truth'
import { SpotlightGroup } from '@/components/brand/spotlight'

/**
 * Chapter 2 — the licence finder.
 *
 * A junction in the route: six short questions, then a concrete
 * recommendation with the reasoning shown. Deliberately not a lead-capture
 * gate — the answer appears without asking for an e-mail address.
 *
 * Accessibility notes: each step is a radiogroup, the result is announced via
 * a live region, and answering with the keyboard alone works because the
 * options are real radio inputs with a visible focus ring.
 */
export function LicenceFinder() {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<FinderAnswers>({})
  const [done, setDone] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)

  const questions = useMemo(() => {
    // The gearbox question only makes sense for car classes.
    return finderQuestions.filter((q) => !(q.id === 'gear' && answers.vehicle !== 'auto'))
  }, [answers.vehicle])

  const current = questions[step]
  const results = useMemo(() => recommend(answers), [answers])
  const top = results[0]
  const alternatives = results.slice(1, 3)

  function choose(value: string) {
    const next = { ...answers, [current!.id]: value } as FinderAnswers
    setAnswers(next)

    if (step + 1 >= questions.length) {
      setDone(true)
      // Move focus to the result so screen-reader and keyboard users land on it.
      requestAnimationFrame(() => resultRef.current?.focus())
    } else {
      setStep(step + 1)
    }
  }

  function restart() {
    setAnswers({})
    setStep(0)
    setDone(false)
  }

  const progress = done ? 1 : step / questions.length

  return (
    <div className="surface-glass overflow-hidden rounded-2xl">
      {/* Progress reads as a route being travelled, not a loading bar. */}
      <div className="relative h-1 w-full bg-chalk/8">
        <div
          className="absolute inset-y-0 left-0 bg-signal-500 transition-[width] duration-500 ease-[var(--ease-route)]"
          style={{ width: `${Math.max(4, progress * 100)}%` }}
        />
      </div>

      <div className="p-6 sm:p-9">
        {!done && current ? (
          <fieldset>
            <div className="flex items-baseline justify-between gap-4">
              <legend className="font-display text-xl font-bold text-chalk sm:text-2xl">{current.question}</legend>
              <span className="tabular shrink-0 text-xs font-semibold text-chalk-faint">
                {step + 1} / {questions.length}
              </span>
            </div>
            {current.hint && <p className="mt-2 text-sm text-chalk-dim">{current.hint}</p>}

            <SpotlightGroup className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {current.options.map((option) => (
                <label
                  key={option.value}
                  className="spot-card group relative flex cursor-pointer items-start gap-3 rounded-xl border border-chalk/10 bg-chalk/[0.02] p-4 transition-colors hover:border-signal-500/50 hover:bg-signal-500/[0.06] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal-400"
                >
                  <input
                    type="radio"
                    name={current.id}
                    value={option.value}
                    onChange={() => choose(option.value)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-chalk/30 transition-colors group-hover:border-signal-400 group-hover:bg-signal-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-chalk">{option.label}</span>
                    {option.description && (
                      <span className="mt-0.5 block text-xs text-chalk-dim">{option.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </SpotlightGroup>

            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-chalk-dim transition-colors hover:text-chalk"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 12H5M11 18l-6-6 6-6" />
                </svg>
                Eine Frage zurück
              </button>
            )}
          </fieldset>
        ) : (
          <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
            <div aria-live="polite">
              {top ? (
                <>
                  <p className="type-eyebrow text-signal-400">Unsere Empfehlung</p>
                  <h3 className="mt-3 font-display text-3xl font-extrabold text-chalk sm:text-4xl">
                    {top.licenceClass.name}
                  </h3>
                  <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-chalk-soft">
                    {top.licenceClass.summary}
                  </p>

                  <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-chalk/10 bg-chalk/[0.02] p-4">
                      <dt className="type-eyebrow text-chalk-faint">Mindestalter</dt>
                      <dd className="mt-1.5 text-sm font-semibold text-chalk">
                        {publicValue(top.licenceClass.minAge) ?? 'Auf Anfrage'}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-chalk/10 bg-chalk/[0.02] p-4">
                      <dt className="type-eyebrow text-chalk-faint">Voraussetzungen</dt>
                      <dd className="mt-1.5 text-sm text-chalk-soft">
                        {top.licenceClass.prerequisites.slice(0, 2).join(' · ') || 'Keine besonderen'}
                      </dd>
                    </div>
                  </dl>

                  {top.reasons.length > 0 && (
                    <ul className="mt-6 space-y-2">
                      {top.reasons.map((reason) => (
                        <li key={reason} className="flex gap-2.5 text-sm text-chalk-soft">
                          <span aria-hidden className="mt-1.5 h-1.5 w-3 shrink-0 rounded-sm bg-signal-500" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}

                  {top.blockers.length > 0 && (
                    <ul className="mt-4 space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                      {top.blockers.map((blocker) => (
                        <li key={blocker} className="text-sm text-amber-400">
                          {blocker}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link
                      href={`/fuehrerschein/${top.licenceClass.slug}`}
                      className="inline-flex min-h-12 items-center justify-center rounded-xl bg-signal-500 px-6 text-sm font-semibold text-chalk transition-colors hover:bg-signal-600"
                    >
                      {top.licenceClass.name} ansehen
                    </Link>
                    <Link
                      href="/kontakt"
                      className="inline-flex min-h-12 items-center justify-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-chalk/35"
                    >
                      Beratung dazu anfragen
                    </Link>
                    <button
                      type="button"
                      onClick={restart}
                      className="inline-flex min-h-12 items-center justify-center px-2 text-sm font-semibold text-chalk-dim transition-colors hover:text-chalk"
                    >
                      Von vorn beginnen
                    </button>
                  </div>

                  {alternatives.length > 0 && (
                    <div className="mt-8 border-t border-chalk/10 pt-6">
                      <p className="type-eyebrow text-chalk-faint">Ebenfalls möglich</p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {alternatives.map((alt) => (
                          <li key={alt.licenceClass.slug}>
                            <Link
                              href={`/fuehrerschein/${alt.licenceClass.slug}`}
                              className="inline-flex min-h-10 items-center rounded-lg border border-chalk/12 px-3.5 text-sm text-chalk-soft transition-colors hover:border-chalk/30 hover:text-chalk"
                            >
                              {alt.licenceClass.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-6 text-xs leading-relaxed text-chalk-faint">
                    Das ist eine Orientierung, keine rechtsverbindliche Auskunft. Was in deinem Fall gilt, klären wir
                    im Beratungsgespräch.
                  </p>
                </>
              ) : (
                <p className="text-chalk-soft">
                  Dazu können wir keine automatische Empfehlung geben —{' '}
                  <Link href="/kontakt" className="font-semibold text-signal-400 underline-offset-4 hover:underline">
                    frag uns direkt
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
