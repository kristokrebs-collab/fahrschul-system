import Link from 'next/link'
import type { ReactNode } from 'react'
import { Roadway } from './roadway'

export interface Crumb {
  name: string
  href: string
}

/**
 * Shared page opening. Keeps every inner page inside the same route metaphor
 * as the homepage — the carriageway is present but dimmed, because these pages
 * are stops along the journey rather than its beginning.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  trail,
  actions,
}: {
  eyebrow: string
  title: ReactNode
  lead?: ReactNode
  trail?: readonly Crumb[]
  actions?: ReactNode
}) {
  return (
    <header className="relative isolate overflow-hidden pt-[calc(var(--header-h)+3.5rem)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-30">
        <Roadway className="absolute inset-x-0 bottom-0 h-full w-full" />
      </div>
      <div className="atmos-falloff" />

      <div className="shell relative pb-14">
        {trail && trail.length > 0 && (
          <nav aria-label="Brotkrumen" className="mb-8">
            <ol className="flex flex-wrap items-center gap-2 text-xs text-chalk-faint">
              {trail.map((crumb, index) => (
                <li key={crumb.href} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden>/</span>}
                  {index === trail.length - 1 ? (
                    <span aria-current="page" className="text-chalk-dim">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link href={crumb.href} className="transition-colors hover:text-chalk-soft">
                      {crumb.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <p className="kapitel-label">{eyebrow}</p>
        <h1 className="type-hero mt-5 max-w-[18ch] text-gradient-chalk">{title}</h1>
        {lead && <p className="type-lead mt-6 max-w-[56ch]">{lead}</p>}
        {actions && <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions}</div>}
      </div>
    </header>
  )
}
