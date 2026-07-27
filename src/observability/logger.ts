/**
 * Strukturiertes Logging + unveraenderliches Ereignisprotokoll.
 *
 * Jede Logzeile laeuft durch `redact()`. Damit kann ein versehentlich
 * mitgeloggtes Token die Logdatei nicht kompromittieren.
 */
import { redact, newId } from '../security/crypto.js';
import { run, nowIso, get } from '../db/index.js';
import { config } from '../config/env.js';

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, critical: 50 };
const threshold = LEVELS[config.logLevel] ?? 20;

function emit(severity: Severity, message: string, detail?: Record<string, unknown>): void {
  if ((LEVELS[severity] ?? 20) < threshold) return;
  const line = JSON.stringify({
    ts: nowIso(),
    level: severity,
    msg: message,
    ...(detail ?? {}),
  });
  const safe = redact(line);
  if (severity === 'error' || severity === 'critical') process.stderr.write(safe + '\n');
  else process.stdout.write(safe + '\n');
}

export const log = {
  debug: (m: string, d?: Record<string, unknown>) => emit('debug', m, d),
  info: (m: string, d?: Record<string, unknown>) => emit('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => emit('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => emit('error', m, d),
  critical: (m: string, d?: Record<string, unknown>) => emit('critical', m, d),
};

export interface EventInput {
  kind: string;
  severity?: Severity;
  actor: string;
  entityType?: string | null;
  entityId?: string | null;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Schreibt in das unveraenderliche Ereignisprotokoll UND in den Log-Stream.
 * Dies ist der Audit-Trail: jede fachlich relevante Handlung landet hier.
 */
export function recordEvent(input: EventInput): void {
  const severity = input.severity ?? 'info';
  const detail = redact(JSON.stringify(input.detail ?? {}));
  run(
    `INSERT INTO events (at, kind, severity, actor, entity_type, entity_id, message, detail_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    nowIso(),
    input.kind,
    severity,
    input.actor,
    input.entityType ?? null,
    input.entityId ?? null,
    redact(input.message),
    detail,
  );
  emit(severity, input.message, {
    kind: input.kind,
    actor: input.actor,
    entity: input.entityId ?? undefined,
  });
}

export function raiseAlert(
  code: string,
  message: string,
  severity: 'warn' | 'error' | 'critical',
  entity?: { type: string; id: string },
): void {
  // Nicht quittierte Alarme desselben Codes fuer dieselbe Entitaet werden
  // nicht dupliziert - sonst ertrinkt der Betreiber in Rauschen.
  const existing = get<{ id: string }>(
    `SELECT id FROM system_alerts
     WHERE code = ? AND acknowledged_at IS NULL
       AND COALESCE(entity_id,'') = COALESCE(?,'')`,
    code,
    entity?.id ?? null,
  );
  if (existing) return;

  run(
    `INSERT INTO system_alerts (id, at, severity, code, message, entity_type, entity_id)
     VALUES (?,?,?,?,?,?,?)`,
    newId('alr'),
    nowIso(),
    severity,
    code,
    redact(message),
    entity?.type ?? null,
    entity?.id ?? null,
  );
  emit(severity, `ALERT ${code}: ${message}`, { code });
}
