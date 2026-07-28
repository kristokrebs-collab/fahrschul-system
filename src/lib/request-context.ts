import { classBySlug } from '@/content/classes'
import { serviceBySlug } from '@/content/services'
import { LOCATION_CHOICES, TOPICS } from '@/lib/contact-schema'
import type { RequestContext } from '@/components/contact/contact-form'

/**
 * Turns the query string a call-to-action carried in into a prefilled contact
 * request.
 *
 * Every CTA on the site links to /kontakt with `?bezug=<slug>&von=<path>`.
 * Here that becomes: the topic preselected, the location preselected where the
 * link named one, and the class or service echoed back to the visitor.
 *
 * Everything is validated against the real catalogue rather than trusted, so a
 * hand-edited URL can neither preselect something that does not exist nor put
 * arbitrary text on the page.
 */

const TOPIC_VALUES: ReadonlySet<string> = new Set<string>(TOPICS.map((t) => t.value))
const LOCATION_VALUES: ReadonlySet<string> = new Set<string>(LOCATION_CHOICES.map((l) => l.value))

/** Which enquiry topic a service belongs to, so the form opens on the right one. */
const GROUP_TOPIC: Record<string, string> = {
  beruf: 'beruf',
  logistik: 'seminar',
  seminare: 'seminar',
  spezial: 'sonstiges',
}

export function resolveRequestContext(params: Record<string, string | string[] | undefined>): RequestContext {
  const one = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  const rawReference = one('bezug')
  const reference = /^[a-z0-9-]{1,80}$/i.test(rawReference) ? rawReference : ''
  const rawSource = one('von')
  const source = /^\/[a-z0-9/-]{0,119}$/i.test(rawSource) ? rawSource : ''

  const licence = reference ? classBySlug(reference) : undefined
  const service = reference ? serviceBySlug(reference) : undefined

  const requestedTopic = one('thema')
  const topic = TOPIC_VALUES.has(requestedTopic)
    ? requestedTopic
    : licence
      ? licence.category === 'lkw' || licence.category === 'bus'
        ? 'beruf'
        : 'fuehrerschein'
      : service
        ? (GROUP_TOPIC[service.group] ?? 'sonstiges')
        : 'fuehrerschein'

  const requestedLocation = one('standort')
  const location = LOCATION_VALUES.has(requestedLocation) ? requestedLocation : 'egal'

  return {
    reference: licence || service ? reference : '',
    source,
    label: licence?.name ?? service?.name,
    topic,
    location,
  }
}
