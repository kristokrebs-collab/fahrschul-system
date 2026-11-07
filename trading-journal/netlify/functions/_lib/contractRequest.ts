/**
 * Cancel (§ 312k BGB) and withdraw (§ 356a BGB) declarations without a login (B4). ENTWURF – Prüfung durch Anwalt nötig; the
 * chosen path and its reasons are in `docs/RECHT/kuendigung-widerruf.md`.
 *
 * Path (the simpler and more cautious of the two options): a PUBLIC page asks for the e-mail address (and, for a withdrawal,
 * a name and the contract), shows a confirmation page with the button "Jetzt kündigen" / "Widerruf bestätigen", and on that
 * click the server STORES the declaration with its receipt time and mails the address a link. The link opens a last page and
 * confirms – only then the contract is changed, so nobody can end a stranger's contract by typing an address. A signed-in
 * person whose account address is the typed one skips the mail step (the login proves the address) and gets the confirmation
 * mail afterwards. The answer never tells whether an address has a contract. No "reason / offer" step stands in between.
 *
 * Cancel = at the end of the paid period (Stripe `cancel_at_period_end`, like the in-app cancel). Withdraw = at once, only
 * within 14 days of the contract (`subscriptions.created_at`); the refund (Wertersatz) is NOT automatic – the operator decides.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ContractConfirmResponse, ContractDeclaration, ContractKind, ContractReceipt } from "../../../src/billing/contract";
import { WITHDRAWAL_DAYS } from "../../../src/billing/purchase/manage";
import { isMissingTable } from "./account";
import { audit } from "./audit";
import { mailConfig, sendMail, type MailConfig } from "./alertWatch/mail";
import { recipientOf } from "./alertWatch/recipient";
import { buildContractMail } from "./contractMail";
import { envOptional } from "./env";
import { HttpError } from "./http";
import { assertSameOrigin } from "./purchase";
import { enforceRateLimit, rateKey } from "./rateLimit";
import {
  changeSubscription,
  pickCurrent,
  stripeApi,
  stripeCall,
  subscriptionRows,
  syncSubscription,
  type SubscriptionRow,
} from "./stripe";
import { supabaseAdmin } from "./supabase";
import type { AuthUser } from "./auth";

/** The withdrawal period (§ 355 Abs. 2 BGB): 14 days from the conclusion of the contract (one definition, `src/billing/purchase/manage.ts`). */
export { WITHDRAWAL_DAYS };
/** How long the confirmation link works. */
export const LINK_TTL_MS = 24 * 3_600_000;
const OPEN = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);
const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[^\s@<>"',;]{2,24}$/;

export const normalizeEmail = (raw: string): string | null => {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const emailHash = (email: string): string => {
  const pepper = envOptional("IP_HASH_PEPPER") ?? (envOptional("SUPABASE_SECRET_KEY") ? sha256(`tj-ip-pepper:${envOptional("SUPABASE_SECRET_KEY")}`) : "tj-local-only");
  return createHmac("sha256", pepper).update(`tj-contract:${email}`).digest("hex");
};

/** Deep-link query of the public pages: `?kuendigen=<token>` / `?widerruf=<token>`. */
export const linkParam = (kind: ContractKind): string => (kind === "cancel" ? "kuendigen" : "widerruf");

const operatorName = (): string | null => (envOptional("VITE_LEGAL_OPERATOR" as never)?.trim() || null);

/* ------------------------------------------------------------------ who is behind an address */

/**
 * The account for a typed address: the signed-in user when it is HIS address, else – through the Stripe customer that carries
 * `supabase_user_id` – the account whose confirmed auth address is exactly this one. Never a guess.
 */
export async function accountForEmail(email: string, signedIn: AuthUser | null): Promise<{ userId: string; direct: boolean } | null> {
  if (signedIn && signedIn.email?.trim().toLowerCase() === email) return { userId: signedIn.id, direct: true };
  let customers: { metadata?: Record<string, string> | null }[] = [];
  try {
    customers = (await stripeApi().customers.list({ email, limit: 5 })).data as typeof customers;
  } catch {
    return null; // without Stripe there is no contract to find
  }
  for (const c of customers) {
    const uid = c.metadata?.supabase_user_id;
    if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) continue;
    const r = await recipientOf(uid);
    if (r?.confirmed && r.email.trim().toLowerCase() === email) return { userId: uid, direct: false };
  }
  return null;
}

async function contractRow(userId: string): Promise<{ row: SubscriptionRow; createdAt: Date | null } | null> {
  const rows = await subscriptionRows(userId);
  const row = pickCurrent(rows.filter((r) => OPEN.has(r.status)));
  if (!row) return null;
  const { data } = await supabaseAdmin().from("subscriptions").select("created_at").eq("id", row.id).maybeSingle();
  const at = (data as { created_at?: string } | null)?.created_at;
  return { row, createdAt: at ? new Date(at) : null };
}

/* ------------------------------------------------------------------ declare */

export interface DeclareContext {
  signedIn: AuthUser | null;
  origin: string;
  ip: string | null;
  now?: Date;
}

/**
 * Step 1+2 of the public flow (the click on "Jetzt kündigen" / "Widerruf bestätigen"): validates, stores the declaration
 * (receipt time = server clock) and either executes at once (signed in as that address) or mails the confirmation link.
 */
export async function declareContract(input: ContractDeclaration, ctx: DeclareContext): Promise<ContractReceipt> {
  const email = normalizeEmail(input.email);
  if (!email) throw new HttpError(422, "invalid_email", "Bitte gib eine gültige E-Mail-Adresse an.");
  const now = ctx.now ?? new Date();
  const eh = emailHash(email);
  await enforceRateLimit(rateKey("billing-contract", eh.slice(0, 32)), 5, 3600, { failClosed: true });
  const mail = mailConfig();
  const receipt = (next: ContractReceipt["next"]): ContractReceipt => ({ kind: input.kind, receivedAt: now.toISOString(), mail: mail ? "sent" : "unavailable", next });
  const found = await accountForEmail(email, ctx.signedIn);
  const token = randomBytes(32).toString("base64url");
  const base = {
    kind: input.kind,
    user_id: found?.userId ?? null,
    email_hash: eh,
    declared_name: input.name?.trim().slice(0, 120) || null,
    contract_hint: input.contract?.trim().slice(0, 300) || null,
    received_at: now.toISOString(),
  };
  const sb = supabaseAdmin();
  if (!found) {
    // same answer as for a known address; the record keeps no address, only its salted hash
    const { error } = await sb.from("contract_requests").insert({ ...base, status: "unknown", token_hash: null });
    if (error && !isMissingTable(error)) console.error("[fn] contract_requests write failed", error.code ?? "");
    return receipt("check");
  }
  const ins = await sb.from("contract_requests").insert({ ...base, status: "received", token_hash: found.direct ? null : sha256(token) }).select("id").maybeSingle();
  if (ins.error) {
    console.error("[fn] contract_requests write failed", ins.error.code ?? "");
    // the declaration could not be stored: say so, never pretend it was received
    throw new HttpError(503, "contract_unavailable", "Deine Erklärung konnte nicht gespeichert werden. Bitte versuche es gleich noch einmal.");
  }
  const id = (ins.data as { id?: string } | null)?.id ?? null;
  await audit(found.userId, `billing.contract.${input.kind}.received`, { direct: found.direct }, ctx.ip);
  if (found.direct) {
    await executeContract({ id, kind: input.kind, userId: found.userId, receivedAt: now, name: base.declared_name, contract: base.contract_hint }, mail, ctx.ip);
    return receipt("done");
  }
  if (mail) {
    const to = await recipientOf(found.userId);
    const cur = await contractRow(found.userId);
    if (to) {
      const origin = assertSameOrigin(ctx.origin);
      const link = `${origin}/?${linkParam(input.kind)}=${token}`;
      const m = buildContractMail({ kind: input.kind, step: "verify", receivedAt: now, link, plan: cur?.row.plan, interval: cur?.row.interval, operator: operatorName() });
      const sent = await sendMail(mail, { to: to.email, subject: m.subject, text: m.text, idempotencyKey: `tj-contract-${sha256(token).slice(0, 32)}` });
      if (!sent.ok) console.error("[fn] contract mail failed", sent.code);
    }
  }
  return receipt("check");
}

/* ------------------------------------------------------------------ confirm / execute */

interface ExecInput {
  id: string | null;
  kind: ContractKind;
  userId: string;
  receivedAt: Date;
  name?: string | null;
  contract?: string | null;
}

/**
 * Executes a declaration of a known account: cancel at the end of the period, or withdraw at once (only within 14 days of
 * the contract). Writes the result to the record, mails the confirmation (when mail is set up) and returns what to show.
 */
export async function executeContract(x: ExecInput, mail: MailConfig | null, ip: string | null = null): Promise<ContractConfirmResponse> {
  const confirmedAt = new Date();
  const cur = await contractRow(x.userId);
  let status: ContractConfirmResponse["status"] = "done";
  let endsAt: Date | null = null;
  if (!cur) status = "none";
  else if (x.kind === "withdraw") {
    const start = cur.createdAt;
    if (!start || confirmedAt.getTime() - start.getTime() > WITHDRAWAL_DAYS * 86_400_000) status = "late";
    else {
      const api = stripeApi();
      const sub = await stripeCall("subscription withdraw", () => api.subscriptions.cancel(cur.row.id, { invoice_now: false, prorate: false }));
      await syncSubscription(sub, { userId: x.userId, fresh: true, eventAt: Math.floor(confirmedAt.getTime() / 1000) });
      endsAt = confirmedAt;
    }
  } else {
    const res = await changeSubscription(x.userId, "cancel", {});
    const iso = res.subscription?.cancelAt ?? res.subscription?.currentPeriodEnd ?? null;
    endsAt = iso ? new Date(iso) : null;
  }
  if (x.id) {
    const { error } = await supabaseAdmin()
      .from("contract_requests")
      .update({ status, executed_at: confirmedAt.toISOString(), ends_at: endsAt?.toISOString() ?? null, token_hash: null })
      .eq("id", x.id);
    if (error) console.error("[fn] contract_requests update failed", error.code ?? "");
  }
  await audit(x.userId, `billing.contract.${x.kind}.${status}`, { plan: cur?.row.plan ?? null }, ip);
  if (mail && status !== "none") {
    const to = await recipientOf(x.userId);
    if (to) {
      const m = buildContractMail({
        kind: x.kind,
        step: status === "late" ? "late" : "done",
        receivedAt: x.receivedAt,
        confirmedAt,
        endsAt,
        plan: cur?.row.plan,
        interval: cur?.row.interval,
        name: x.name,
        contract: x.contract,
        operator: operatorName(),
      });
      const sent = await sendMail(mail, { to: to.email, subject: m.subject, text: m.text, idempotencyKey: `tj-contract-done-${x.id ?? sha256(`${x.userId}${x.receivedAt.toISOString()}`).slice(0, 24)}` });
      if (!sent.ok) console.error("[fn] contract confirmation mail failed", sent.code);
    }
  }
  return { kind: x.kind, status, endsAt: endsAt?.toISOString() ?? null, confirmedAt: confirmedAt.toISOString() };
}

/** The link of the mail: executes the stored declaration (once; the token is cleared). */
export async function confirmContract(token: string, ctx: { ip: string | null }): Promise<ContractConfirmResponse> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new HttpError(404, "unknown_link", "Dieser Link ist ungültig oder schon benutzt.");
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("contract_requests")
    .select("id,kind,user_id,status,received_at,declared_name,contract_hint")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error) {
    console.error("[fn] contract_requests read failed", error.code ?? "");
    throw new HttpError(503, "contract_unavailable", "Das gerade nicht möglich. Bitte versuche es gleich noch einmal.");
  }
  const row = data as { id: string; kind: ContractKind; user_id: string | null; status: string; received_at: string; declared_name: string | null; contract_hint: string | null } | null;
  if (!row || row.status !== "received" || !row.user_id) throw new HttpError(404, "unknown_link", "Dieser Link ist ungültig oder schon benutzt.");
  const receivedAt = new Date(row.received_at);
  if (Date.now() - receivedAt.getTime() > LINK_TTL_MS) {
    await sb.from("contract_requests").update({ status: "expired", token_hash: null }).eq("id", row.id);
    return { kind: row.kind, status: "expired", endsAt: null, confirmedAt: new Date().toISOString() };
  }
  return executeContract({ id: row.id, kind: row.kind, userId: row.user_id, receivedAt, name: row.declared_name, contract: row.contract_hint }, mailConfig(), ctx.ip);
}

/**
 * The in-app cancel (signed in, Konto) leaves a record and a confirmation mail like the public path: `kind: cancel`, already
 * executed by `changeSubscription`. Best effort – the cancellation itself has happened; returns whether the mail was sent.
 */
export async function recordInAppCancel(user: AuthUser, endsAtIso: string | null): Promise<"sent" | "unavailable"> {
  const now = new Date();
  const mail = mailConfig();
  try {
    await supabaseAdmin()
      .from("contract_requests")
      .insert({ kind: "cancel", user_id: user.id, email_hash: user.email ? emailHash(user.email.trim().toLowerCase()) : "0".repeat(64), status: "executed", received_at: now.toISOString(), executed_at: now.toISOString(), ends_at: endsAtIso });
    if (!mail) return "unavailable";
    const to = user.email ? { email: user.email } : await recipientOf(user.id);
    if (!to) return "unavailable";
    const cur = await contractRow(user.id);
    const m = buildContractMail({ kind: "cancel", step: "done", receivedAt: now, confirmedAt: now, endsAt: endsAtIso ? new Date(endsAtIso) : null, plan: cur?.row.plan, interval: cur?.row.interval, operator: operatorName() });
    const sent = await sendMail(mail, { to: to.email, subject: m.subject, text: m.text, idempotencyKey: `tj-cancel-${user.id}-${now.toISOString().slice(0, 16)}` });
    return sent.ok ? "sent" : "unavailable";
  } catch (e) {
    console.error("[fn] in-app cancel record failed", e instanceof Error ? e.name : typeof e);
    return "unavailable";
  }
}

