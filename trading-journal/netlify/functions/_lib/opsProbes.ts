/**
 * Reachability probes of the operator status (C4): one cheap, read-only request per service – but ONLY for a service whose
 * variables are all set. A service that is not configured is reported as "nicht eingerichtet – nicht geprüft", never as
 * reachable. Nothing is sent that costs money or changes anything (no mail, no call, no charge): Supabase auth health,
 * Stripe balance (read), Resend domain list (read), Twilio account (read).
 *
 * Honest wording: `reachable` = the host answered with any HTTP status; `authorized` = the status says the key is accepted
 * (`false` for 401/403 – e.g. a send-only Resend key or a restricted Stripe key – which is normal for such keys and is said
 * so in `note`). No key, URL or response body ever leaves this module; only host names and status codes.
 */
import { envOptional, type ServerEnvName } from "./env";

export interface Probe {
  service: "supabase" | "stripe" | "resend" | "twilio";
  configured: boolean;
  /** `null` = not probed (not configured). */
  reachable: boolean | null;
  authorized: boolean | null;
  status: number | null;
  ms: number | null;
  host: string | null;
  note: string;
}

export const PROBE_TIMEOUT_MS = 4_000;

export const probeTesting: { fetch: typeof fetch | undefined; now: (() => number) | undefined } = { fetch: undefined, now: undefined };

const get = (n: string): string | undefined => envOptional(n as ServerEnvName);

async function hit(service: Probe["service"], url: string, headers: Record<string, string>, notes: { ok: string; denied: string }): Promise<Probe> {
  const f = probeTesting.fetch ?? fetch;
  const now = probeTesting.now ?? Date.now;
  const host = new URL(url).host;
  const t0 = now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await f(url, { method: "GET", headers, signal: ctl.signal, redirect: "manual" });
    const authorized = res.status >= 200 && res.status < 300;
    const denied = res.status === 401 || res.status === 403;
    return {
      service,
      configured: true,
      reachable: true,
      authorized,
      status: res.status,
      ms: now() - t0,
      host,
      note: authorized ? notes.ok : denied ? notes.denied : `Antwort ${res.status}: erreichbar, aber nicht wie erwartet.`,
    };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "AbortError";
    return { service, configured: true, reachable: false, authorized: null, status: null, ms: now() - t0, host, note: timeout ? "Keine Antwort innerhalb von 4 Sekunden." : "Nicht erreichbar (Netzwerk oder DNS)." };
  } finally {
    clearTimeout(timer);
  }
}

const off = (service: Probe["service"], missing: string): Probe => ({ service, configured: false, reachable: null, authorized: null, status: null, ms: null, host: null, note: `nicht eingerichtet (${missing} fehlt) – nicht geprüft` });

const present = (...names: string[]): string[] => names.filter((n) => !get(n)?.trim());

export async function runProbes(): Promise<Probe[]> {
  const jobs: Promise<Probe>[] = [];

  const sbMissing = present("SUPABASE_URL", "SUPABASE_SECRET_KEY");
  const sbUrl = get("SUPABASE_URL")?.trim().replace(/\/+$/, "") ?? "";
  if (sbMissing.length) jobs.push(Promise.resolve(off("supabase", sbMissing.join(", "))));
  else if (!/^https:\/\/[^/\s]+$/.test(sbUrl)) jobs.push(Promise.resolve({ ...off("supabase", ""), configured: true, note: "SUPABASE_URL ist keine https-Adresse – nicht geprüft." }));
  else jobs.push(hit("supabase", `${sbUrl}/auth/v1/health`, { apikey: get("SUPABASE_SECRET_KEY")!.trim() }, { ok: "Supabase Auth antwortet.", denied: "Supabase erreichbar, aber der Service-Schlüssel wird abgelehnt." }));

  const stripeMissing = present("STRIPE_SECRET_KEY");
  jobs.push(
    stripeMissing.length
      ? Promise.resolve(off("stripe", stripeMissing.join(", ")))
      : hit("stripe", "https://api.stripe.com/v1/balance", { authorization: `Bearer ${get("STRIPE_SECRET_KEY")!.trim()}` }, { ok: "Stripe antwortet, Schlüssel gültig.", denied: "Stripe erreichbar, aber der Schlüssel wird abgelehnt oder darf kein Guthaben lesen (bei eingeschränkten Schlüsseln normal)." }),
  );

  const resendMissing = present("RESEND_API_KEY");
  jobs.push(
    resendMissing.length
      ? Promise.resolve(off("resend", resendMissing.join(", ")))
      : hit("resend", "https://api.resend.com/domains", { authorization: `Bearer ${get("RESEND_API_KEY")!.trim()}` }, { ok: "Resend antwortet, Schlüssel gültig.", denied: "Resend erreichbar; der Schlüssel darf keine Domains lesen (bei reinen Sende-Schlüsseln normal)." }),
  );

  const twilioMissing = present("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN");
  const sid = get("TWILIO_ACCOUNT_SID")?.trim() ?? "";
  if (twilioMissing.length) jobs.push(Promise.resolve(off("twilio", twilioMissing.join(", "))));
  else if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) jobs.push(Promise.resolve({ ...off("twilio", ""), configured: true, note: "TWILIO_ACCOUNT_SID hat nicht die Form AC + 32 Zeichen – nicht geprüft." }));
  else jobs.push(hit("twilio", `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { authorization: `Basic ${Buffer.from(`${sid}:${get("TWILIO_AUTH_TOKEN")!.trim()}`).toString("base64")}` }, { ok: "Twilio antwortet, Zugangsdaten gültig.", denied: "Twilio erreichbar, aber die Zugangsdaten werden abgelehnt." }));

  return Promise.all(jobs);
}
