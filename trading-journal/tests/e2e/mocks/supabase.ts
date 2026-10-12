/**
 * In-process fake of the Supabase project + the P09 Netlify functions for e2e (P09). Everything the browser client
 * talks to is answered here: GoTrue (`/auth/v1/*`: password, signup, magic link, reset, refresh, user, logout, TOTP
 * factors / challenge / verify), PostgREST (`/rest/v1/journal_docs` with server-stamped `rev` / `updated_at`, upsert,
 * optimistic settings update; `profiles`; `rpc/my_sessions`), Realtime (`/realtime/v1/websocket`, Phoenix v2 frames:
 * join → postgres_changes binding, heartbeat; `emit()` pushes a change like another device would) and the functions
 * under `/api/v1/*` (export, delete, backups, audit, log).
 *
 * Build the app with `VITE_SUPABASE_URL=${SUPABASE_E2E_URL}` and `VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_E2E_KEY}`
 * (cloud.spec.ts does so for its dev server). State lives in the test process (`MockSupabase.rows`, `.audit`, …).
 */
import type { Page, WebSocketRoute } from "@playwright/test";

export const SUPABASE_E2E_URL = "https://e2e-mock.supabase.co";
export const SUPABASE_E2E_KEY = "sb_publishable_e2e";
/** The TOTP code the fake accepts. */
export const TOTP_CODE = "123456";

export interface MockRow {
  user_id: string;
  kind: string;
  id: string;
  data: unknown;
  deleted: boolean;
  rev: number;
  updated_at: string;
  client_updated_at?: string | null;
}

interface MockFactor {
  id: string;
  friendly_name: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  created_at: string;
  updated_at: string;
}

interface MockUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  created_at: string;
  factors: MockFactor[];
  privacy: Record<string, unknown>;
}

export interface MockSupabaseOptions {
  /** Accounts that exist up front (`mfa`: a verified TOTP factor). */
  users?: Array<{ email: string; password: string; mfa?: boolean }>;
  /** Registration needs the e-mail confirmed first (no session after signup). */
  signupConfirm?: boolean;
  /** `journal_docs` of the FIRST user up front. */
  docs?: Array<{ kind: string; id: string; data: unknown; deleted?: boolean }>;
  /** Further devices in the session list. */
  otherSessions?: number;
  /** Serve the `/api/v1/*` functions (default true; false = the SPA fallback page, i.e. functions not deployed). */
  functions?: boolean;
}

export interface MockSupabase {
  rows: Map<string, MockRow>;
  users: MockUser[];
  audit: { action: string; at: string }[];
  logs: unknown[];
  /** Requests seen (method + path). */
  calls: string[];
  /** Pushes a row change over Realtime (another device wrote it). Also stores it. */
  emit(kind: string, id: string, data: unknown, deleted?: boolean): Promise<MockRow>;
  /** Live record of a key (`trade:t_1`), undefined for tombstones / missing. */
  live(key: string): unknown;
  deletedAccounts: string[];
}

const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function jwt(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "e2e" }))}.${b64url(JSON.stringify(payload))}.${b64url("e2e-signature")}`;
}

function claimsOf(auth: string | null | undefined): Record<string, unknown> | null {
  const token = auth?.replace(/^Bearer\s+/i, "") ?? "";
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A deterministic QR-looking SVG (finder squares + pseudo-random modules) – a mock, not scannable. */
export function fakeQrSvg(seed = 7): string {
  const n = 25;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rects: string[] = [];
  const finder = (x: number, y: number) => {
    rects.push(`<rect x="${x}" y="${y}" width="7" height="7"/>`, `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="white"/>`, `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`);
  };
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rnd() > 0.52) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="white"/><g fill="black">${rects.join("")}</g></svg>`;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

export async function mockSupabase(page: Page, opts: MockSupabaseOptions = {}): Promise<MockSupabase> {
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 12, 8, 0, 0, 0) + ++tick * 1000).toISOString();
  const users: MockUser[] = (opts.users ?? [{ email: "trader@example.com", password: "richtig-geheim-42" }]).map((u, i) => ({
    id: `0000000${i + 1}-1111-4111-8111-11111111111${i + 1}`,
    email: u.email,
    password: u.password,
    confirmed: true,
    created_at: "2026-03-01T09:00:00Z",
    factors: u.mfa ? [{ id: `fac-${i}`, friendly_name: "Authenticator", factor_type: "totp", status: "verified", created_at: "2026-03-02T09:00:00Z", updated_at: "2026-03-02T09:00:00Z" }] : [],
    privacy: {},
  }));
  const rows = new Map<string, MockRow>();
  const sessions = new Map<string, { userId: string; sessionId: string; aal: "aal1" | "aal2" }>();
  const audit: { action: string; at: string }[] = [];
  const logs: unknown[] = [];
  const calls: string[] = [];
  const deletedAccounts: string[] = [];
  const sockets = new Set<{ ws: WebSocketRoute; topic: string; joinRef: string; userId: string }>();
  let seq = 0;

  const rowKey = (userId: string, kind: string, id: string) => `${userId}|${kind}:${id}`;
  const put = (userId: string, kind: string, id: string, data: unknown, deleted: boolean, clientAt?: string | null): MockRow => {
    const key = rowKey(userId, kind, id);
    const prev = rows.get(key);
    const row: MockRow = { user_id: userId, kind, id, data: JSON.parse(JSON.stringify(data ?? {})), deleted, rev: (prev?.rev ?? 0) + 1, updated_at: stamp(), client_updated_at: clientAt ?? null };
    rows.set(key, row);
    return row;
  };
  for (const d of opts.docs ?? []) put(users[0]!.id, d.kind, d.id, d.data, !!d.deleted);

  const userJson = (u: MockUser) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.confirmed ? "2026-03-01T09:05:00Z" : null,
    confirmed_at: u.confirmed ? "2026-03-01T09:05:00Z" : null,
    last_sign_in_at: "2026-10-12T08:00:00Z",
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [{ id: u.id, identity_id: `${u.id}-email`, user_id: u.id, provider: "email", identity_data: { email: u.email, sub: u.id }, created_at: u.created_at, updated_at: u.created_at, last_sign_in_at: u.created_at }],
    factors: u.factors,
    created_at: u.created_at,
    updated_at: u.created_at,
    is_anonymous: false,
  });

  const newSession = (u: MockUser, aal: "aal1" | "aal2", sessionId = `sess-${++seq}`) => {
    const now = Math.floor(Date.now() / 1000);
    const refresh = `rt-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(refresh, { userId: u.id, sessionId, aal });
    return {
      access_token: jwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", aal, amr: [{ method: aal === "aal2" ? "totp" : "password", timestamp: now }], session_id: sessionId, exp: now + 3600, iat: now }),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refresh,
      user: userJson(u),
    };
  };

  const userOf = (auth: string | null | undefined): MockUser | null => {
    const c = claimsOf(auth);
    return (c && users.find((u) => u.id === c.sub)) ?? null;
  };

  const json = (status: number, body: unknown, extra: Record<string, string> = {}) => ({
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
    body: body === undefined ? "" : JSON.stringify(body),
  });
  const authErr = (status: number, code: string, msg: string) => json(status, { code: status, error_code: code, msg });

  /** PostgREST-ish filter `col=op.value` on a row. */
  const matches = (row: Record<string, unknown>, params: URLSearchParams) => {
    for (const [col, raw] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
      const m = /^(eq|gt|lt|neq)\.(.*)$/.exec(raw);
      if (!m) continue;
      const v = row[col];
      const target = m[2]!;
      const sv = typeof v === "number" ? v : String(v);
      const tv = typeof v === "number" ? Number(target) : target;
      if (m[1] === "eq" && sv !== tv) return false;
      if (m[1] === "neq" && sv === tv) return false;
      if (m[1] === "gt" && !(sv > tv)) return false;
      if (m[1] === "lt" && !(sv < tv)) return false;
    }
    return true;
  };
  const pick = (r: MockRow) => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, rev: r.rev, updated_at: r.updated_at });

  const pushRealtime = (row: MockRow, type: "INSERT" | "UPDATE") => {
    for (const s of sockets) {
      if (s.userId !== row.user_id) continue;
      const payload = {
        ids: [4242],
        data: {
          schema: "public",
          table: "journal_docs",
          commit_timestamp: row.updated_at,
          type,
          errors: null,
          columns: [
            { name: "user_id", type: "uuid" },
            { name: "kind", type: "text" },
            { name: "id", type: "text" },
            { name: "data", type: "jsonb" },
            { name: "deleted", type: "bool" },
            { name: "rev", type: "int8" },
            { name: "updated_at", type: "timestamptz" },
          ],
          record: { user_id: row.user_id, kind: row.kind, id: row.id, data: row.data, deleted: row.deleted, rev: row.rev, updated_at: row.updated_at },
          old_record: { user_id: row.user_id, kind: row.kind, id: row.id },
        },
      };
      s.ws.send(JSON.stringify([null, null, s.topic, "postgres_changes", payload]));
    }
  };

  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      const [joinRef, ref, topic, event, payload] = msg as [string | null, string | null, string, string, Record<string, unknown>];
      if (event === "heartbeat") ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
      else if (event === "phx_join") {
        const cfg = (payload?.config ?? {}) as { postgres_changes?: Array<{ event: string; schema: string; table: string; filter?: string }> };
        const bindings = (cfg.postgres_changes ?? []).map((b) => ({ ...b, id: 4242 }));
        const userId = /user_id=eq\.(.+)$/.exec(bindings[0]?.filter ?? "")?.[1] ?? "";
        sockets.add({ ws, topic, joinRef: joinRef ?? "", userId });
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]));
        ws.send(JSON.stringify([joinRef, null, topic, "system", { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes", channel: topic }]));
      } else if (event === "phx_leave") {
        for (const s of sockets) if (s.ws === ws && s.topic === topic) sockets.delete(s);
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      } else if (ref) ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
    });
  });

  await page.route(`${SUPABASE_E2E_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = url.pathname;
    calls.push(`${method} ${path}`);
    const auth = req.headers()["authorization"];
    const body = (() => {
      try {
        return req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();

    /* ---------------- auth ---------------- */
    if (path === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = users.find((x) => x.email === String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) return route.fulfill(authErr(400, "invalid_credentials", "Invalid login credentials"));
        if (!u.confirmed) return route.fulfill(authErr(400, "email_not_confirmed", "Email not confirmed"));
        return route.fulfill(json(200, newSession(u, "aal1")));
      }
      if (grant === "refresh_token") {
        const s = sessions.get(String(body.refresh_token ?? ""));
        const u = s && users.find((x) => x.id === s.userId);
        if (!s || !u) return route.fulfill(authErr(400, "refresh_token_not_found", "Invalid Refresh Token"));
        return route.fulfill(json(200, newSession(u, s.aal, s.sessionId)));
      }
      return route.fulfill(authErr(400, "validation_failed", "unsupported grant"));
    }
    if (path === "/auth/v1/user") {
      const u = userOf(auth);
      if (!u) return route.fulfill(authErr(401, "bad_jwt", "invalid JWT"));
      if (method === "PUT" && typeof body.password === "string") u.password = body.password;
      return route.fulfill(json(200, userJson(u)));
    }
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (path === "/auth/v1/signup") {
      const email = String(body.email ?? "").toLowerCase();
      const existing = users.find((x) => x.email === email);
      if (existing) return route.fulfill(json(200, { ...userJson(existing), identities: [] }));
      const u: MockUser = { id: `0000000${users.length + 1}-2222-4222-8222-22222222222${users.length + 1}`, email, password: String(body.password ?? ""), confirmed: !opts.signupConfirm, created_at: "2026-10-12T08:00:00Z", factors: [], privacy: {} };
      users.push(u);
      return route.fulfill(json(200, opts.signupConfirm ? userJson(u) : newSession(u, "aal1")));
    }
    if (path === "/auth/v1/otp" || path === "/auth/v1/recover" || path === "/auth/v1/resend") return route.fulfill(json(200, {}));
    if (path === "/auth/v1/factors" && method === "POST") {
      const u = userOf(auth);
      if (!u) return route.fulfill(authErr(401, "bad_jwt", "invalid JWT"));
      const f: MockFactor = { id: `fac-${++seq}`, friendly_name: String(body.friendly_name ?? "Authenticator"), factor_type: "totp", status: "unverified", created_at: stamp(), updated_at: stamp() };
      u.factors.push(f);
      return route.fulfill(json(200, { id: f.id, type: "totp", friendly_name: f.friendly_name, totp: { qr_code: fakeQrSvg(seq), secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: `otpauth://totp/Trade%20Journal:${u.email}?secret=JBSWY3DPEHPK3PXP` } }));
    }
    const factorRoute = /^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(path);
    if (factorRoute) {
      const u = userOf(auth);
      const f = u?.factors.find((x) => x.id === factorRoute[1]);
      if (!u || !f) return route.fulfill(authErr(404, "mfa_factor_not_found", "Factor not found"));
      if (method === "DELETE") {
        u.factors = u.factors.filter((x) => x !== f);
        return route.fulfill(json(200, { id: f.id }));
      }
      if (factorRoute[2] === "challenge") return route.fulfill(json(200, { id: `ch-${++seq}`, type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 }));
      if (factorRoute[2] === "verify") {
        if (body.code !== TOTP_CODE) return route.fulfill(authErr(422, "mfa_verification_failed", "Invalid TOTP code entered"));
        f.status = "verified";
        const c = claimsOf(auth);
        return route.fulfill(json(200, newSession(u, "aal2", String(c?.session_id ?? `sess-${++seq}`))));
      }
    }

    /* ---------------- PostgREST ---------------- */
    const u = userOf(auth);
    if (path === "/rest/v1/journal_docs") {
      if (!u) return route.fulfill(json(401, { code: "PGRST301", message: "JWT expired" }));
      const mfaOk = !u.factors.some((f) => f.status === "verified") || claimsOf(auth)?.aal === "aal2";
      if (method === "GET") {
        let list = [...rows.values()].filter((r) => r.user_id === u.id && mfaOk && matches(r as unknown as Record<string, unknown>, url.searchParams));
        list.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        list = list.slice(offset, offset + limit);
        return route.fulfill(json(200, list.map(pick)));
      }
      if (!mfaOk) return route.fulfill(json(403, { code: "42501", message: "new row violates row-level security policy" }));
      if (method === "POST") {
        const prefer = req.headers()["prefer"] ?? "";
        const items = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
        const out: MockRow[] = [];
        for (const it of items) {
          const key = rowKey(u.id, String(it.kind), String(it.id));
          if (!/merge-duplicates/.test(prefer) && rows.has(key)) return route.fulfill(json(409, { code: "23505", message: "duplicate key value violates unique constraint" }));
          const existed = rows.has(key);
          const row = put(u.id, String(it.kind), String(it.id), it.data, it.deleted === true, (it.client_updated_at as string | null) ?? null);
          out.push(row);
          pushRealtime(row, existed ? "UPDATE" : "INSERT");
        }
        return route.fulfill(json(201, out.map(pick)));
      }
      if (method === "PATCH") {
        const out: MockRow[] = [];
        for (const r of [...rows.values()]) {
          if (r.user_id !== u.id || !matches(r as unknown as Record<string, unknown>, url.searchParams)) continue;
          const row = put(u.id, r.kind, r.id, body.data ?? r.data, body.deleted === true, (body.client_updated_at as string | null) ?? null);
          out.push(row);
          pushRealtime(row, "UPDATE");
        }
        return route.fulfill(json(200, out.map(pick)));
      }
    }
    if (path === "/rest/v1/profiles") {
      if (!u) return route.fulfill(json(401, { code: "PGRST301", message: "JWT expired" }));
      if (method === "GET") return route.fulfill(json(200, [{ privacy: u.privacy }]));
      if (method === "PATCH") {
        u.privacy = (body.privacy as Record<string, unknown>) ?? u.privacy;
        return route.fulfill({ status: 204, headers: CORS });
      }
    }
    if (path === "/rest/v1/rpc/my_sessions") {
      if (!u) return route.fulfill(json(401, { code: "PGRST301", message: "JWT expired" }));
      const current = String(claimsOf(auth)?.session_id ?? "");
      const list = [
        { id: current || "sess-current", created_at: "2026-10-12T07:00:00Z", updated_at: new Date().toISOString(), refreshed_at: new Date().toISOString(), user_agent: req.headers()["user-agent"] ?? "", ip: "192.168.178.x", aal: "aal1", is_current: true },
        ...Array.from({ length: opts.otherSessions ?? 2 }, (_, i) => ({
          id: `sess-other-${i}`,
          created_at: "2026-10-01T07:00:00Z",
          updated_at: new Date(Date.now() - (i + 1) * 47 * 60_000).toISOString(),
          refreshed_at: new Date(Date.now() - (i + 1) * 47 * 60_000).toISOString(),
          user_agent: i === 0 ? "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36" : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          ip: i === 0 ? "192.168.178.x" : "91.64.12.x",
          aal: "aal1",
          is_current: false,
        })),
      ];
      return route.fulfill(json(200, list));
    }
    return route.fulfill(json(404, { code: "PGRST000", message: `mock: no route for ${method} ${path}` }));
  });

  /* ---------------- functions ---------------- */
  if (opts.functions !== false) {
    await page.route(/\/api\/v1\//, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const u = userOf(req.headers()["authorization"]);
      const send = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/api/v1/log") {
        logs.push(req.postDataJSON());
        return send(202, { stored: true });
      }
      if (!u) return send(401, { error: { code: "unauthenticated", message: "Bitte melde dich an." } });
      const live = [...rows.values()].filter((r) => r.user_id === u.id && !r.deleted);
      const backup = () => ({
        exportedAt: new Date().toISOString(),
        settings: live.find((r) => r.kind === "settings")?.data,
        trades: live.filter((r) => r.kind === "trade").map((r) => ({ ...(r.data as object), id: r.id })),
        hyblock: live.filter((r) => r.kind === "hyblock").map((r) => ({ ...(r.data as object), id: r.id })),
        days: Object.fromEntries(live.filter((r) => r.kind === "day").map((r) => [r.id, r.data])),
      });
      if (url.pathname === "/api/v1/account/export") {
        audit.push({ action: "account.export", at: new Date().toISOString() });
        return send(200, { format: "trade-journal-account-export", version: 1, exportedAt: new Date().toISOString(), account: { id: u.id, email: u.email }, journal: backup(), tables: {}, files: { screenshots: [], backups: [] } });
      }
      if (url.pathname === "/api/v1/account/delete") {
        const b = req.postDataJSON() as { confirm?: string };
        if (b.confirm !== "LÖSCHEN") return send(422, { error: { code: "confirm_mismatch", message: "Bitte tippe LÖSCHEN zur Bestätigung." } });
        deletedAccounts.push(u.id);
        for (const [k, r] of rows) if (r.user_id === u.id) rows.delete(k);
        users.splice(users.indexOf(u), 1);
        return send(200, { deleted: true, canceledSubscriptions: 0, files: { screenshots: 0, backups: 2 } });
      }
      if (url.pathname === "/api/v1/account/backups") {
        const day = url.searchParams.get("day");
        if (!day) return send(200, { items: [{ day: "2026-10-11", size: 48_213 }, { day: "2026-10-10", size: 47_902 }] });
        return send(200, backup());
      }
      if (url.pathname === "/api/v1/audit") {
        if (req.method() === "POST") {
          audit.push({ action: String((req.postDataJSON() as { action?: string }).action), at: new Date().toISOString() });
          return send(201, { ok: true });
        }
        return send(200, { items: [...audit].reverse().slice(0, 8).map((a, i) => ({ id: audit.length - i, action: a.action, meta: {}, at: a.at })), next: null });
      }
      return send(404, { error: { code: "not_found", message: "Nicht gefunden." } });
    });
  }

  return {
    rows,
    users,
    audit,
    logs,
    calls,
    deletedAccounts,
    async emit(kind, id, data, deleted = false) {
      const userId = users[0]!.id;
      const existed = rows.has(rowKey(userId, kind, id));
      const row = put(userId, kind, id, data, deleted);
      pushRealtime(row, existed ? "UPDATE" : "INSERT");
      return row;
    },
    live(key) {
      const r = rows.get(`${users[0]?.id}|${key}`);
      return r && !r.deleted ? r.data : undefined;
    },
  };
}
