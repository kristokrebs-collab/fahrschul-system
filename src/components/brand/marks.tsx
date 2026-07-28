/**
 * Krebs brand emblems.
 *
 * All marks are built from one geometric alphabet: the 24-unit square, the
 * 3-unit lane, the 45° chamfer and the interrupted marking stroke. They are
 * derived from road infrastructure rather than borrowed from an icon set, so
 * a competitor cannot swap the logo and reuse the page.
 *
 * Every mark is decorative by default (`aria-hidden`); meaning is carried by
 * the adjacent text. Pass a `title` only when a mark stands alone.
 */

interface MarkProps {
  className?: string
  title?: string
}

function markProps(title?: string) {
  return title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true, focusable: false } as const)
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Führerscheinklassen — a lane splitting into choices. */
export function MarkClasses({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <path d="M12 22V14" />
      <path d="M12 14C12 10 6 10 6 6V2" />
      <path d="M12 14c0-4 6-4 6-8V2" />
      <path d="M12 22v-1" strokeWidth={3} />
    </svg>
  )
}

/** Digitalpaket — connected nodes along one path. */
export function MarkDigital({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <path d="M3 18h4.5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3H21" />
      <circle cx="3" cy="18" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="21" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Simulator — a screen showing a road that runs to the horizon. */
export function MarkSimulator({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M9 18 11 9" />
      <path d="M15 18 13 9" />
      <path d="M12 15v-1.5M12 11.5V10" strokeWidth={1.2} />
      <path d="M8 22h8" />
    </svg>
  )
}

/** Preisvergleich — two stacked measures against a common axis. */
export function MarkPricing({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <path d="M3 4v16" />
      <path d="M6 8h13" />
      <path d="M6 14h8" />
      <path d="M19 8v-1.5M19 8v1.5" strokeWidth={1.2} />
      <path d="M14 14v-1.5M14 14v1.5" strokeWidth={1.2} />
    </svg>
  )
}

/** Ausbildungsweg — milestones on a route. */
export function MarkRoute({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <path d="M4 20c4 0 4-6 8-6s4-6 8-6" />
      <circle cx="4" cy="20" r="1.8" />
      <circle cx="12" cy="14" r="1.8" />
      <circle cx="20" cy="8" r="1.8" fill="currentColor" />
    </svg>
  )
}

/** Spezialausbildung — an adapted control, deliberately abstract. */
export function MarkSpecial({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v5" />
      <path d="M12 15.5v5" strokeWidth={1.2} />
      <path d="M4.6 8.2 9 10.5" />
      <path d="M19.4 8.2 15 10.5" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Beruf & Logistik — a load on a platform. */
export function MarkProfessional({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <path d="M2 17h12V7H2z" />
      <path d="M14 11h4.5L22 14.5V17h-8z" />
      <circle cx="6" cy="19.5" r="1.8" />
      <circle cx="18" cy="19.5" r="1.8" />
    </svg>
  )
}

/** Zweirad — the lean angle. */
export function MarkTwoWheel({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <circle cx="5" cy="17" r="3.2" />
      <circle cx="19" cy="17" r="3.2" />
      <path d="M5 17l4-7h5l3 7" />
      <path d="M9 10h5.5" />
      <path d="M13 6h3" />
    </svg>
  )
}

/** Bus — the long wheelbase. */
export function MarkBus({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M12 4v6" />
      <circle cx="7" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </svg>
  )
}

/** Seminare — a shared table, seen from above. */
export function MarkSeminar({ className, title }: MarkProps) {
  return (
    <svg {...base} className={className} {...markProps(title)}>
      <rect x="3" y="9" width="18" height="6" rx="2" />
      <circle cx="7" cy="5.5" r="1.6" />
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="17" cy="5.5" r="1.6" />
      <circle cx="9.5" cy="18.5" r="1.6" />
      <circle cx="14.5" cy="18.5" r="1.6" />
    </svg>
  )
}

/**
 * Wordmark. Text-based so it stays crisp, selectable and translatable; the
 * signal bar is the constant element that also appears as the chapter marker.
 */
export function KrebsWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-2 ${className ?? ''}`}>
      <span
        aria-hidden
        className="relative top-[-0.12em] inline-block h-[0.72em] w-[0.24em] shrink-0 bg-signal-500"
        style={{ boxShadow: '0 0 14px color-mix(in oklab, var(--color-signal-500) 75%, transparent)' }}
      />
      <span className="font-display font-extrabold tracking-[-0.03em]">
        KREBS
        <span className="ml-1.5 font-sans text-[0.42em] font-semibold uppercase tracking-[0.22em] text-chalk-dim">
          Fahrschule
        </span>
      </span>
    </span>
  )
}
