'use server'

import { headers } from 'next/headers'
import { contactSchema, type ContactInput, type ContactState } from '@/lib/contact-schema'

/**
 * Contact form server action.
 *
 * What this does today: validates strictly, rejects bots, rate-limits by IP,
 * and hands the request to a delivery function. What it deliberately does NOT
 * do is pretend to have succeeded — if no delivery transport is configured, the
 * visitor is told plainly to phone or e-mail instead. A fake success toast on a
 * contact form is how real enquiries get silently lost.
 *
 * To go live, set CONTACT_WEBHOOK_URL (any endpoint that accepts a JSON POST —
 * a mail relay, a CRM intake, a Zapier hook). See docs/security-review.md.
 */

/**
 * In-memory rate limiter. Adequate for a single instance; behind several
 * instances or on a serverless platform, move this to a shared store — it is
 * isolated here specifically so that swap is a one-function change.
 */
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 5
const attempts = new Map<string, number[]>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_PER_WINDOW) {
    attempts.set(key, recent)
    return true
  }

  recent.push(now)
  attempts.set(key, recent)

  // Opportunistic cleanup so the map cannot grow without bound.
  if (attempts.size > 5000) {
    for (const [k, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(k)
    }
  }

  return false
}

async function clientKey(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
}

async function deliver(input: ContactInput): Promise<boolean> {
  const endpoint = process.env.CONTACT_WEBHOOK_URL
  if (!endpoint) return false

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.CONTACT_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.CONTACT_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        topic: input.topic,
        location: input.location,
        message: input.message,
        receivedAt: new Date().toISOString(),
      }),
    })
    return response.ok
  } catch {
    // Never surface transport details to the browser.
    return false
  }
}

export async function submitContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const raw = Object.fromEntries(formData) as Record<string, string>
  const parsed = contactSchema.safeParse(raw)

  if (!parsed.success) {
    const fieldErrors: ContactState['fieldErrors'] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof ContactInput | undefined
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
    }
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors }
  }

  // Honeypot filled → silently accept so the bot does not learn anything,
  // but do not deliver.
  if (parsed.data.website) {
    return { status: 'success', message: 'Danke für deine Nachricht.' }
  }

  if (rateLimited(await clientKey())) {
    return {
      status: 'error',
      message: 'Es sind gerade sehr viele Anfragen von dieser Verbindung eingegangen. Bitte versuche es später noch einmal oder ruf uns an.',
    }
  }

  const delivered = await deliver(parsed.data)

  if (!delivered) {
    return {
      status: 'error',
      message:
        'Das Formular konnte deine Anfrage gerade nicht übermitteln. Bitte ruf uns an oder schreib direkt an info@fahrschule-krebs.de — wir melden uns dann umgehend.',
    }
  }

  return {
    status: 'success',
    message: 'Danke. Deine Anfrage ist angekommen — wir melden uns in der Regel innerhalb eines Werktags.',
  }
}
