/**
 * The Cockpit interface, rebuilt as crisp HTML from screenshots of the real
 * app prototype (docs/app-reference/). One tall screen — the scroll narrative
 * moves a viewport across it, exactly like scrolling the real app.
 *
 * Visual language of the original: near-black surface, red/rose accents, soft
 * cards, uppercase micro-labels (EBENE A, FAHRSTIL, PROTOKOLL), the FK block
 * with the red bar, chip row under the greeting, dot-scale skill ratings and
 * the red Prüfungsreife ring.
 *
 * `progress` (0..1) drives the counters and the ring so the app visibly fills
 * up while the page scrolls. All animated numbers derive from it — there is no
 * timer, so reduced-motion users simply see the final values.
 */

import { appIdentity, fahrstil, practice, protokoll, sonderfahrten, theory } from '@/content/cockpit-demo'

/** Eases a global progress value into a per-section 0..1 window. */
function window01(p: number, from: number, to: number): number {
  if (p <= from) return 0
  if (p >= to) return 1
  return (p - from) / (to - from)
}

export type CockpitSection = 'intro' | 'fortschritt' | 'fahrstil' | 'protokoll'

export function CockpitScreen({
  progress = 1,
  sections,
}: {
  progress?: number
  /** Render only these blocks — used by the stacked mobile narrative. */
  sections?: readonly CockpitSection[]
}) {
  // Windows are aligned to the narrative scenes (5 equal segments): the
  // counters fill while their scene is on screen, not before or after.
  const pTheory = window01(progress, 0.22, 0.34)
  const pSf = window01(progress, 0.24, 0.4)
  const pRing = window01(progress, 0.44, 0.58)
  const has = (s: CockpitSection) => !sections || sections.includes(s)

  return (
    <div className="w-full bg-[#0b0a10] font-sans text-chalk">
      {has('intro') && (<>
      {/* ── App header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 pb-4 pt-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#151320]">
            <span aria-hidden className="mr-1 inline-block h-4 w-[3px] rounded-full bg-[#ff2e63]" />
            <span className="font-display text-sm font-extrabold">FK</span>
          </span>
          <div className="leading-tight">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.22em]">{appIdentity.brand}</p>
            <p className="text-[0.55rem] uppercase tracking-[0.3em] text-chalk-dim">{appIdentity.appName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-[#151320]">
            <BellGlyph />
            <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#ff2e63]" />
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#151320] text-[0.65rem] font-bold">
            {appIdentity.initials}
          </span>
        </div>
      </header>

      {/* ── Greeting ───────────────────────────────────────────────── */}
      <section className="px-5 pb-5">
        <p className="text-[0.8rem] text-chalk-dim">{appIdentity.greetingSmall}</p>
        <p className="font-display text-[1.6rem] font-extrabold leading-tight">{appIdentity.greeting}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {appIdentity.chips.map((chip, i) => (
            <span
              key={chip}
              className={`rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold ${
                i === 0 ? 'border-[#ff2e63]/50 text-[#ff5d84]' : 'border-chalk/15 text-chalk-soft'
              }`}
            >
              {chip}
            </span>
          ))}
        </div>
      </section>
      </>)}

      {has('fortschritt') && (
      <section data-scene="fortschritt" className="px-5 pb-5 pt-2">
        <SectionLabel small="Ebene A" title="Ausbildungs-Fortschritt" />

        <div className="mt-3 rounded-2xl bg-[#12101a] p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[0.85rem] font-bold">{theory.title}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-chalk-dim">Ist / Soll</p>
          </div>
          <div className="mt-2 flex items-baseline justify-between text-[0.75rem]">
            <p className="text-chalk-dim">{theory.metric}</p>
            <p className="tabular font-bold">
              <span className="text-[#ff5d84]">{Math.round(theory.done * pTheory)}</span>
              <span className="text-chalk-dim"> / {theory.required}</span>
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#201d2c]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#a3001f] to-[#e11431]"
              style={{ width: `${(theory.done / theory.required) * 100 * pTheory}%` }}
            />
          </div>
        </div>

        <p className="mt-4 text-[0.6rem] font-bold uppercase tracking-[0.24em] text-chalk-dim">
          Gesetzliche Sonderfahrten
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {sonderfahrten.map((sf) => {
            const shown = Math.round(sf.done * pSf)
            return (
              <div key={sf.key} className="rounded-xl bg-[#12101a] px-2 py-3 text-center">
                <SfGlyph kind={sf.key} />
                <p className="tabular mt-1.5 text-[1.05rem] font-extrabold leading-none">
                  <span className={shown > 0 ? 'text-[#ff5d84]' : 'text-chalk-soft'}>{shown}</span>
                  <span className="text-[0.8rem] text-chalk-dim">/{sf.required}</span>
                </p>
                <p className="mt-1 text-[0.55rem] font-semibold uppercase tracking-widest text-chalk-dim">{sf.label}</p>
                <div className="mx-auto mt-1.5 h-0.5 w-3/4 overflow-hidden rounded-full bg-[#201d2c]">
                  <div className="h-full bg-[#b40922]" style={{ width: `${(sf.done / sf.required) * 100 * pSf}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#12101a] p-3.5">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-chalk-dim">Übungsstunden</p>
            <p className="tabular mt-1 font-display text-[1.5rem] font-extrabold leading-none">
              {Math.round(practice.hours * pSf)}
              <span className="ml-1 text-[0.8rem] font-bold text-chalk-dim">Std.</span>
            </p>
            <p className="mt-1 text-[0.62rem] leading-snug text-chalk-dim">{practice.hoursLabel}</p>
          </div>
          <div className="rounded-xl bg-[#12101a] p-3.5">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-chalk-dim">Simulator</p>
            <p className="tabular mt-1 font-display text-[1.5rem] font-extrabold leading-none">
              {Math.round(practice.simulatorDone * pSf)}
              <span className="text-[0.8rem] font-bold text-chalk-dim">/{practice.simulatorRequired}</span>
            </p>
            <p className="mt-1 text-[0.62rem] leading-snug text-chalk-dim">{practice.simulatorLabel}</p>
            <span className="mt-2 inline-block rounded-lg bg-[#1c1927] px-2.5 py-1.5 text-[0.62rem] font-bold">
              + {practice.simulatorCta}
            </span>
          </div>
        </div>
      </section>
      )}

      {has('fahrstil') && (
      <section data-scene="fahrstil" className="px-5 pb-5 pt-2">
        <SectionLabel small={fahrstil.section} title={fahrstil.title} right={fahrstil.cadence} />

        <div className="mt-3 rounded-2xl bg-[#12101a] p-4">
          <div className="flex items-center gap-4">
            <ReadinessRing value={Math.round(fahrstil.readiness * pRing)} label={fahrstil.readinessLabel} />
            <ul className="min-w-0 flex-1 space-y-2.5">
              {fahrstil.skills.map((skill) => (
                <li key={skill.label} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[0.7rem] font-semibold text-chalk-soft">{skill.label}</span>
                  <span className="flex shrink-0 gap-1" aria-label={`${skill.score} von 5`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i < Math.round(skill.score * pRing) ? 'bg-[#ff5d84]' : 'bg-[#252131]'
                        }`}
                      />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-2 flex items-center gap-2 rounded-xl border border-[#ff2e63]/25 bg-[#ff2e63]/[0.06] px-3 py-2.5 text-[0.7rem] font-semibold text-[#ff8aa5]">
          <TrendGlyph />
          {fahrstil.note}
        </p>
      </section>
      )}

      {has('protokoll') && (
      <section data-scene="protokoll" className="px-5 pb-6 pt-2">
        <SectionLabel small={protokoll.section} title={protokoll.title} right={protokoll.cadence} />

        <div className="mt-3 rounded-2xl bg-[#12101a] p-3">
          <div className="flex gap-1.5">
            {protokoll.tabs.map((tab, i) => (
              <span
                key={tab}
                className={`flex-1 rounded-lg py-2 text-center text-[0.68rem] font-bold ${
                  i === 0 ? 'bg-[#221f30] text-chalk' : 'text-chalk-dim'
                }`}
              >
                {tab}
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {protokoll.stats.map((stat) => (
              <span key={stat} className="tabular rounded-full bg-[#1a1725] px-2.5 py-1 text-[0.6rem] font-semibold text-[#ff8aa5]">
                {stat}
              </span>
            ))}
          </div>

          <ul className="mt-2 space-y-2">
            {protokoll.entries.map((entry) => (
              <li key={entry.kind + entry.date} className="rounded-xl bg-[#161322] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.78rem] font-bold">{entry.kind}</p>
                  <span className="tabular shrink-0 rounded-md bg-[#221f30] px-1.5 py-0.5 text-[0.6rem] font-bold text-chalk-soft">
                    {entry.duration}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.68rem] leading-snug text-chalk-dim">{entry.detail}</p>
                <p className="tabular mt-1.5 text-[0.62rem] text-chalk-faint">
                  {entry.date} · {entry.time} · {entry.instructor}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 pb-1 text-center text-[0.55rem] font-bold uppercase tracking-[0.2em] text-chalk-faint">
          Demo-Ansicht mit Beispieldaten
        </p>
      </section>
      )}
    </div>
  )
}

function SectionLabel({ small, title, right }: { small: string; title: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div>
        <p className="text-[0.58rem] font-bold uppercase tracking-[0.26em] text-[#ff5d84]">{small}</p>
        <p className="mt-0.5 font-display text-[1.05rem] font-extrabold leading-tight">{title}</p>
      </div>
      {right && <p className="shrink-0 text-[0.6rem] text-chalk-dim">{right}</p>}
    </div>
  )
}

/** The red Prüfungsreife ring — conic sweep driven by the scroll progress. */
function ReadinessRing({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(from 220deg, #b40922 0deg, #e11431 ${value * 3.05}deg, #241f2e ${value * 3.05}deg)`,
      }}
      role="img"
      aria-label={`${label}: ${value} Prozent — Bewertung des Fahrlehrers`}
    >
      <div className="grid h-[4.7rem] w-[4.7rem] place-items-center rounded-full bg-[#12101a] text-center">
        <div>
          <p className="tabular font-display text-[1.35rem] font-extrabold leading-none">
            {value}
            <span className="text-[0.7rem]">%</span>
          </p>
          <p className="mt-0.5 text-[0.42rem] font-bold uppercase tracking-[0.18em] text-chalk-dim">{label}</p>
        </div>
      </div>
    </div>
  )
}

function BellGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

function TrendGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  )
}

function SfGlyph({ kind }: { kind: string }) {
  const paths: Record<string, React.ReactElement> = {
    ueberland: <path d="m3 18 5-8 4 5 3-4 6 7" />,
    autobahn: <><path d="M5 20 9 4M19 20 15 4" /><path d="M12 7v2M12 12v2M12 17v2" strokeWidth={1.6} /></>,
    nacht: <path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9Z" />,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff5d84" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mx-auto">
      {paths[kind]}
    </svg>
  )
}
