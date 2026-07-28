import type { CockpitStep, StepState } from '@/content/cockpit-demo'

/**
 * The cockpit interface itself — real HTML and CSS, not a screenshot, so it is
 * sharp at any density, selectable, translatable and readable by assistive
 * technology. Every state renders the same chrome so the device feels like one
 * product rather than six unrelated images.
 */

interface Props {
  stateId: string
  student: { greeting: string; classCode: string; trainingType: string; location: string; instructor: string }
  steps: readonly CockpitStep[]
  sonderfahrten: readonly { label: string; done: number; required: number }[]
  documents: readonly { label: string; state: StepState; detail: string }[]
  readiness: readonly { label: string; ok: boolean; missing?: string }[]
}

const STATE_TONE: Record<StepState, string> = {
  done: 'bg-state-done',
  active: 'bg-signal-500',
  open: 'bg-ink-600',
}

export function CockpitScreen({ stateId, student, steps, sonderfahrten, documents, readiness }: Props) {
  return (
    <div className="flex h-[34rem] flex-col bg-ink-900 text-chalk">
      <Chrome student={student} />

      <div className="no-scrollbar flex-1 overflow-hidden px-4 pb-4">
        {stateId === 'heute' && <Today steps={steps} student={student} />}
        {stateId === 'ausbildung' && <Journey steps={steps} />}
        {stateId === 'praxis' && <Feedback />}
        {stateId === 'sonderfahrten' && <Sonderfahrten items={sonderfahrten} />}
        {stateId === 'dokumente' && <Documents items={documents} />}
        {stateId === 'pruefungsready' && <Readiness items={readiness} />}
      </div>

      <p className="border-t border-chalk/8 px-4 py-2 text-center text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-chalk-faint">
        Demo-Ansicht mit Beispieldaten
      </p>
    </div>
  )
}

function Chrome({ student }: { student: Props['student'] }) {
  return (
    <div className="flex items-center justify-between px-4 pb-3 pt-9">
      <div>
        <p className="text-[0.6875rem] text-chalk-faint">Schüler-Cockpit</p>
        <p className="font-display text-lg font-bold leading-tight">{student.greeting}</p>
      </div>
      <span className="rounded-lg border border-signal-500/35 bg-signal-500/12 px-2.5 py-1 text-[0.6875rem] font-bold text-signal-400">
        Klasse {student.classCode} · {student.trainingType}
      </span>
    </div>
  )
}

function Today({ steps, student }: { steps: Props['steps']; student: Props['student'] }) {
  const done = steps.filter((s) => s.state === 'done').length
  const percent = Math.round((done / steps.length) * 100)

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[0.6875rem] text-chalk-faint">Ausbildungsfortschritt</p>
            <p className="tabular font-display text-3xl font-extrabold leading-none">{percent} %</p>
          </div>
          <p className="tabular text-[0.6875rem] text-chalk-dim">
            {done} von {steps.length} Stationen
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-750">
          <div className="h-full rounded-full bg-signal-500" style={{ width: `${percent}%` }} />
        </div>
      </Card>

      <Card>
        <p className="text-[0.6875rem] text-chalk-faint">Nächster Termin</p>
        <p className="mt-1 text-sm font-bold">Autobahnfahrt · 14:30 Uhr</p>
        <p className="mt-0.5 text-xs text-chalk-dim">
          {student.location} · {student.instructor}
        </p>
      </Card>

      <Card tone="signal">
        <p className="text-[0.6875rem] font-semibold text-signal-400">Deine nächste Aufgabe</p>
        <p className="mt-1 text-sm font-bold">Noch drei Sonderfahrten einplanen</p>
        <p className="mt-0.5 text-xs text-chalk-dim">Eine Autobahnfahrt und zwei Nachtfahrten fehlen.</p>
      </Card>
    </div>
  )
}

function Journey({ steps }: { steps: Props['steps'] }) {
  return (
    <ol className="relative space-y-0 pl-5">
      <span aria-hidden className="absolute bottom-2 left-[3px] top-2 w-px bg-ink-700" />
      {steps.map((step) => (
        <li key={step.id} className="relative py-[0.4375rem]">
          <span
            aria-hidden
            className={`absolute -left-5 top-[0.8125rem] h-[7px] w-[7px] rounded-full ring-4 ring-ink-900 ${STATE_TONE[step.state]}`}
          />
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-[0.8125rem] font-semibold ${step.state === 'open' ? 'text-chalk-dim' : 'text-chalk'}`}>
              {step.label}
            </p>
            <p className="shrink-0 text-[0.6875rem] text-chalk-faint">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Feedback() {
  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[0.6875rem] text-chalk-faint">Fahrstunde 24 · Überlandfahrt</p>
        <p className="mt-1 text-sm font-bold">Rückmeldung</p>
      </Card>

      <Card tone="done">
        <p className="text-[0.6875rem] font-semibold text-state-done">Das lief gut</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-chalk-soft">
          Spurführung in Kurven war sicher, Blick weit voraus, Geschwindigkeit sauber angepasst.
        </p>
      </Card>

      <Card tone="signal">
        <p className="text-[0.6875rem] font-semibold text-signal-400">Daran arbeiten wir</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-chalk-soft">
          Schulterblick beim Überholvorgang noch etwas früher — und den Blinker vor dem Ausscheren.
        </p>
      </Card>

      <Card>
        <p className="text-[0.6875rem] text-chalk-faint">Ziel der nächsten Stunde</p>
        <p className="mt-1 text-[0.8125rem] font-semibold">Auffahren und Einfädeln auf der Autobahn</p>
      </Card>
    </div>
  )
}

function Sonderfahrten({ items }: { items: Props['sonderfahrten'] }) {
  const done = items.reduce((n, i) => n + i.done, 0)
  const required = items.reduce((n, i) => n + i.required, 0)

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[0.6875rem] text-chalk-faint">Pflichtfahrten</p>
            <p className="tabular font-display text-3xl font-extrabold leading-none">
              {done}
              <span className="text-lg text-chalk-dim">/{required}</span>
            </p>
          </div>
          <p className="text-[0.6875rem] text-chalk-dim">à 45 Minuten</p>
        </div>
      </Card>

      {items.map((item) => (
        <Card key={item.label}>
          <div className="flex items-baseline justify-between">
            <p className="text-[0.8125rem] font-semibold">{item.label}</p>
            <p className="tabular text-[0.6875rem] font-bold text-chalk-dim">
              {item.done}/{item.required}
            </p>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: item.required }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < item.done ? 'bg-signal-500' : 'bg-ink-750'}`}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function Documents({ items }: { items: Props['documents'] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card key={item.label}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.8125rem] font-semibold">{item.label}</p>
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-chalk-dim">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATE_TONE[item.state]}`} />
              {item.detail}
            </span>
          </div>
        </Card>
      ))}
      <Card tone="done">
        <div className="flex items-center justify-between">
          <p className="text-[0.8125rem] font-semibold">Offene Rechnungen</p>
          <p className="text-[0.8125rem] font-bold text-state-done">keine</p>
        </div>
      </Card>
    </div>
  )
}

function Readiness({ items }: { items: Props['readiness'] }) {
  const open = items.filter((i) => !i.ok).length

  return (
    <div className="space-y-3">
      <Card tone={open === 0 ? 'done' : 'signal'}>
        <p className="text-[0.6875rem] text-chalk-faint">PrüfungsReady</p>
        <p className="mt-1 font-display text-xl font-extrabold leading-tight">
          {open === 0 ? 'Alle Bedingungen erfüllt' : `Noch ${open} Punkte offen`}
        </p>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-chalk-dim">
          Kein Prognosewert — die Freigabe erteilt deine Fahrlehrerin oder dein Fahrlehrer.
        </p>
      </Card>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5 rounded-lg bg-ink-850/70 px-3 py-2.5">
            <span
              aria-hidden
              className={`mt-1 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full ${
                item.ok ? 'bg-state-done' : 'border border-chalk/25'
              }`}
            >
              {item.ok && (
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="var(--color-ink-950)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5 5 9l4.5-5.5" />
                </svg>
              )}
            </span>
            <span className="min-w-0">
              <span className={`block text-[0.8125rem] ${item.ok ? 'text-chalk-soft' : 'font-semibold text-chalk'}`}>
                {item.label}
              </span>
              {item.missing && <span className="block text-[0.6875rem] text-signal-400">{item.missing}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Card({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'signal' | 'done' }) {
  const tones = {
    neutral: 'border-chalk/8 bg-ink-850/80',
    signal: 'border-signal-500/25 bg-signal-500/[0.08]',
    done: 'border-state-done/25 bg-state-done/[0.07]',
  }[tone]

  return <div className={`rounded-xl border p-3.5 ${tones}`}>{children}</div>
}
