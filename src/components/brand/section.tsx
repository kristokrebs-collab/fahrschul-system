import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Chapter framing.
 *
 * Every chapter of the route is introduced the same way — a kilometre marker,
 * a heading and a lead. Consistency here is what makes the page feel like one
 * journey rather than a stack of unrelated sections.
 */
export function ChapterHeading({
  marker,
  title,
  lead,
  id,
  align = 'left',
}: {
  marker: string
  title: ReactNode
  lead?: ReactNode
  id?: string
  align?: 'left' | 'center'
}) {
  return (
    <header className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <p className={`kapitel-label ${align === 'center' ? 'justify-center' : ''}`}>{marker}</p>
      <h2 id={id} className="type-chapter mt-5 text-gradient-chalk">
        {title}
      </h2>
      {lead && <p className="type-lead mt-5">{lead}</p>}
    </header>
  )
}

export function ActionLink({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet'
  className?: string
}) {
  const styles = {
    primary:
      'bg-signal-500 text-chalk hover:bg-signal-600 shadow-[0_14px_40px_-16px_color-mix(in_oklab,var(--color-signal-500)_70%,transparent)]',
    secondary: 'border border-chalk/18 bg-chalk/[0.04] text-chalk hover:border-chalk/35 hover:bg-chalk/[0.08]',
    quiet: 'text-signal-400 hover:text-signal-500',
  }[variant]

  return (
    <Link
      href={href}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-colors ${styles} ${className}`}
    >
      {children}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </Link>
  )
}

/** A note that carries an honest caveat without shouting. */
export function Disclosure({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 flex gap-2.5 rounded-xl border border-chalk/10 bg-chalk/[0.03] p-4 text-xs leading-relaxed text-chalk-dim">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mt-0.5 shrink-0 text-chalk-faint" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  )
}
