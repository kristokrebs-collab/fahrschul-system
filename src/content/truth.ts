/**
 * Truth primitive.
 *
 * Every public business fact on this website carries its source, the date it
 * was reviewed and a confidence level. Facts that are not at least `likely`
 * are structurally prevented from being rendered: `publicValue()` returns
 * `undefined` for them, and the components treat `undefined` as "do not show".
 *
 * This exists so that nobody can accidentally publish an attractive number
 * that nobody has confirmed. See docs/business-truth.md and
 * docs/business-confirmations-needed.md.
 */

export type Confidence = 'confirmed' | 'likely' | 'unverified' | 'conflicting'

export interface Fact<T> {
  readonly value: T
  /** Where the value came from — a URL, a document name, or an internal system. */
  readonly source: string
  /** ISO date the value was last checked. */
  readonly reviewed: string
  readonly confidence: Confidence
  /** Why it is uncertain, what conflicts, or what needs owner confirmation. */
  readonly note?: string
}

export function fact<T>(
  value: T,
  source: string,
  reviewed: string,
  confidence: Confidence,
  note?: string,
): Fact<T> {
  return { value, source, reviewed, confidence, note }
}

/** Confidence levels that may appear in public, customer-facing output. */
const PUBLISHABLE: readonly Confidence[] = ['confirmed', 'likely']

/**
 * `null` is meaningful in the content model — it marks a field that does not
 * apply to this entry at all (a class with no Sonderfahrten, a service with no
 * fixed format) as opposed to one whose value we simply do not trust. Both
 * cases render the same way, so both are accepted here.
 */
export function isPublishable<T>(f: Fact<T> | null | undefined): f is Fact<T> {
  return f != null && PUBLISHABLE.includes(f.confidence)
}

/**
 * The only sanctioned way to read a fact for rendering.
 * Returns `undefined` when the fact must not be published.
 */
export function publicValue<T>(f: Fact<T> | null | undefined): T | undefined {
  return isPublishable(f) ? f.value : undefined
}

/** All facts that are being withheld — used to generate the open-questions doc. */
export function withheld(facts: Record<string, Fact<unknown>>): Array<[string, Fact<unknown>]> {
  return Object.entries(facts).filter(([, f]) => !isPublishable(f))
}
