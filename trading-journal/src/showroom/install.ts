/**
 * Installs the Showroom (Paket S) BEFORE the app boots (`main.tsx`, only when `SHOWROOM` is true – otherwise this chunk is not in the build):
 *   1. the fixed banner (plain DOM, from the first paint),
 *   2. the device's first-visit seed (demo journal, quiet defaults) and the mock backend (state restored from the last page load),
 *   3. `fetch` and `WebSocket` replaced: account, payment, coach and mail requests are answered in the page – NOTHING reaches Supabase, Stripe or
 *      Anthropic; market data (Binance, Bybit, OKX …) goes to the real network, as in the normal build,
 *   4. the billing hand-over (`redirectToStripe`) opens the simulated hosted page instead of leaving the app.
 * The visitor starts signed in as the Premium demo account (so every gated page is open); the panel switches to a signed-out / Free / new account.
 */
import { setRedirectHandler } from "@/billing/api";
import { registerDemoFields } from "@/billing/purchase/pay/fields";
import { closeManage, closeOrder, releaseBusy } from "@/billing/store";
import { mountBanner } from "./banner";
import { createBackend, DEMO_ACCOUNT, type Backend } from "./mock/backend";
import { installSockets } from "./mock/fakeSockets";
import type { MockReq, MockRes } from "./mock/http";
import { demoJournalNow, isFirstVisit, loadPersisted, markInit, readBootPlan, savePersisted, seedDevice } from "./seed";
import type { DemoJournal } from "./mock/demoJournal";
import { useJournal } from "@/store/journalStore";
import { arrival, netLog, setBackend, useShowroom } from "./runtime";

const NO_BODY = new Set([204, 205, 304]);

function toResponse(res: MockRes): Response {
  const headers = new Headers(res.headers ?? {});
  if (res.contentType) headers.set("content-type", res.contentType);
  return new Response(NO_BODY.has(res.status) ? null : (res.body ?? ""), { status: res.status, headers });
}

const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

/** Resolves with `p`, rejects with AbortError as soon as `signal` fires. */
function withSignal<T>(p: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function readRequest(input: RequestInfo | URL, init?: RequestInit): Promise<{ req: MockReq; signal: AbortSignal | null }> {
  const asRequest = input instanceof Request ? input : null;
  const url = new URL(asRequest ? asRequest.url : String(input instanceof URL ? input.href : input), location.href);
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? asRequest?.headers).forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const method = (init?.method ?? asRequest?.method ?? "GET").toUpperCase();
  let text: string | null = null;
  if (typeof init?.body === "string") text = init.body;
  else if (init?.body == null && asRequest && method !== "GET" && method !== "HEAD") text = await asRequest.clone().text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const v = JSON.parse(text) as unknown;
      if (v && typeof v === "object") body = v as Record<string, unknown>;
    } catch {
      /* form data / plain text: no JSON body */
    }
  }
  return { req: { method, url, headers, body }, signal: init?.signal ?? asRequest?.signal ?? null };
}

/** Hosts of the services the Showroom mocks (Supabase, Stripe, Anthropic): a request to them never leaves the page. */
const MOCKED_HOST = /(^|\.)(supabase\.co|supabase\.com|stripe\.com|anthropic\.com)$|^showroom\.invalid$/;

function patchFetch(backend: Backend): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { req, signal } = await readRequest(input, init);
    const hit = backend.route(req);
    if (hit) return toResponse(await withSignal(Promise.resolve(hit), signal));
    // a mocked service the backend has no answer for (account, payment, AI): no connection – the same failure an offline browser gives
    if (MOCKED_HOST.test(req.url.hostname)) {
      netLog.refused.push(`${req.method} ${req.url.origin}${req.url.pathname}`);
      throw new TypeError("Failed to fetch");
    }
    // everything else goes to the real network, as in the normal build: the page's own files (chunks, fonts, OCR assets, the site's relays)
    // and the market data (Binance, Bybit, OKX …) – real quotes, nothing generated
    return real(input, init);
  };
}

/** The session supabase-js finds in its storage on the first visit: the Premium demo account is signed in. */
function seedSession(backend: Backend): void {
  const session = backend.sb.issueSession(DEMO_ACCOUNT.email);
  if (session) {
    try {
      localStorage.setItem("tj2-sb-auth", JSON.stringify(session));
    } catch {
      /* blocked storage: the visitor starts signed out */
    }
  }
}

/** The device's journal as the app holds it after booting (normalised) – the demo accounts' rows are made from it at the first sync. */
function liveJournal(): DemoJournal {
  const j = useJournal.getState();
  return { settings: j.settings as unknown as Record<string, unknown>, trades: j.trades as unknown as Array<Record<string, unknown>>, hyblock: [] };
}

export async function installShowroom(): Promise<void> {
  mountBanner();
  arrival.billing = new URLSearchParams(location.search).get("billing");
  const now = Date.now();
  const first = isFirstVisit();
  const plan = readBootPlan();
  const restored = first ? null : loadPersisted();
  const demo = first && plan.journal === "demo" ? demoJournalNow(now) : null;
  if (first) seedDevice(demo, now);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let backend: Backend | null = null;
  const save = () => {
    timer = null;
    if (backend) savePersisted(backend.persisted());
  };
  const onChange = () => {
    useShowroom.setState((s) => ({ mailTick: s.mailTick + 1 }));
    if (timer === null) timer = setTimeout(save, 250);
  };
  backend = createBackend({ selfHost: location.hostname, anchor: restored?.anchor ?? now, journal: demo ? liveJournal : null, restore: restored, onChange });
  setBackend(backend);
  if (first) {
    if (plan.signedIn) seedSession(backend);
    markInit();
    save();
  }
  window.addEventListener("pagehide", save);
  patchFetch(backend);
  installSockets(backend);
  // Paket V: the payment window takes the card in the app – here with the DEMO fields (no Stripe in the Showroom; only a verdict reaches the mock)
  registerDemoFields(() => import("@/billing/purchase/pay/demoFields").then((m) => m.createDemoFields()));
  // the order's hand-over to "Stripe" (portal, and the checkout fallback): the simulated hosted page opens inside the app
  setRedirectHandler((url) => {
    // the order sheet (and its focus trap) steps away: the hosted page is the whole screen now, as Stripe's page would be
    closeOrder();
    closeManage();
    releaseBusy();
    useShowroom.setState({ hosted: { kind: /billing\.stripe\.com/.test(url) ? "portal" : "checkout", url } });
  });
}
