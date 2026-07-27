/**
 * Voice I/O built on the Web Speech API.
 *
 * Design constraint from the spec: voice must degrade gracefully — a denied or
 * missing microphone must never make the assistant unusable. Everything here
 * reports capability up front, and every failure path resolves to "type
 * instead", never to a dead UI.
 *
 * Push-to-talk is the baseline because it is the only mode that works reliably
 * across Safari/iOS, Chrome, and Firefox. Wake-word is deliberately not
 * implemented: doing it privately needs on-device keyword spotting, and a
 * browser-based always-on recogniser would stream audio continuously to a
 * cloud service — the opposite of what this system promises.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null
}

export interface VoiceCapabilities {
  recognition: boolean
  synthesis: boolean
  reason: string
}

export function voiceCapabilities(): VoiceCapabilities {
  const rec = !!recognitionCtor()
  const syn = typeof window !== 'undefined' && 'speechSynthesis' in window
  const secure = typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost')
  let reason = 'Spracheingabe und -ausgabe verfügbar.'
  if (!secure) reason = 'Spracheingabe braucht HTTPS oder localhost.'
  else if (!rec && !syn) reason = 'Dieser Browser unterstützt keine Sprachfunktionen. Tippen funktioniert weiterhin.'
  else if (!rec) reason = 'Dieser Browser kann nicht zuhören (Firefox). Sprachausgabe funktioniert.'
  else if (!syn) reason = 'Sprachausgabe nicht verfügbar.'
  return { recognition: rec && secure, synthesis: syn, reason }
}

export type ListenState = 'idle' | 'starting' | 'listening' | 'error'

export interface Listener {
  start(): void
  stop(): void
  abort(): void
}

export function createListener(opts: {
  lang?: string
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onState: (s: ListenState, detail?: string) => void
}): Listener | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null

  const rec = new Ctor()
  rec.lang = opts.lang ?? 'de-DE'
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1

  let finalText = ''

  rec.onstart = () => opts.onState('listening')
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      const chunk = result?.[0]?.transcript ?? ''
      if (result?.isFinal) finalText += chunk
      else interim += chunk
    }
    opts.onPartial((finalText + interim).trim())
  }
  rec.onerror = (e) => {
    const map: Record<string, string> = {
      'not-allowed': 'Mikrofonzugriff wurde abgelehnt. Du kannst weiterhin tippen.',
      'service-not-allowed': 'Spracherkennung ist im Browser gesperrt. Tippen funktioniert.',
      'no-speech': 'Nichts gehört.',
      network: 'Spracherkennung braucht eine Netzverbindung.',
      aborted: '',
    }
    const msg = map[e.error] ?? `Spracherkennung: ${e.error}`
    opts.onState(e.error === 'aborted' || e.error === 'no-speech' ? 'idle' : 'error', msg)
  }
  rec.onend = () => {
    const text = finalText.trim()
    finalText = ''
    if (text) opts.onFinal(text)
    opts.onState('idle')
  }

  return {
    start() {
      finalText = ''
      opts.onState('starting')
      try { rec.start() } catch { opts.onState('error', 'Aufnahme läuft bereits.') }
    },
    stop() { try { rec.stop() } catch { /* already stopped */ } },
    abort() { finalText = ''; try { rec.abort() } catch { /* already stopped */ } },
  }
}

/* ── Speech output ───────────────────────────────────────────────────────── */

export interface SpeakOptions {
  rate?: number
  voiceUri?: string | null
  lang?: string
}

let currentUtterance: SpeechSynthesisUtterance | null = null

export function germanVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith('de') || v.lang.startsWith('en'))
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!('speechSynthesis' in window)) return
  stopSpeaking()

  // Strip markdown so the voice does not read asterisks and bullets aloud.
  const clean = text
    .replace(/```[\s\S]*?```/g, ' Codeblock. ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return

  const u = new SpeechSynthesisUtterance(clean.slice(0, 4000))
  u.lang = opts.lang ?? 'de-DE'
  u.rate = opts.rate ?? 1.05
  if (opts.voiceUri) {
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === opts.voiceUri)
    if (v) u.voice = v
  }
  currentUtterance = u
  speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  currentUtterance = null
}

export function isSpeaking(): boolean {
  return 'speechSynthesis' in window && speechSynthesis.speaking
}
