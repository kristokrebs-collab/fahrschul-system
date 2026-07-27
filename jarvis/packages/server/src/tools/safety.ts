import type { RiskClass, ActionPreview } from '@jarvis/shared'
import { ALWAYS_CONFIRM } from '@jarvis/shared'
import { scanForInjection, INJECTION_BLOCK_THRESHOLD } from '../security/injection.js'
import type { ToolSpec } from './registry.js'

/**
 * Action Safety Reviewer.
 *
 * Runs *after* the tool planner has produced a concrete payload and *before*
 * the owner sees a confirmation card. It is deliberately independent of the
 * planner: rule-based, deterministic, and unable to be talked out of a verdict
 * by anything in the conversation. The planner proposes; this decides whether
 * a human must look.
 *
 * Verdicts:
 *   allow   — may execute without a card (only ever for read_only / rule-covered
 *             reversible writes)
 *   confirm — show the card, execute only on explicit approval
 *   block   — refuse outright; no card, because approving it would be a mistake
 */

export type Verdict = 'allow' | 'confirm' | 'block'

export interface Finding {
  code: string
  severity: 'info' | 'warn' | 'critical'
  message: string
}

export interface SafetyReview {
  verdict: Verdict
  findings: Finding[]
  injection_score: number
  reviewed_by: 'action-safety-reviewer'
}

export interface ReviewInput {
  spec: ToolSpec
  payload: Record<string, unknown>
  /** Everything untrusted that fed this turn: retrieved passages, web content. */
  untrustedContext: string
  /** True when an owner-authored narrow rule covers this exact action. */
  ruleCovered?: boolean
}

/** Patterns that must never appear in an outbound payload. */
const SECRET_LEAK = [
  { code: 'leak_api_key', re: /\b(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/ },
  { code: 'leak_private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { code: 'leak_jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { code: 'leak_env', re: /\b(JARVIS_MASTER_KEY|ANTHROPIC_API_KEY|VOYAGE_API_KEY|OPENAI_API_KEY)\s*=/ },
]

const MASS_RECIPIENTS = 5

export function reviewAction(input: ReviewInput): SafetyReview {
  const { spec, payload, untrustedContext, ruleCovered } = input
  const findings: Finding[] = []
  let verdict: Verdict = 'allow'

  const escalate = (v: Verdict) => {
    const order: Verdict[] = ['allow', 'confirm', 'block']
    if (order.indexOf(v) > order.indexOf(verdict)) verdict = v
  }

  /* 1. Risk class is the floor. */
  if (ALWAYS_CONFIRM.includes(spec.risk)) {
    escalate('confirm')
    findings.push({
      code: 'risk_class', severity: 'warn',
      message: `Risikoklasse "${spec.risk}" erfordert immer eine Bestätigung.`,
    })
  } else if (spec.risk === 'reversible_write' && !ruleCovered) {
    escalate('confirm')
    findings.push({
      code: 'write_without_rule', severity: 'info',
      message: 'Schreibende Aktion ohne passende Automatisierungsregel.',
    })
  }

  /* 2. Injection pressure on this turn. */
  const scan = scanForInjection(untrustedContext)
  for (const f of scan.findings) {
    findings.push({ code: `injection.${f.code}`, severity: f.severity, message: f.message })
  }
  if (scan.blocked) {
    // A turn under injection pressure loses every automation shortcut it had.
    // Read-only actions still proceed — they cannot cause harm — but anything
    // that writes or leaves the machine now needs a human.
    if (spec.risk !== 'read_only') {
      escalate('confirm')
      findings.push({
        code: 'injection_gate', severity: 'critical',
        message: `Abgerufener Inhalt enthält mutmaßliche Anweisungen (Score ${scan.score}). ` +
                 'Automatische Freigaben sind für diesen Zug ausgesetzt.',
      })
    }
    if (spec.risk === 'external_comm' || spec.risk === 'financial_security') {
      // Sending data outward while the context is compromised is the exact
      // shape of a successful exfiltration. Refuse rather than ask.
      escalate('block')
      findings.push({
        code: 'injection_exfil_block', severity: 'critical',
        message: 'Externe Kommunikation wird blockiert, solange der Kontext mutmaßlich manipuliert ist.',
      })
    }
  }

  /* 3. Payload inspection — secrets must not leave. */
  const flat = JSON.stringify(payload)
  for (const rule of SECRET_LEAK) {
    if (rule.re.test(flat)) {
      escalate('block')
      findings.push({
        code: rule.code, severity: 'critical',
        message: 'Die Nutzlast enthält offenbar ein Geheimnis (Schlüssel/Token). Aktion blockiert.',
      })
    }
  }

  /* 4. Shape checks for outbound communication. */
  if (spec.risk === 'external_comm') {
    const recipients = collectRecipients(payload)
    if (recipients.length >= MASS_RECIPIENTS) {
      escalate('confirm')
      findings.push({
        code: 'mass_recipients', severity: 'warn',
        message: `${recipients.length} Empfänger – bitte Verteiler prüfen.`,
      })
    }
    const external = recipients.filter((r) => !r.endsWith('@michael-krebs.com'))
    if (external.length) {
      findings.push({
        code: 'external_recipient', severity: 'warn',
        message: `Empfänger außerhalb der eigenen Domain: ${external.slice(0, 5).join(', ')}`,
      })
    }
  }

  /* 5. Destructive scope checks. */
  if (spec.risk === 'destructive') {
    if (/\ball\b|\balle\b|\*|%$/i.test(flat)) {
      findings.push({
        code: 'broad_scope', severity: 'critical',
        message: 'Der Löschumfang wirkt sehr breit (Platzhalter oder "alle"). Bitte genau prüfen.',
      })
    }
    if (!spec.reversible) {
      findings.push({
        code: 'irreversible', severity: 'critical',
        message: 'Diese Aktion ist nicht umkehrbar.',
      })
    }
  }

  /* 6. Integration preconditions. */
  if (spec.requiresIntegration && !spec.integrationReady?.()) {
    escalate('block')
    findings.push({
      code: 'integration_missing', severity: 'critical',
      message: `Die Integration "${spec.requiresIntegration}" ist nicht konfiguriert. ` +
               'Die Aktion wird nicht ausgeführt und nicht als erfolgreich gemeldet.',
    })
  }

  return { verdict, findings, injection_score: scan.score, reviewed_by: 'action-safety-reviewer' }
}

function collectRecipients(payload: Record<string, unknown>): string[] {
  const out: string[] = []
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) out.push(m[0].toLowerCase())
    } else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') Object.values(v).forEach(visit)
  }
  for (const k of ['to', 'cc', 'bcc', 'recipients', 'empfaenger']) visit(payload[k])
  return [...new Set(out)]
}

/** True when the review permits execution without showing a card. */
export function mayAutoExecute(review: SafetyReview): boolean {
  return review.verdict === 'allow'
}

export function summariseReview(review: SafetyReview): string {
  if (review.verdict === 'block') return 'Blockiert'
  if (review.verdict === 'confirm') return 'Bestätigung erforderlich'
  return 'Freigegeben'
}
