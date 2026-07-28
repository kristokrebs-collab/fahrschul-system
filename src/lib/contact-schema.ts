import { z } from 'zod'

/**
 * Contact request validation.
 *
 * Shared by the client (for immediate feedback) and the server action (which is
 * the only validation that actually counts — the client copy is a convenience,
 * never a control).
 */

export const TOPICS = [
  { value: 'fuehrerschein', label: 'Führerschein — private Ausbildung' },
  { value: 'beruf', label: 'Beruf — LKW, Bus, Berufskraftfahrer' },
  { value: 'seminar', label: 'Seminar — ASF, FES, ADR, Stapler' },
  { value: 'handicap', label: 'Ausbildung mit Handicap' },
  { value: 'firma', label: 'Anfrage für ein Unternehmen' },
  { value: 'sonstiges', label: 'Etwas anderes' },
] as const

export const LOCATION_CHOICES = [
  { value: 'fulda', label: 'Fulda' },
  { value: 'bad-hersfeld', label: 'Bad Hersfeld' },
  { value: 'egal', label: 'Noch offen' },
] as const

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Bitte gib deinen Namen an.')
    .max(120, 'Der Name ist zu lang.'),
  email: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine E-Mail-Adresse an.')
    .max(200, 'Die E-Mail-Adresse ist zu lang.')
    .email('Diese E-Mail-Adresse sieht nicht gültig aus.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Die Telefonnummer ist zu lang.')
    .regex(/^[0-9+()/\s.-]*$/, 'Bitte gib eine gültige Telefonnummer an.')
    .optional()
    .or(z.literal('')),
  topic: z.enum(TOPICS.map((t) => t.value) as [string, ...string[]], {
    message: 'Bitte wähle ein Thema.',
  }),
  location: z.enum(LOCATION_CHOICES.map((l) => l.value) as [string, ...string[]], {
    message: 'Bitte wähle einen Standort.',
  }),
  message: z
    .string()
    .trim()
    .min(10, 'Bitte beschreibe dein Anliegen in mindestens zehn Zeichen.')
    .max(4000, 'Die Nachricht ist zu lang.'),
  consent: z.literal('on', { message: 'Ohne deine Einwilligung dürfen wir die Anfrage nicht verarbeiten.' }),
  /**
   * Honeypot. Real users never see this field, so anything in it is a bot.
   * Named innocuously because scrapers look for "honeypot".
   */
  website: z.string().max(0).optional().or(z.literal('')),
})

export type ContactInput = z.infer<typeof contactSchema>

export interface ContactState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Partial<Record<keyof ContactInput, string>>
}
