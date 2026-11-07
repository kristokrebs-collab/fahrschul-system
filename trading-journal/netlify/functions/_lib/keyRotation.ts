/**
 * Key rotation for EVERYTHING that is encrypted with the `EXCHANGE_ENC_KEY_V<n>` family (Runde 11, Linse 3 #2).
 *
 * The sweep of the exchange cron (`rotateStaleConnections`) only moved the exchange keys and then reported `remaining = 0` – "the old key can
 * go". But two more tables hold blobs of the same key family: `alert_phone_secrets.number_enc` (the verified phone number) and
 * `tv_mcp_connections.access_enc / refresh_enc` (the TradingView-MCP tokens). Removing V1 after that report would have made every phone alarm
 * fail silently and every TradingView connection read "nicht lesbar". `rotateAllStaleSecrets` re-encrypts all three and counts them all in
 * `remaining`, so `0` finally means what the operator reads into it.
 *
 * A blob's version is its prefix (`v2:…`); a row is stale when it is not on the keyring's current version. A blob that no longer decrypts
 * (its key is gone, a wrong AAD) is counted as `failed` and left alone – it needs a new number / a new connection, never a guess.
 */
import { CryptoError, decrypt, encrypt, keyringFromEnv, needsReencrypt, type Keyring } from "./crypto";
import { phoneAad } from "./alerts/deliver";
import { rotateStaleConnections, type RotationSweep } from "./exchanges/store";
import { supabaseAdmin } from "./supabase";

type Row = Record<string, unknown>;

const blob = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

interface Column {
  name: string;
  aad: (userId: string) => string;
}

/** Re-encrypts the stale blobs of one table keyed by `user_id`. `remaining` counts every row still on an older version after the sweep. */
async function sweepTable(table: string, columns: readonly Column[], limit: number, ring: Keyring): Promise<RotationSweep> {
  const out: RotationSweep = { rotated: 0, failed: 0, remaining: 0 };
  const names = columns.map((c) => c.name).join(",");
  const stale = (r: Row): boolean => columns.some((c) => {
    const b = blob(r[c.name]);
    return b !== null && needsReencrypt(b, ring);
  });
  // the table is small (one row per user with a phone / a connection); read the blobs only, never log them
  const { data, error } = await supabaseAdmin().from(table).select(`user_id,${names}`).limit(10_000);
  if (error) {
    // a table that does not exist (migration not applied) has nothing to rotate
    return out;
  }
  const rows = ((data ?? []) as unknown as Row[]).filter(stale);
  for (const row of rows.slice(0, limit)) {
    const userId = String(row.user_id);
    try {
      const patch: Row = {};
      for (const c of columns) {
        const b = blob(row[c.name]);
        if (b !== null && needsReencrypt(b, ring)) patch[c.name] = encrypt(decrypt(b, c.aad(userId), ring), c.aad(userId), ring);
      }
      const { error: e } = await supabaseAdmin().from(table).update(patch).eq("user_id", userId);
      if (e) out.failed++;
      else out.rotated++;
    } catch (e) {
      out.failed++; // never log the user, the blob or the key
      if (!(e instanceof CryptoError)) console.error("[fn] key rotation failed", table);
    }
  }
  out.remaining = Math.max(0, rows.length - out.rotated);
  return out;
}

const PHONE: readonly Column[] = [{ name: "number_enc", aad: phoneAad }];
const TVMCP: readonly Column[] = [
  { name: "access_enc", aad: (u) => `${u}:tv-mcp:access` },
  { name: "refresh_enc", aad: (u) => `${u}:tv-mcp:refresh` },
];

/**
 * Exchange keys, phone numbers and TradingView-MCP tokens: up to `limit` rows each. `remaining` is the sum over all three (and `-1`
 * when the exchange table could not be counted); only when it is 0 may the old `EXCHANGE_ENC_KEY_V<n>` be removed.
 */
export async function rotateAllStaleSecrets(limit = 50, ring?: Keyring): Promise<RotationSweep> {
  const exchange = await rotateStaleConnections(limit, ring);
  let kr: Keyring;
  try {
    kr = ring ?? keyringFromEnv();
  } catch {
    return exchange;
  }
  const phone = await sweepTable("alert_phone_secrets", PHONE, limit, kr);
  const tv = await sweepTable("tv_mcp_connections", TVMCP, limit, kr);
  return {
    rotated: exchange.rotated + phone.rotated + tv.rotated,
    failed: exchange.failed + phone.failed + tv.failed,
    remaining: exchange.remaining < 0 ? -1 : exchange.remaining + phone.remaining + tv.remaining,
  };
}
