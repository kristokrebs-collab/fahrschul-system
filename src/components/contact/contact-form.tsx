'use client'

import { useActionState } from 'react'
import { submitContact } from '@/app/kontakt/actions'
import { LOCATION_CHOICES, TOPICS, type ContactState } from '@/lib/contact-schema'

const initial: ContactState = { status: 'idle' }

/**
 * Contact form.
 *
 * Progressive by construction: it is a real <form> posting to a server action,
 * so it works before hydration and without client JavaScript. Errors come back
 * from the server, are tied to their inputs with aria-describedby, and are
 * announced through a live region.
 */
export type RequestContext = {
  /** Slug of the class or service the visitor was reading. */
  reference: string
  /** Path they came from. */
  source: string
  /** Human-readable name of the reference, when one was recognised. */
  label?: string
  topic: string
  location: string
}

export function ContactForm({ context }: { context: RequestContext }) {
  const [state, action, pending] = useActionState(submitContact, initial)

  if (state.status === 'success') {
    return (
      <div className="surface border-state-done/30 bg-state-done/[0.06] p-8" role="status">
        <h2 className="font-display text-xl font-bold text-chalk">Nachricht gesendet</h2>
        <p className="mt-3 text-sm leading-relaxed text-chalk-soft">{state.message}</p>
      </div>
    )
  }

  return (
    <form action={action} noValidate className="surface p-6 sm:p-8">
      {/* What the visitor was reading when they pressed the button, carried
          in from the link and sent along with the request so nobody has to
          retype "Ich interessiere mich für Klasse B". */}
      <input type="hidden" name="reference" value={context.reference} />
      <input type="hidden" name="source" value={context.source} />
      {context.label && (
        <p className="mb-6 flex flex-wrap items-baseline gap-x-2 rounded-xl border border-signal-500/25 bg-signal-500/[0.06] px-4 py-3 text-sm">
          <span className="text-chalk-dim">Deine Anfrage bezieht sich auf</span>
          <strong className="font-semibold text-chalk">{context.label}</strong>
        </p>
      )}

      {/* One element that is both seen and announced. A separate visually
          hidden live region would duplicate the message for screen-reader
          users and read it twice. */}
      {state.status === 'error' && state.message && (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-signal-500/30 bg-signal-500/[0.08] p-4 text-sm text-signal-400"
        >
          {state.message}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" error={state.fieldErrors?.name} required>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-invalid={!!state.fieldErrors?.name}
            aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
            className={inputClass(!!state.fieldErrors?.name)}
          />
        </Field>

        <Field id="email" label="E-Mail" error={state.fieldErrors?.email} required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={!!state.fieldErrors?.email}
            aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
            className={inputClass(!!state.fieldErrors?.email)}
          />
        </Field>

        <Field id="phone" label="Telefon" hint="Optional — oft geht ein Rückruf schneller." error={state.fieldErrors?.phone}>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={!!state.fieldErrors?.phone}
            aria-describedby={state.fieldErrors?.phone ? 'phone-error' : 'phone-hint'}
            className={inputClass(!!state.fieldErrors?.phone)}
          />
        </Field>

        <Field id="location" label="Standort" error={state.fieldErrors?.location} required>
          <select id="location" name="location" required defaultValue={context.location} className={inputClass(!!state.fieldErrors?.location)}>
            {LOCATION_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field id="topic" label="Worum geht es?" error={state.fieldErrors?.topic} required>
            <select id="topic" name="topic" required defaultValue={context.topic} className={inputClass(!!state.fieldErrors?.topic)}>
              {TOPICS.map((topic) => (
                <option key={topic.value} value={topic.value}>
                  {topic.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field id="message" label="Deine Nachricht" error={state.fieldErrors?.message} required>
            <textarea
              id="message"
              name="message"
              rows={6}
              required
              aria-invalid={!!state.fieldErrors?.message}
              aria-describedby={state.fieldErrors?.message ? 'message-error' : undefined}
              placeholder="Zum Beispiel: welche Klasse dich interessiert, ab wann du starten möchtest, oder was du noch nicht verstanden hast."
              className={`${inputClass(!!state.fieldErrors?.message)} resize-y`}
            />
          </Field>
        </div>
      </div>

      {/* Honeypot: off-screen, not hidden, so bots that check computed styles still fill it. */}
      <div aria-hidden className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website (bitte frei lassen)</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-6">
        <label className="flex gap-3 text-sm leading-relaxed text-chalk-dim">
          <input
            type="checkbox"
            name="consent"
            required
            className="mt-1 h-4.5 w-4.5 shrink-0 accent-signal-500"
            aria-describedby={state.fieldErrors?.consent ? 'consent-error' : undefined}
          />
          <span>
            Ich bin damit einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden. Die
            Einwilligung kann ich jederzeit widerrufen.
          </span>
        </label>
        {state.fieldErrors?.consent && (
          <p id="consent-error" className="mt-2 text-sm text-signal-400">
            {state.fieldErrors.consent}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-7 inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-signal-500 px-8 text-base font-semibold text-chalk transition-colors hover:bg-signal-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Wird gesendet …' : 'Anfrage senden'}
      </button>

      <p className="mt-4 text-xs leading-relaxed text-chalk-faint">
        Wir nutzen deine Angaben ausschließlich, um deine Anfrage zu beantworten. Mehr dazu in der{' '}
        <a href="/datenschutz" className="underline underline-offset-2 hover:text-chalk-dim">
          Datenschutzerklärung
        </a>
        .
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-chalk">
        {label}
        {required && (
          <span className="ml-1 text-signal-400" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-chalk-faint">
          {hint}
        </p>
      )}
      <div className="mt-2">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm text-signal-400">
          {error}
        </p>
      )}
    </div>
  )
}

function inputClass(hasError: boolean): string {
  return `w-full min-h-12 rounded-xl border bg-ink-950/60 px-4 py-3 text-[0.9375rem] text-chalk placeholder:text-chalk-faint focus:outline-none focus:ring-2 focus:ring-signal-400/60 ${
    hasError ? 'border-signal-500/60' : 'border-chalk/12 focus:border-signal-500/50'
  }`
}
