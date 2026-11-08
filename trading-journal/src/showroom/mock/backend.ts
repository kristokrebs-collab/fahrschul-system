/**
 * The Showroom's whole backend in one object (Paket S): Supabase (auth, rows, Realtime, the mails), the billing functions, the coach, and a
 * polite 404 for every other function. Transport-free: `route()` takes a `MockReq` and answers a `MockRes` (or says "not mine"), the
 * interceptor in `../install.ts` does the `fetch` / `WebSocket` side.
 *
 * Market data (Binance, Bybit, OKX … and the site's own relays) is NOT mocked: `route()` says "not mine" and the interceptor lets the request
 * go to the real network, as in the normal build. Nothing in here talks to a network itself.
 */
import { createBillingCore, mockSubscription, type BillingCore, type BillingSnapshot } from "./billingCore";
import { fnRes, type MockReq, type MockRes } from "./http";
import { claimsOf, createSupabaseCore, type SupabaseCore, type SupabaseSnapshot } from "./supabaseCore";
import type { DemoJournal } from "./demoJournal";

/** The demo accounts every visitor may use (the panel says so). The password is a public demo string, not a secret. */
export const DEMO_ACCOUNT = { email: "demo@showroom.test", password: "demo-konto-1234" } as const;
/** Latency of the coach's reply: long enough to see "Coach denkt …". */
export const COACH_DELAY_MS = 2600;

export interface ShowroomPersisted {
  v: 1;
  /** the time of the first visit (kept in the stored state) */
  anchor: number;
  sb: SupabaseSnapshot;
  bill: BillingSnapshot;
}

export interface BackendOptions {
  now?: () => number;
  /** the host name of the page itself (same-origin `/api/v1/*` requests are this backend's) */
  selfHost: string;
  /** the time of the first visit (kept in the stored state) */
  anchor: number;
  /** the demo journal: the demo accounts' rows (a first visit) – read from the live journal at the first sync, see `lazyDocs` */
  journal: (() => DemoJournal) | null;
  restore?: ShowroomPersisted | null;
  /** called (debounced by the host) after any change */
  onChange?: () => void;
  /** how a registration plays out: the mail has to be "clicked" (default) */
  signupConfirm?: boolean;
}

export interface Backend {
  sb: SupabaseCore;
  billing: BillingCore;
  /** `null` = no rule of this backend (the interceptor decides: the site's files and market data pass, the hosts of mocked services fail) */
  route(req: MockReq): MockRes | Promise<MockRes> | null;
  /** the host to hand to a fake socket: which socket does a URL belong to */
  isSupabaseHost(host: string): boolean;
  persisted(): ShowroomPersisted;
}

const SUPABASE_HOSTS = (host: string): boolean => host === "showroom.invalid" || host.endsWith(".supabase.co");

/** Coach rephrasing: built ONLY from the facts of the request (the real function refuses numbers that were not computed) and labelled. */
function coachReply(body: Record<string, unknown>): Record<string, unknown> {
  const facts = Array.isArray(body.facts) ? (body.facts as Array<{ label?: unknown; value?: unknown }>) : [];
  const parts = facts.slice(0, 4).map((f) => `${String(f.label ?? "")}: ${String(f.value ?? "")}`);
  const title = typeof body.title === "string" && body.title ? body.title : "Antwort";
  const text = `${title}. ${parts.length ? `Aus deinen Zahlen: ${parts.join(" · ")}. ` : ""}Das ist eine Demo-Formulierung des Showrooms – keine echte KI-Antwort; die berechnete Antwort oben bleibt maßgeblich.`;
  return { text, model: "showroom-demo" };
}

export function createBackend(o: BackendOptions): Backend {
  const now = o.now ?? Date.now;
  const restore = o.restore ?? null;
  const changed = () => o.onChange?.();

  const sb = createSupabaseCore({
    users: [{ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password }],
    lazyDocs: o.journal
      ? {
          copyTo: [],
          get: () => {
            const j = o.journal!();
            return [...j.trades.map((t) => ({ kind: "trade", id: String(t.id), data: t })), { kind: "settings", id: "settings", data: j.settings }];
          },
        }
      : undefined,
    signupConfirm: o.signupConfirm !== false,
    mailbox: true,
    realClock: true,
    otherSessions: 1,
    ...(restore ? { restore: restore.sb } : {}),
    onChange: changed,
  });
  const demoUserId = sb.users[0]?.id ?? "";
  const fnUserKey = (req: MockReq): string => {
    const c = claimsOf(req.headers["authorization"]);
    return typeof c?.sub === "string" ? c.sub : "anon";
  };
  const billing = createBillingCore({
    outcome: "active",
    userKey: fnUserKey,
    // the demo account has Premium (yearly) running; everyone else (new registrations) starts on Free
    initial: {
      [demoUserId]: {
        plan: { plan: "premium", status: "active", trialEnd: null },
        subscription: mockSubscription({ id: "sub_demo_1", plan: "premium", status: "active", interval: "year", amount: 24000, trialEnd: null, currentPeriodEnd: new Date(now() + 300 * 86_400_000).toISOString() }),
        invoices: [{ id: "in_demo_1", number: "DEMO-0001", status: "paid", total: 24000, currency: "eur", created: new Date(now() - 65 * 86_400_000).toISOString(), hostedUrl: "https://invoice.stripe.com/i/demo", pdfUrl: "https://pay.stripe.com/invoice/demo/pdf" }],
        hasCustomer: true,
        trialUsed: true,
      },
    },
    codes: { DEMO10: { percentOff: 10, duration: "once", message: "Demo-Code: −10 % im ersten Zeitraum (kein echter Rabatt)" } },
    ...(restore ? { restore: restore.bill } : {}),
    onChange: changed,
  });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function route(req: MockReq): MockRes | Promise<MockRes> | null {
    const { url } = req;
    const host = url.hostname;
    if (SUPABASE_HOSTS(host)) return sb.handleSupabase(req);
    // market data is NOT this backend's: Binance, Bybit, OKX … (and the site's own relays `/api/binance/*`, `/api/v1/klines`) go to the
    // real network, exactly as in the normal build
    if (host !== o.selfHost) return null;
    const p = url.pathname;
    if (!p.startsWith("/api/v1/") || p === "/api/v1/klines") return null;
    if (p.startsWith("/api/v1/billing/")) return billing.handle(req);
    if (p === "/api/v1/coach/ask") {
      if (req.method === "GET") return fnRes(200, { enabled: true });
      return sleep(COACH_DELAY_MS).then(() => fnRes(200, coachReply(req.body)));
    }
    if (p === "/api/v1/assistant/route") return fnRes(200, { enabled: false });
    return sb.handleFunctions(req);
  }

  return {
    sb,
    billing,
    route,
    isSupabaseHost: SUPABASE_HOSTS,
    persisted: () => ({ v: 1, anchor: o.anchor, sb: sb.snapshot(), bill: billing.snapshot() }),
  };
}

