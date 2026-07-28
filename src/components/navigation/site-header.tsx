'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { navigation, type NavSection } from '@/content/navigation'
import { locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { KrebsWordmark } from '@/components/brand/marks'

/**
 * Site header.
 *
 * Navigation is a disclosure pattern, not a hover menu: panels open on click
 * and on Enter/Space, close on Escape and on outside click, and return focus
 * to their trigger. Hover merely previews on fine pointers — nothing is
 * reachable by hover alone.
 */
export function SiteHeader() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  const navRef = useRef<HTMLDivElement>(null)

  // A route change closes everything, otherwise a panel survives navigation.
  // Adjusting state during render rather than in an effect is React's
  // sanctioned pattern for "reset when a value changes": it re-renders
  // immediately without committing the intermediate state, so there is no
  // extra paint and no cascading effect.
  const [routeAtOpen, setRouteAtOpen] = useState(pathname)
  if (pathname !== routeAtOpen) {
    setRouteAtOpen(pathname)
    setOpenId(null)
    setMobileOpen(false)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!openId && !mobileOpen) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenId(null)
        setMobileOpen(false)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenId(null)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [openId, mobileOpen])

  // The mobile panel is a full-screen overlay; the page behind it must not scroll.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const toggle = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id))
  }, [])

  const fulda = locations[0]!
  const phone = publicValue(fulda.phone)
  const phoneHref = publicValue(fulda.phoneHref)

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          scrolled || openId || mobileOpen
            ? 'border-b border-chalk/8 bg-ink-950/92 backdrop-blur-xl'
            : 'border-b border-transparent'
        }`}
      >
        <div ref={navRef} className="shell flex h-[var(--header-h)] items-center gap-4">
        <Link
          href="/"
          className="shrink-0 text-lg text-chalk transition-opacity hover:opacity-80"
          aria-label="Fahrschule Krebs — zur Startseite"
        >
          <KrebsWordmark />
        </Link>

        <nav aria-label="Hauptnavigation" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {navigation.map((section) => (
              <DesktopSection
                key={section.id}
                section={section}
                open={openId === section.id}
                onToggle={() => toggle(section.id)}
                onClose={() => setOpenId(null)}
              />
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {phone && phoneHref && (
            <a
              href={`tel:${phoneHref}`}
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-chalk-soft transition-colors hover:text-chalk xs:inline-block"
            >
              {phone}
            </a>
          )}
          <Link
            href="/kontakt"
            className="hidden rounded-lg bg-signal-500 px-4 py-2.5 text-sm font-semibold text-chalk transition-colors hover:bg-signal-600 sm:inline-block"
          >
            Beratung starten
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="grid h-11 w-11 place-items-center rounded-lg border border-chalk/10 text-chalk lg:hidden"
          >
            <span className="sr-only">{mobileOpen ? 'Menü schließen' : 'Menü öffnen'}</span>
            <MenuGlyph open={mobileOpen} />
          </button>
        </div>
      </div>

      </header>

      {/*
        The mobile panel is a sibling of the header, not a child, and that is
        deliberate. When the header is scrolled or open it carries a
        backdrop-filter, and backdrop-filter makes an element the containing
        block for position:fixed descendants — which would size this panel to
        the 72px-tall header and drop it behind the page content, leaving every
        link in it unclickable.
      */}
      {mobileOpen && <MobileNav id="mobile-nav" onClose={() => setMobileOpen(false)} />}
    </>
  )
}

function DesktopSection({
  section,
  open,
  onToggle,
  onClose,
}: {
  section: NavSection
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const panelId = useId()

  if (!section.columns) {
    return (
      <li>
        <Link href={section.href} className="rounded-lg px-3 py-2 text-sm font-medium text-chalk-soft hover:text-chalk">
          {section.label}
        </Link>
      </li>
    )
  }

  return (
    <li className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          open ? 'text-chalk' : 'text-chalk-soft hover:text-chalk'
        }`}
      >
        {section.label}
        <Chevron open={open} />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute left-1/2 top-[calc(100%+0.75rem)] w-[min(58rem,90vw)] -translate-x-1/2 rounded-2xl border border-chalk/10 bg-ink-900/98 p-6 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <div className="grid gap-6 md:grid-cols-[1fr_1fr_1fr_minmax(0,15rem)]">
            {section.columns.map((column) => (
              <div key={column.title}>
                <p className="type-eyebrow mb-3 text-signal-400">{column.title}</p>
                <ul className="space-y-0.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-chalk/5"
                      >
                        <span className="block text-sm font-semibold text-chalk">{link.label}</span>
                        {link.hint && <span className="block text-xs text-chalk-dim">{link.hint}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {section.feature && (
              <div className="rounded-xl border border-signal-500/25 bg-signal-500/[0.07] p-4">
                <p className="font-display text-base font-bold leading-tight text-chalk">{section.feature.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-chalk-dim">{section.feature.body}</p>
                <Link
                  href={section.feature.href}
                  onClick={onClose}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-signal-400 hover:text-signal-500"
                >
                  {section.feature.cta}
                  <Arrow />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function MobileNav({ id, onClose }: { id: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(navigation[0]?.id ?? null)
  const fulda = locations[0]!
  const phoneHref = publicValue(fulda.phoneHref)
  const phone = publicValue(fulda.phone)

  return (
    <div
      id={id}
      className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-40 overflow-y-auto overscroll-contain bg-ink-950 lg:hidden"
    >
      <div className="shell py-6">
        <nav aria-label="Hauptnavigation mobil">
          <ul className="space-y-2">
            {navigation.map((section) => {
              const open = expanded === section.id
              return (
                <li key={section.id} className="border-b border-chalk/8 pb-2">
                  {section.columns ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : section.id)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between py-3 text-left"
                      >
                        <span className="font-display text-xl font-bold text-chalk">{section.label}</span>
                        <Chevron open={open} />
                      </button>
                      {open && (
                        <div className="space-y-5 pb-4">
                          {section.columns.map((column) => (
                            <div key={column.title}>
                              <p className="type-eyebrow mb-2 text-signal-400">{column.title}</p>
                              <ul className="grid gap-1">
                                {column.links.map((link) => (
                                  <li key={link.href}>
                                    <Link
                                      href={link.href}
                                      onClick={onClose}
                                      className="flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-medium text-chalk-soft"
                                    >
                                      {link.label}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <Link
                      href={section.href}
                      onClick={onClose}
                      className="block py-3 font-display text-xl font-bold text-chalk"
                    >
                      {section.label}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mt-8 grid gap-3">
          <Link
            href="/kontakt"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center rounded-xl bg-signal-500 px-5 font-semibold text-chalk"
          >
            Beratung starten
          </Link>
          {phone && phoneHref && (
            <a
              href={`tel:${phoneHref}`}
              className="flex min-h-12 items-center justify-center rounded-xl border border-chalk/15 px-5 font-semibold text-chalk"
            >
              {phone} anrufen
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      ) : (
        <>
          <path d="M3 7h18" />
          <path d="M3 12h18" />
          <path d="M3 17h12" />
        </>
      )}
    </svg>
  )
}
