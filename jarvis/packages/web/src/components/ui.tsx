import { type ReactNode, type ButtonHTMLAttributes, useEffect, useState } from 'react'
import type { RiskClass } from '@jarvis/shared'

/* Shared primitives. Kept deliberately small: one file, no component library,
   so the bundle stays tiny and the CSP can forbid remote anything. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cx('rounded-xl border border-white/6 bg-ink-850/70 backdrop-blur-sm shadow-lg shadow-black/20', className)}
    >
      {children}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
  size?: 'sm' | 'md'
}

export function Btn({ variant = 'subtle', size = 'md', className, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition ' +
    'disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent'
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' }
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-soft active:scale-[0.98]',
    ghost: 'text-mist-400 hover:text-mist-200 hover:bg-white/5',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
    subtle: 'bg-ink-700/70 text-mist-200 hover:bg-ink-600 border border-white/6',
  }
  return <button {...rest} className={cx(base, sizes[size], variants[variant], className)} />
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-white/6 text-mist-400 border-white/8',
    good: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
    warn: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
    bad: 'bg-rose-500/12 text-rose-300 border-rose-500/25',
    info: 'bg-indigo-500/12 text-indigo-300 border-indigo-500/25',
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>
      {children}
    </span>
  )
}

const RISK_LABEL: Record<RiskClass, { text: string; tone: 'good' | 'info' | 'warn' | 'bad' }> = {
  read_only: { text: 'Nur lesen', tone: 'good' },
  reversible_write: { text: 'Umkehrbar', tone: 'info' },
  external_comm: { text: 'Externe Kommunikation', tone: 'warn' },
  destructive: { text: 'Destruktiv', tone: 'bad' },
  financial_security: { text: 'Finanzen / Sicherheit', tone: 'bad' },
}

export function RiskBadge({ risk }: { risk: RiskClass }) {
  const r = RISK_LABEL[risk]
  return <Badge tone={r.tone}>{r.text}</Badge>
}

export function StatusDot({ status }: { status: 'ok' | 'degraded' | 'down' | 'not_configured' }) {
  const colors = {
    ok: 'bg-emerald-400', degraded: 'bg-amber-400',
    down: 'bg-rose-400', not_configured: 'bg-mist-400/50',
  }
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', colors[status])} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/8 px-6 py-12 text-center">
      <p className="text-sm text-mist-200">{title}</p>
      {hint && <p className="max-w-md text-xs text-mist-400">{hint}</p>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-mist-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-mist-400/70">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-white/8 bg-ink-900/70 px-3 py-2 text-sm text-mist-200 ' +
  'placeholder:text-mist-400/50 focus:border-accent/60 focus:outline-none'

export function Toast({ message, tone = 'info', onDone }: {
  message: string; tone?: 'info' | 'bad' | 'good'; onDone: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onDone, tone === 'bad' ? 7000 : 3500)
    return () => clearTimeout(t)
  }, [message, tone, onDone])
  const tones = {
    info: 'border-white/10 bg-ink-800', bad: 'border-rose-500/30 bg-rose-950/80',
    good: 'border-emerald-500/30 bg-emerald-950/70',
  }
  return (
    <div
      role="status"
      className={cx('fade-up fixed left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-xl',
        'bottom-[calc(5.5rem+var(--safe-b))] sm:bottom-6', tones[tone])}
    >
      {message}
    </div>
  )
}

/** Minimal markdown renderer: bold, inline code, bullets, headings, links. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split('\n')
  return (
    <div className="prose-jarvis space-y-1 text-sm">
      {blocks.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />
        const bullet = /^\s*[-•]\s+/.test(line)
        const heading = line.match(/^(#{1,3})\s+(.*)$/)
        const content = inline(bullet ? line.replace(/^\s*[-•]\s+/, '') : heading ? heading[2]! : line)
        if (heading) {
          return <p key={i} className="pt-1 text-sm font-semibold text-white">{content}</p>
        }
        return bullet
          ? <p key={i} className="flex gap-2 pl-1"><span className="text-accent-soft">•</span><span>{content}</span></p>
          : <p key={i}>{content}</p>
      })}
    </div>
  )
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const mm = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>)
    } else out.push(<a key={k++} href={t} target="_blank" rel="noreferrer noopener">{t}</a>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/** Small hook for load-once-and-refresh data views. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, reload: () => setNonce((n) => n + 1) }
}

export function relTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - Date.parse(iso)
  const abs = Math.abs(diff)
  const m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000)
  const unit = d >= 1 ? `${d} T` : h >= 1 ? `${h} Std` : m >= 1 ? `${m} Min` : 'gerade'
  if (unit === 'gerade') return 'gerade eben'
  return diff >= 0 ? `vor ${unit}` : `in ${unit}`
}
