/**
 * Showroom (Paket S): the transport-free mock handlers the e2e mocks and the in-app interceptor share – Supabase (auth, mail box, PKCE exchange, rows),
 * billing (checkout → hosted page → webhook result, per account), the demo journal, the backend's routing (market data and unknown hosts are
 * nobody's – market data goes to the real network) and the fixed banner. Pure functions and jsdom, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BANNER_ID, BANNER_TEXT, mountBanner } from "@/showroom/banner";
import { SHOWROOM } from "@/showroom/flag";
import { createBackend, COACH_DELAY_MS, DEMO_ACCOUNT } from "@/showroom/mock/backend";
import { createBillingCore } from "@/showroom/mock/billingCore";
import { buildDemoJournal } from "@/showroom/mock/demoJournal";
import type { MockReq } from "@/showroom/mock/http";
import { claimsOf, createSupabaseCore } from "@/showroom/mock/supabaseCore";

const req = (method: string, url: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): MockReq => ({ method, url: new URL(url), headers, body });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const SB = "https://showroom.invalid";
const json = (r: { body?: string }) => JSON.parse(r.body ?? "null") as Record<string, unknown>;

afterEach(() => {
  document.getElementById(BANNER_ID)?.remove();
  document.head.querySelectorAll("[data-showroom-style]").forEach((n) => n.remove());
  document.documentElement.removeAttribute("data-showroom");
  vi.useRealTimers();
});

describe("flag", () => {
  it("is off in every build that is not the showroom build (dev, tests, production, share, single file)", () => {
    expect(SHOWROOM).toBe(false);
  });
});

describe("banner", () => {
  it("is one fixed note with the honest text, no control, mounted once", () => {
    const bar = mountBanner();
    expect(mountBanner()).toBe(bar);
    expect(document.querySelectorAll(`#${BANNER_ID}`)).toHaveLength(1);
    expect(bar.textContent).toBe(BANNER_TEXT);
    expect(BANNER_TEXT).toBe("SHOWROOM · Demo-Daten · keine echten Konten oder Zahlungen");
    expect(bar.querySelector("button, a, input, [role=button]")).toBeNull();
    expect(document.documentElement.getAttribute("data-showroom")).toBe("1");
    const css = document.head.querySelector("[data-showroom-style]")?.textContent ?? "";
    expect(css).toContain("position:fixed");
    // the band is added to --safe-bottom (dock, footer padding, sheets) instead of covering the page
    expect(css).toContain("--safe-bottom");
  });
});

describe("supabase core", () => {
  it("password sign-in, refresh, wrong password, user, rows for the signed-in account only", () => {
    const core = createSupabaseCore({ realClock: true });
    const bad = core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email: "trader@example.com", password: "nope" }));
    expect(bad.status).toBe(400);
    const ok = json(core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email: "trader@example.com", password: "richtig-geheim-42" })));
    const token = String(ok.access_token);
    expect(claimsOf(`Bearer ${token}`)?.email).toBe("trader@example.com");
    const again = json(core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=refresh_token`, { refresh_token: ok.refresh_token })));
    expect(again.access_token).toBeTruthy();
    const put = core.handleSupabase(req("POST", `${SB}/rest/v1/journal_docs`, [{ kind: "trade", id: "t_1", data: { id: "t_1" }, deleted: false }] as never, { ...bearer(token), prefer: "resolution=merge-duplicates" }));
    expect(put.status).toBe(201);
    const list = core.handleSupabase(req("GET", `${SB}/rest/v1/journal_docs?select=*`, {}, bearer(token)));
    expect(JSON.parse(list.body!)).toHaveLength(1);
    expect(core.handleSupabase(req("GET", `${SB}/rest/v1/journal_docs`, {}, {})).status).toBe(401);
  });

  it("registration with confirmation: the mail is recorded, not sent; 'opening' it confirms and a PKCE code gives the session (once)", () => {
    const core = createSupabaseCore({ signupConfirm: true, mailbox: true, realClock: true });
    const r = core.handleSupabase(req("POST", `${SB}/auth/v1/signup?redirect_to=${encodeURIComponent("https://site.test/?order=premium.year.1")}`, { email: "Neu@Showroom.test", password: "ein-langes-passwort" }));
    expect(json(r).access_token).toBeUndefined(); // no session before the link
    // no sign-in before the confirmation
    expect(core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email: "neu@showroom.test", password: "ein-langes-passwort" })).status).toBe(400);
    expect(core.mails).toHaveLength(1);
    const mail = core.mails[0]!;
    expect(mail).toMatchObject({ kind: "confirm", email: "neu@showroom.test", opened: false });
    const hit = core.openMail(mail.id)!;
    // the link brings the person back to where the registration said – with its ?order= kept – and a code
    const url = new URL(hit.url);
    expect(url.origin + url.pathname).toBe("https://site.test/");
    expect(url.searchParams.get("order")).toBe("premium.year.1");
    const code = url.searchParams.get("code")!;
    const session = core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=pkce`, { auth_code: code, code_verifier: "x" }));
    expect(session.status).toBe(200);
    expect(json(session).user).toMatchObject({ email: "neu@showroom.test" });
    expect(core.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=pkce`, { auth_code: code, code_verifier: "x" })).status).toBe(400);
    expect(core.mails[0]!.opened).toBe(true);
  });

  it("magic link and password reset are mails too; an existing address never reveals itself", () => {
    const core = createSupabaseCore({ mailbox: true, realClock: true });
    core.handleSupabase(req("POST", `${SB}/auth/v1/otp?redirect_to=https%3A%2F%2Fsite.test%2F`, { email: "trader@example.com", create_user: true }));
    core.handleSupabase(req("POST", `${SB}/auth/v1/recover?redirect_to=https%3A%2F%2Fsite.test%2F`, { email: "trader@example.com" }));
    core.handleSupabase(req("POST", `${SB}/auth/v1/recover`, { email: "unknown@example.com" }));
    expect(core.mails.map((m) => m.kind)).toEqual(["magic", "reset"]);
    const again = core.handleSupabase(req("POST", `${SB}/auth/v1/signup`, { email: "trader@example.com", password: "irgendwas-langes" }));
    expect((json(again).identities as unknown[]).length).toBe(0);
  });

  it("without the mailbox option nothing is recorded (the e2e behaviour is unchanged)", () => {
    const core = createSupabaseCore({ signupConfirm: true });
    core.handleSupabase(req("POST", `${SB}/auth/v1/signup`, { email: "a@b.test", password: "langes-passwort-1" }));
    expect(core.mails).toHaveLength(0);
  });

  it("a snapshot restores accounts, rows and refresh tokens (the demo survives the mail link's page load)", () => {
    const a = createSupabaseCore({ realClock: true, mailbox: true });
    const s = json(a.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email: "trader@example.com", password: "richtig-geheim-42" })));
    a.handleSupabase(req("POST", `${SB}/rest/v1/journal_docs`, { kind: "day", id: "2026-11-08", data: { note: "x" }, deleted: false }, bearer(String(s.access_token))));
    const b = createSupabaseCore({ restore: JSON.parse(JSON.stringify(a.snapshot())), realClock: true, mailbox: true });
    expect(b.users).toHaveLength(1);
    expect(b.rows.size).toBe(1);
    expect(b.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=refresh_token`, { refresh_token: s.refresh_token })).status).toBe(200);
  });

  it("Realtime: join answers with the binding, an emitted change reaches the socket of that account", async () => {
    const core = createSupabaseCore({});
    const frames: unknown[][] = [];
    const conn = core.realtime.open({ send: (f) => frames.push(JSON.parse(f) as unknown[]) });
    conn.message(JSON.stringify(["1", "1", "realtime:x", "phx_join", { config: { postgres_changes: [{ event: "*", schema: "public", table: "journal_docs", filter: `user_id=eq.${core.users[0]!.id}` }] } }]));
    expect(frames[0]![3]).toBe("phx_reply");
    await core.emit("trade", "t_9", { id: "t_9" });
    expect(frames.some((f) => f[3] === "postgres_changes")).toBe(true);
    conn.close();
  });
});

describe("billing core", () => {
  const order = { plan: "premium", interval: "year", seats: 1, orderId: "11111111-2222-4333-8444-555555555555", consents: { terms: true, immediateStart: true }, returnTo: "/#preise" };
  const auth = { authorization: "Bearer x" };
  const checkout = (core: ReturnType<typeof createBillingCore>) => core.handle(req("POST", "https://site.test/api/v1/billing/checkout", order as never, auth));

  it("a checkout becomes a plan only when the (fake) hosted page pays – and only then", () => {
    const core = createBillingCore({ outcome: "active" });
    expect(json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, auth))).plan).toMatchObject({ plan: "free" });
    const r = json(checkout(core));
    expect(String(r.url)).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(core.pendingOrder()?.plan).toBe("premium");
    expect(json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, auth))).plan).toMatchObject({ plan: "free" });
    const done = core.completeCheckout("active")!;
    expect(done.location).toContain("billing=success&session_id=cs_test_e2e_1");
    expect(json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, auth))).plan).toMatchObject({ plan: "premium", status: "active" });
    expect(core.pendingOrder()).toBeNull();
  });

  it("the error cases are selectable: unpaid / incomplete / never leave no usable plan; cancel changes nothing", () => {
    for (const outcome of ["unpaid", "incomplete", "never"] as const) {
      const core = createBillingCore({});
      checkout(core);
      core.completeCheckout(outcome);
      const plan = json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, auth))).plan as { plan: string };
      expect(plan.plan).toBe("free");
    }
    const core = createBillingCore({});
    checkout(core);
    expect(core.cancelCheckout()!.location).toContain("billing=cancel");
    expect(json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, auth))).plan).toMatchObject({ plan: "free" });
  });

  it("refuses a checkout without both consents or without a login", () => {
    const core = createBillingCore({});
    expect(core.handle(req("POST", "https://site.test/api/v1/billing/checkout", { ...order, consents: { terms: true, immediateStart: false } } as never, auth)).status).toBe(422);
    expect(core.handle(req("POST", "https://site.test/api/v1/billing/checkout", order as never, {})).status).toBe(401);
  });

  it("plans belong to accounts (Showroom): one account's Premium is not another's", () => {
    const key = (r: MockReq) => r.headers["x-user"] ?? "anon";
    const core = createBillingCore({ userKey: key, initial: { a: { plan: { plan: "premium", status: "active", trialEnd: null }, hasCustomer: true } } });
    const status = (u: string) => json(core.handle(req("GET", "https://site.test/api/v1/billing/status", {}, { ...auth, "x-user": u }))).plan as { plan: string };
    expect(status("a").plan).toBe("premium");
    expect(status("b").plan).toBe("free");
    core.setAccount("a", "free");
    expect(status("a").plan).toBe("free");
    core.setAccount("b", "premium");
    expect(status("b").plan).toBe("premium");
  });
});


describe("demo journal", () => {
  const now = new Date(2026, 10, 8, 14, 30).getTime(); // a Sunday afternoon

  it("is deterministic, marked as demo, and rich enough for reports, the weekly close and the limit hint", () => {
    const a = buildDemoJournal(now);
    const b = buildDemoJournal(now);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.trades.length).toBeGreaterThan(30);
    expect(a.trades.every((t) => String(t.notes).startsWith("Demo-Eintrag"))).toBe(true);
    expect(new Set(a.trades.map((t) => t.id)).size).toBe(a.trades.length);
    // both accounts, wins and losses, nothing in the future
    expect(new Set(a.trades.map((t) => t.account))).toEqual(new Set(["makro", "scalp"]));
    expect(a.trades.some((t) => Number(t.pnl) > 0) && a.trades.some((t) => Number(t.pnl) < 0)).toBe(true);
    expect(a.trades.every((t) => new Date(String(t.date)).getTime() <= now)).toBe(true);
    // today's two scalp losses use most of the daily limit (4 % of 5.000 = 200)
    const today = a.trades.filter((t) => String(t.date).startsWith("2026-11-08") && t.account === "scalp");
    const loss = -today.reduce((s, t) => s + Number(t.pnl), 0);
    expect(today).toHaveLength(2);
    expect(loss).toBeGreaterThan(200 * 0.6);
    expect(loss).toBeLessThan(200);
    // the current week (Mon 2026-11-02 …) has trades
    expect(a.trades.filter((t) => String(t.date) >= "2026-11-02").length).toBeGreaterThanOrEqual(3);
  });

  it("Rücknahme R7: the results scatter like a real journal – no smooth rise (win rate under ⅔, a drawdown, frequent sign changes, uneven steps)", () => {
    for (const day of [now, now - 3 * 86_400_000, now + 9 * 86_400_000]) {
      const pnl = buildDemoJournal(day).trades.map((t) => Number(t.pnl));
      const wins = pnl.filter((p) => p > 0).length / pnl.length;
      expect(wins).toBeGreaterThan(0.3);
      expect(wins).toBeLessThan(0.66);
      let eq = 0;
      let peak = 0;
      let drawdown = 0;
      let turns = 0;
      for (let i = 0; i < pnl.length; i++) {
        eq += pnl[i]!;
        peak = Math.max(peak, eq);
        drawdown = Math.max(drawdown, peak - eq);
        if (i > 0 && Math.sign(pnl[i]!) !== Math.sign(pnl[i - 1]!)) turns++;
      }
      // the equity line falls back noticeably at least once and changes direction often
      expect(drawdown).toBeGreaterThan(150);
      expect(turns / (pnl.length - 1)).toBeGreaterThan(0.3);
      // uneven steps: the biggest win is several times the typical one
      const winsAbs = pnl.filter((p) => p > 0).sort((x, y) => x - y);
      expect(winsAbs.at(-1)! / winsAbs[Math.floor(winsAbs.length / 2)]!).toBeGreaterThan(2);
    }
  });
});

describe("backend routing", () => {
  const mk = () => createBackend({ selfHost: "site.test", anchor: Date.now(), journal: null });

  it("answers the project and the functions – and leaves market data (and every host it does not know) to the interceptor", async () => {
    const b = mk();
    expect(b.route(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password }))).toMatchObject({ status: 200 });
    // Rücknahme R5: no generated market – Binance, Bybit and the site's relays are the real network's
    expect(b.route(req("GET", "https://fapi.binance.com/fapi/v1/time"))).toBeNull();
    expect(b.route(req("GET", "https://api.bybit.com/v5/market/kline?interval=60&limit=20"))).toBeNull();
    expect(b.route(req("GET", "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h"))).toBeNull();
    expect(b.route(req("GET", "https://site.test/api/binance/fapi/v1/time"))).toBeNull();
    expect(b.route(req("GET", "https://site.test/api/v1/klines?interval=1h"))).toBeNull();
    expect(b.route(req("GET", "https://site.test/api/v1/billing/status"))).toMatchObject({ status: 200 });
    expect(b.route(req("GET", "https://site.test/api/v1/nothing-here"))).toMatchObject({ status: 401 }); // the functions' own 404 / 401 – never the network
    expect(b.route(req("GET", "https://api.stripe.com/v1/charges"))).toBeNull();
    expect(b.route(req("GET", "https://api.anthropic.com/v1/messages"))).toBeNull();
    expect(b.route(req("GET", "https://www.okx.com/api/v5/public/time"))).toBeNull();
    expect(b.route(req("GET", "https://site.test/assets/app.js"))).toBeNull(); // the page's own files are not this backend's
  });

  it("the demo account starts with Premium, a new account with Free; the coach answers after a delay, from the request's facts only, labelled as a demo", async () => {
    const b = mk();
    const login = (email: string, password: string) => json(b.sb.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=password`, { email, password })));
    const demo = login(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
    const plan = (token: string) => (json(b.billing.handle(req("GET", "https://site.test/api/v1/billing/status", {}, { authorization: `Bearer ${token}` }))).plan as { plan: string }).plan;
    expect(plan(String(demo.access_token))).toBe("premium");
    b.sb.handleSupabase(req("POST", `${SB}/auth/v1/signup`, { email: "n@showroom.test", password: "langes-passwort-1" }));
    // confirmation is needed (default): confirm through the mailbox, then sign in with the code
    const mail = b.sb.mails.find((m) => m.email === "n@showroom.test")!;
    const code = new URL(b.sb.openMail(mail.id)!.url, "https://site.test").searchParams.get("code")!;
    const fresh = json(b.sb.handleSupabase(req("POST", `${SB}/auth/v1/token?grant_type=pkce`, { auth_code: code })));
    expect(plan(String(fresh.access_token))).toBe("free");

    vi.useFakeTimers();
    const get = await b.route(req("GET", "https://site.test/api/v1/coach/ask"));
    expect(json(get!)).toEqual({ enabled: true });
    const pending = b.route(req("POST", "https://site.test/api/v1/coach/ask", { question: "q", title: "Regelverstoß", text: "t", facts: [{ label: "Vorkommen", value: "12" }] }))!;
    let settled = false;
    void Promise.resolve(pending).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(COACH_DELAY_MS - 100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const reply = json(await pending);
    expect(String(reply.text)).toContain("Vorkommen: 12");
    expect(String(reply.text)).toContain("Demo-Formulierung des Showrooms");
    expect(reply.model).toBe("showroom-demo");
  });
});
