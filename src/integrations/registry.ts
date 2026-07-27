/**
 * Registrierung der Veroeffentlichungsziele und Zustandspflege der Konten.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent, raiseAlert } from '../observability/logger.js';
import { PublishAdapter } from './types.js';
import { InstagramAdapter, FacebookAdapter } from './meta.js';
import { TikTokAdapter } from './tiktok.js';
import { YouTubeAdapter } from './youtube.js';
import { SandboxAdapter } from './sandbox.js';

const ADAPTERS: Record<string, PublishAdapter> = {
  instagram: new InstagramAdapter(),
  facebook: new FacebookAdapter(),
  tiktok: new TikTokAdapter(),
  youtube: new YouTubeAdapter(),
  sandbox: new SandboxAdapter(),
};

export function adapterFor(platform: string): PublishAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`Kein Adapter fuer Plattform "${platform}" registriert.`);
  return adapter;
}

export function listAdapters(): PublishAdapter[] {
  return Object.values(ADAPTERS);
}

export interface PlatformAccount {
  id: string;
  platform: string;
  handle: string;
  external_id: string | null;
  display_name: string;
  is_public: number;
  status: string;
  scopes_json: string;
  connected_at: string | null;
  token_expires_at: string | null;
  last_check_at: string | null;
  last_check_error: string | null;
}

export function listAccounts(): PlatformAccount[] {
  return all<PlatformAccount>('SELECT * FROM platform_accounts ORDER BY platform, handle');
}

export function ensureAccount(input: {
  platform: string;
  handle: string;
  displayName: string;
  externalId?: string | null;
  isPublic: boolean;
  scopes?: string[];
}): PlatformAccount {
  const existing = get<PlatformAccount>(
    'SELECT * FROM platform_accounts WHERE platform = ? AND handle = ?',
    input.platform,
    input.handle,
  );
  if (existing) return existing;
  const id = newId('acc');
  run(
    `INSERT INTO platform_accounts
      (id, platform, handle, external_id, display_name, is_public, scopes_json, status, created_at)
     VALUES (?,?,?,?,?,?,?,'unconfigured',?)`,
    id,
    input.platform,
    input.handle,
    input.externalId ?? null,
    input.displayName,
    input.isPublic ? 1 : 0,
    JSON.stringify(input.scopes ?? []),
    nowIso(),
  );
  return get<PlatformAccount>('SELECT * FROM platform_accounts WHERE id = ?', id)!;
}

/**
 * Prueft jedes Konto gegen den echten Anbieter und schreibt den Zustand fort.
 * Laeuft beim Start und periodisch, damit ein abgelaufenes Token auffaellt,
 * bevor ein geplanter Beitrag daran scheitert.
 */
export async function refreshAccountStatus(actor = 'system:scheduler'): Promise<PlatformAccount[]> {
  for (const account of listAccounts()) {
    const adapter = ADAPTERS[account.platform];
    if (!adapter) continue;

    if (!adapter.isConfigured()) {
      run(
        `UPDATE platform_accounts SET status = 'unconfigured', last_check_at = ?,
         last_check_error = ? WHERE id = ?`,
        nowIso(),
        'Zugangsdaten fehlen in der Serverkonfiguration.',
        account.id,
      );
      continue;
    }

    try {
      const result = await adapter.checkConnection();
      run(
        `UPDATE platform_accounts
         SET status = ?, last_check_at = ?, last_check_error = ?, token_expires_at = ?,
             connected_at = COALESCE(connected_at, ?)
         WHERE id = ?`,
        result.ok ? 'connected' : 'error',
        nowIso(),
        result.ok ? null : result.detail,
        result.expiresAt ?? account.token_expires_at ?? null,
        result.ok ? nowIso() : null,
        account.id,
      );

      // Frueh warnen: ein Token, das in weniger als sieben Tagen ablaeuft,
      // faellt sonst erst beim naechsten geplanten Beitrag auf.
      if (result.expiresAt) {
        const daysLeft = (new Date(result.expiresAt).getTime() - Date.now()) / 86400_000;
        if (daysLeft < 7) {
          raiseAlert(
            'TOKEN_EXPIRING',
            `Das Zugangstoken fuer ${account.platform}/@${account.handle} laeuft am ${result.expiresAt} ab (in ${Math.round(daysLeft)} Tagen).`,
            daysLeft < 2 ? 'critical' : 'warn',
            { type: 'platform_account', id: account.id },
          );
        }
      }
    } catch (err) {
      const message = (err as Error).message;
      run(
        `UPDATE platform_accounts SET status = ?, last_check_at = ?, last_check_error = ? WHERE id = ?`,
        message.includes('abgelaufen') || message.includes('verweigert') ? 'token_expired' : 'error',
        nowIso(),
        message,
        account.id,
      );
      raiseAlert(
        'ACCOUNT_CHECK_FAILED',
        `Verbindungspruefung fuer ${account.platform}/@${account.handle} fehlgeschlagen: ${message}`,
        'error',
        { type: 'platform_account', id: account.id },
      );
    }
  }

  recordEvent({
    kind: 'integrations.status_refreshed',
    actor,
    message: 'Kontostatus aller Plattformen geprueft.',
  });
  return listAccounts();
}

/** Uebersicht fuer die Einstellungen-Ansicht inklusive Berechtigungsstufe. */
export function integrationOverview() {
  return listAdapters().map((a) => {
    const accounts = listAccounts().filter((acc) => acc.platform === a.platform);
    return {
      platform: a.platform,
      isPublic: a.isPublic,
      configured: a.isConfigured(),
      accounts: accounts.map((acc) => ({
        id: acc.id,
        handle: acc.handle,
        displayName: acc.display_name,
        status: acc.status,
        tokenExpiresAt: acc.token_expires_at,
        lastCheckAt: acc.last_check_at,
        lastCheckError: acc.last_check_error,
      })),
      permissionLevel: a.isPublic ? 'schreibend (veroeffentlichen + Kennzahlen lesen)' : 'lokal (kein Netzwerkzugriff)',
    };
  });
}
