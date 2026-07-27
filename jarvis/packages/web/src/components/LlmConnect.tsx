import { useState } from 'react'
import { api, type LlmInfo } from '../api'
import { Badge, Btn, Card, Field, Spinner, StatusDot, cx, inputCls, useAsync } from './ui'

type Notify = (m: string, t?: 'info' | 'bad' | 'good') => void

/**
 * Connect Claude as the reasoning engine.
 *
 * The key is validated against the real API before it is stored, and stored
 * AES-256-GCM encrypted. It is never read back: the panel shows only a masked
 * hint. Without a master key we refuse to store it at all rather than putting a
 * credential on disk in cleartext.
 */
export function LlmConnect({ notify, onChange }: { notify: Notify; onChange?: () => void }) {
  const { data, loading, reload } = useAsync(() => api.llm(), [])
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const info: LlmInfo | undefined = data?.llm

  const connect = async () => {
    if (!key.trim()) return
    setBusy(true); setResult(null)
    try {
      const r = await api.connectLlm(key.trim())
      setKey('')
      setResult({ ok: true, text: r.message_de })
      notify('Claude verbunden. JARVIS antwortet ab sofort frei.', 'good')
      reload(); onChange?.()
    } catch (e) {
      const msg = (e as Error).message
      setResult({ ok: false, text: msg })
      notify(msg, 'bad')
    } finally { setBusy(false) }
  }

  const test = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await api.testLlm()
      setResult({ ok: r.ok, text: r.message_de })
      notify(r.message_de, r.ok ? 'good' : 'bad')
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  const disconnect = async () => {
    if (!confirm('Verbindung zu Claude trennen? JARVIS läuft danach im Quellen-Modus weiter.')) return
    setBusy(true)
    try {
      await api.disconnectLlm()
      setResult(null)
      notify('Verbindung getrennt.', 'info')
      reload(); onChange?.()
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  if (loading) return <Card className="px-4 py-3"><Spinner className="h-4 w-4 text-mist-400" /></Card>
  if (!info) return null

  return (
    <Card className={cx('px-4 py-3', !info.configured && 'border-l-2 border-l-accent')}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot status={info.configured ? 'ok' : 'not_configured'} />
        <h3 className="text-sm font-semibold text-white">Claude als Denkapparat</h3>
        {info.configured
          ? <Badge tone="good">verbunden</Badge>
          : <Badge tone="warn">nicht verbunden</Badge>}
        <Badge tone="neutral">{info.model}</Badge>
        {info.configured && info.masked && (
          <code className="text-[11px] text-mist-400">{info.masked}</code>
        )}
        {info.source === 'env' && <Badge tone="info">aus Umgebungsvariable</Badge>}
      </div>

      {!info.configured && (
        <p className="mt-2 text-xs leading-relaxed text-mist-400">
          Ohne Verbindung läuft JARVIS im <strong className="text-mist-200">Quellen-Modus</strong>: Suche, Zitate,
          Widerspruchserkennung, Erinnerungen, Aufgaben und Freigaben funktionieren vollständig — nur die frei
          formulierte Antwort fehlt. Mit einem Schlüssel wird Claude zum Denkapparat: er liest die gefundenen
          Passagen, formuliert die Antwort, wählt Werkzeuge und schlägt Aktionen vor.
        </p>
      )}

      {!info.master_key_present && (
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/25 px-2.5 py-1.5 text-[11px] text-amber-200">
          Kein <code>JARVIS_MASTER_KEY</code> gesetzt. Der Schlüssel würde sonst unverschlüsselt auf der Platte
          liegen — deshalb wird er nicht gespeichert. Erzeuge einen mit <code>npm run jarvis -- keygen</code> und
          trage ihn in <code>.env</code> ein.
        </p>
      )}

      {info.offline && (
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/25 px-2.5 py-1.5 text-[11px] text-amber-200">
          Offline-Modus ist aktiv. Setze <code>JARVIS_OFFLINE=false</code>, sonst werden keine Modellaufrufe gemacht.
        </p>
      )}

      {info.editable ? (
        <div className="mt-3 space-y-2">
          {!info.configured && (
            <Field
              label="Anthropic API-Schlüssel"
              hint="Zu finden unter console.anthropic.com → API Keys. Er wird geprüft, verschlüsselt gespeichert und nie wieder angezeigt."
            >
              <input
                className={cx(inputCls, 'font-mono')}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-api03-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void connect()}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-1.5">
            {!info.configured && (
              <Btn variant="primary" size="sm" disabled={busy || !key.trim()} onClick={() => void connect()}>
                {busy && <Spinner />} Verbinden
              </Btn>
            )}
            {info.configured && (
              <>
                <Btn size="sm" disabled={busy} onClick={() => void test()}>{busy && <Spinner />} Verbindung prüfen</Btn>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>Trennen</Btn>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => { setKey(''); reload() }}>Schlüssel ersetzen</Btn>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-mist-400">
          Der Schlüssel kommt aus <code>ANTHROPIC_API_KEY</code> und wird dort verwaltet. Entferne die Variable,
          um ihn hier zu hinterlegen.
        </p>
      )}

      {result && (
        <p className={cx('mt-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
          result.ok ? 'border-emerald-500/25 bg-emerald-950/25 text-emerald-200'
            : 'border-rose-500/25 bg-rose-950/25 text-rose-200')}>
          {result.text}
        </p>
      )}
    </Card>
  )
}

/** Compact nudge shown above the chat composer while no key is connected. */
export function LlmBanner({ onGoToSystem }: { onGoToSystem: () => void }) {
  const { data } = useAsync(() => api.llm(), [])
  if (!data || data.llm.configured) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-200">
      <span>
        Claude ist nicht verbunden — JARVIS zeigt Quellen und Zitate, formuliert aber keine freien Antworten.
      </span>
      <button onClick={onGoToSystem} className="ml-auto shrink-0 rounded-md border border-amber-400/30 px-2 py-0.5 font-medium hover:bg-amber-400/10">
        Jetzt verbinden
      </button>
    </div>
  )
}
