import { useCallback, useEffect, useState } from 'react'
import type { SessionUser } from '@jarvis/shared'
import { api, ApiError } from './api'
import { Btn, Card, Field, Spinner, Toast, cx, inputCls } from './components/ui'
import { ChatView } from './views/Chat'
import { SourcesView, SearchView, GraphView } from './views/Knowledge'
import { MemoryView, ProjectsView, ApprovalsView } from './views/Workspace'
import { SystemView, LearningView } from './views/SystemViews'

type Tab = 'chat' | 'search' | 'sources' | 'projects' | 'memory' | 'approvals' | 'graph' | 'system' | 'learning'

const TABS: Array<{ id: Tab; label: string; icon: string; primary?: boolean }> = [
  { id: 'chat', label: 'Chat', icon: 'M4 5h16v10H8l-4 4V5z', primary: true },
  { id: 'projects', label: 'Tag', icon: 'M4 4h16v4H4zM4 10h10v10H4zM16 10h4v10h-4z', primary: true },
  { id: 'approvals', label: 'Freigaben', icon: 'M5 12l4 4L19 6', primary: true },
  { id: 'memory', label: 'Gedächtnis', icon: 'M12 3a5 5 0 015 5v1a4 4 0 01-1 8H8a4 4 0 01-1-8V8a5 5 0 015-5z', primary: true },
  { id: 'search', label: 'Suche', icon: 'M11 4a7 7 0 105.2 11.7L21 21' },
  { id: 'sources', label: 'Quellen', icon: 'M5 4h11l3 3v13H5z' },
  { id: 'graph', label: 'Karte', icon: 'M6 6h3v3H6zM15 6h3v3h-3zM10 15h3v3h-3zM9 7h6M8 9l3 6M16 9l-3 6' },
  { id: 'learning', label: 'Lernen', icon: 'M4 18V9m5 9V5m5 13v-6m5 6V7' },
  { id: 'system', label: 'System', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3' },
]

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [booting, setBooting] = useState(true)
  const [tab, setTab] = useState<Tab>('chat')
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'bad' | 'good' } | null>(null)

  const notify = useCallback((message: string, tone: 'info' | 'bad' | 'good' = 'info') => {
    setToast({ message, tone })
  }, [])

  useEffect(() => {
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false))
  }, [])

  // A 401 anywhere means the session ended; bounce to the login screen rather
  // than leaving a half-working UI behind.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError && e.reason.status === 401) setUser(null)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  if (booting) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-6 w-6 text-mist-400" />
      </div>
    )
  }

  if (!user) return <Login onLogin={setUser} notify={notify} toast={toast} clearToast={() => setToast(null)} />

  const primary = TABS.filter((t) => t.primary)
  const secondary = TABS.filter((t) => !t.primary)

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Desktop / tablet sidebar */}
      <nav className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-white/6 bg-ink-900/50 p-3 sm:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <Logo />
          <span className="text-sm font-semibold tracking-tight text-white">JARVIS</span>
        </div>
        {TABS.map((t) => (
          <NavItem key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
        ))}
        <div className="mt-auto space-y-1 border-t border-white/6 pt-3">
          <p className="px-2 text-[11px] text-mist-400">
            {user.username} · {user.role === 'owner' ? 'Besitzer' : 'Gast'}
          </p>
          <Btn size="sm" variant="ghost" className="w-full justify-start"
            onClick={() => void api.logout().then(() => setUser(null))}>Abmelden</Btn>
        </div>
      </nav>

      {/* Mobile header for the secondary tabs */}
      <header className="flex items-center gap-2 border-b border-white/6 px-3 py-2 sm:hidden">
        <Logo />
        <span className="text-sm font-semibold text-white">JARVIS</span>
        <select
          value={secondary.some((s) => s.id === tab) ? tab : ''}
          onChange={(e) => e.target.value && setTab(e.target.value as Tab)}
          className="ml-auto rounded-lg border border-white/8 bg-ink-800 px-2 py-1 text-xs text-mist-200"
        >
          <option value="">Mehr …</option>
          {secondary.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Btn size="sm" variant="ghost" onClick={() => void api.logout().then(() => setUser(null))}>Aus</Btn>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+var(--safe-b))] sm:pb-0">
        {tab === 'chat' && <ChatView notify={notify} />}
        {tab === 'search' && <SearchView notify={notify} />}
        {tab === 'sources' && <SourcesView notify={notify} />}
        {tab === 'projects' && <ProjectsView notify={notify} />}
        {tab === 'memory' && <MemoryView notify={notify} />}
        {tab === 'approvals' && <ApprovalsView notify={notify} />}
        {tab === 'graph' && <GraphView notify={notify} />}
        {tab === 'system' && <SystemView notify={notify} />}
        {tab === 'learning' && <LearningView notify={notify} />}
      </main>

      {/* Mobile bottom bar: the four things you reach for daily */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-white/8 bg-ink-900/95 pb-[var(--safe-b)] backdrop-blur sm:hidden">
        {primary.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition',
              tab === t.id ? 'text-accent-soft' : 'text-mist-400')}>
            <Icon d={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  )
}

function NavItem({ tab, active, onClick }: { tab: typeof TABS[number]; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
        active ? 'bg-accent/15 text-white' : 'text-mist-400 hover:bg-white/5 hover:text-mist-200')}>
      <Icon d={tab.icon} />
      {tab.label}
    </button>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#6366f1" strokeWidth="8" />
      <circle cx="50" cy="50" r="14" fill="#6366f1" />
    </svg>
  )
}

/* ── Login ───────────────────────────────────────────────────────────────── */

function Login({ onLogin, notify, toast, clearToast }: {
  onLogin: (u: SessionUser) => void
  notify: (m: string, t?: 'info' | 'bad' | 'good') => void
  toast: { message: string; tone: 'info' | 'bad' | 'good' } | null
  clearToast: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.login(username, password, totp || undefined)
      onLogin(r.user)
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { needs_totp?: boolean } | undefined) : undefined
      if (body?.needs_totp) {
        setNeedsTotp(true)
        notify('Bitte den Code aus deiner Authenticator-App eingeben.', 'info')
      } else {
        notify(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen', 'bad')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="grid h-full place-items-center p-4">
      <Card className="w-full max-w-sm px-6 py-7">
        <div className="mb-5 flex items-center gap-2">
          <Logo />
          <h1 className="text-lg font-semibold tracking-tight text-white">JARVIS</h1>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Benutzername">
            <input className={inputCls} value={username} autoComplete="username" autoFocus
              onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Passwort">
            <input className={inputCls} type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {needsTotp && (
            <Field label="Code (2FA)" hint="Sechsstelliger Code aus der Authenticator-App">
              <input className={inputCls} value={totp} inputMode="numeric" autoComplete="one-time-code"
                onChange={(e) => setTotp(e.target.value)} />
            </Field>
          )}
          <Btn variant="primary" className="w-full" disabled={busy || !username || !password}>
            {busy && <Spinner />} Anmelden
          </Btn>
        </form>
        <p className="mt-4 text-[11px] leading-relaxed text-mist-400">
          Noch kein Konto? Lege eines auf dem Server an:
          <code className="mt-1 block rounded bg-ink-900 px-2 py-1">npm run jarvis -- user:create name passwort</code>
        </p>
      </Card>
      {toast && <Toast message={toast.message} tone={toast.tone} onDone={clearToast} />}
    </div>
  )
}
