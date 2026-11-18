/**
 * In-process fake of the Supabase project + the P09 Netlify functions, WITHOUT any transport (Paket S: extracted from
 * `tests/e2e/mocks/supabase.ts`, which is now only the Playwright adapter around it; the Showroom's fetch interceptor is the other).
 *
 * Answered here: GoTrue (`/auth/v1/*`: password, signup, magic link, reset, refresh, PKCE code exchange, user, logout, TOTP factors /
 * challenge / verify), PostgREST (`/rest/v1/journal_docs` with server-stamped `rev` / `updated_at`, upsert, optimistic settings update;
 * `profiles`; `rpc/my_sessions`), Realtime (Phoenix v2 frames over an abstract connection: join → postgres_changes binding, heartbeat;
 * `emit()` pushes a change like another device would) and the functions under `/api/v1/*` (export, delete, backups, audit, log, flags).
 *
 * Showroom additions (all off unless asked for, so the e2e behaviour is unchanged): `mailbox` records the mails the real project would send
 * (confirmation, magic link, reset) instead of dropping them – `openMail()` is the "Bestätigungslink simulieren" of the demo – and the PKCE
 * exchange (`grant_type=pkce`) hands the session to whoever comes back with that code; `realClock` stamps rows and accounts with the real time;
 * `snapshot()` / `restore` carry the state across the page loads of a demo (it lives in the page, a reload would otherwise forget it).
 */
import { b64url, CORS, fnRes, fromB64url, jsonRes, type MockReq, type MockRes } from "./http";

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

export interface MockFactor {
  id: string;
  friendly_name: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  created_at: string;
  updated_at: string;
}

export interface MockUser {
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
  /** Subscription state the deletion plan reports (default `none`). */
  subscription?: "none" | "running" | "ending";
  /** The operator's `KILL_SYNC` switch as `/api/v1/flags` reports it. */
  syncOff?: boolean;
  /** Showroom: record the mails (`mails`) and take unknown addresses of a magic link as new accounts. */
  mailbox?: boolean;
  /** Showroom: stamp with the real clock and the real date of creation. */
  realClock?: boolean;
  /**
   * Showroom: rows of the first user (and the `copyTo` accounts) that are read from the live journal at the FIRST journal request – so they are
   * exactly what the device's journal looks like after the app normalised it, and a sign-in finds nothing to ask about.
   */
  lazyDocs?: { copyTo: number[]; get: () => Array<{ kind: string; id: string; data: unknown }> };
  /** Showroom: the state of an earlier page load (`snapshot()`); `users` / `docs` are then not seeded again. */
  restore?: SupabaseSnapshot;
  /** Showroom: called after every change of the state (the host saves a snapshot). */
  onChange?: () => void;
}

/** A mail the real project would have sent. */
export interface MockMail {
  id: string;
  kind: "confirm" | "magic" | "reset";
  email: string;
  /** the `redirect_to` of the request: where the link brings the person back (with `?order=` when the registration carried one) */
  redirectTo: string | null;
  at: string;
  /** the link was "clicked" (`openMail`) */
  opened: boolean;
}

export interface SupabaseSnapshot {
  users: MockUser[];
  rows: MockRow[];
  sessions: Array<[string, { userId: string; sessionId: string; aal: "aal1" | "aal2" }]>;
  codes: Array<[string, { userId: string }]>;
  audit: { action: string; at: string }[];
  recovery: { at: string | null; codes: { c: string; used: boolean }[] };
  mails: MockMail[];
  tick: number;
  seq: number;
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

/** One Realtime connection: the transport side only has to deliver strings. */
export interface RealtimeConn {
  send(frame: string): void;
}

export interface SupabaseCore extends MockSupabase {
  /** Answers a request to the Supabase project (`/auth/v1/*`, `/rest/v1/*`); the caller handles CORS preflight itself (`OPTIONS` → 204 here too). */
  handleSupabase(req: MockReq): MockRes;
  /** Answers `/api/v1/*` (the functions of this core); 404 JSON for anything else. */
  handleFunctions(req: MockReq): MockRes;
  /** Phoenix v2 frames of one Realtime connection. */
  realtime: { open(conn: RealtimeConn): { message(raw: string): void; close(): void } };
  /** The user a bearer token belongs to (`Authorization` header value). */
  userOf(auth: string | null | undefined): MockUser | null;
  /** Showroom: the recorded mails, newest last. */
  mails: MockMail[];
  /** Showroom: "clicks" a mail's link – confirms the address and returns the URL the link brings back (`redirect_to` + `code`). */
  openMail(id: string): { url: string; email: string } | null;
  /** Showroom: a complete, serialisable copy of the state. */
  snapshot(): SupabaseSnapshot;
  /** Showroom: a signed-in session of an existing account, in the shape supabase-js keeps in its storage (the demo starts signed in). */
  issueSession(email: string): Record<string, unknown> | null;
}

function jwt(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "e2e" }))}.${b64url(JSON.stringify(payload))}.${b64url("e2e-signature")}`;
}

export function claimsOf(auth: string | null | undefined): Record<string, unknown> | null {
  const token = auth?.replace(/^Bearer\s+/i, "") ?? "";
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(fromB64url(part)) as Record<string, unknown>;
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

export function createSupabaseCore(opts: MockSupabaseOptions = {}): SupabaseCore {
  const snap = opts.restore;
  let tick = snap?.tick ?? 0;
  let seq = snap?.seq ?? 0;
  const stamp = () => (opts.realClock ? new Date(Date.now() + ++tick).toISOString() : new Date(Date.UTC(2026, 9, 12, 8, 0, 0, 0) + ++tick * 1000).toISOString());
  const createdNow = () => (opts.realClock ? new Date().toISOString() : "2026-10-12T08:00:00Z");
  const changed = () => opts.onChange?.();
  const users: MockUser[] = snap
    ? snap.users.map((u) => ({ ...u, factors: u.factors.map((f) => ({ ...f })), privacy: { ...u.privacy } }))
    : (opts.users ?? [{ email: "trader@example.com", password: "richtig-geheim-42" }]).map((u, i) => ({
        id: `0000000${i + 1}-1111-4111-8111-11111111111${i + 1}`,
        email: u.email,
        password: u.password,
        confirmed: true,
        created_at: "2026-03-01T09:00:00Z",
        factors: u.mfa ? [{ id: `fac-${i}`, friendly_name: "Authenticator", factor_type: "totp" as const, status: "verified" as const, created_at: "2026-03-02T09:00:00Z", updated_at: "2026-03-02T09:00:00Z" }] : [],
        privacy: {},
      }));
  const rows = new Map<string, MockRow>();
  const sessions = new Map<string, { userId: string; sessionId: string; aal: "aal1" | "aal2" }>(snap?.sessions ?? []);
  const codes = new Map<string, { userId: string }>(snap?.codes ?? []);
  const audit: { action: string; at: string }[] = snap ? [...snap.audit] : [];
  const logs: unknown[] = [];
  const calls: string[] = [];
  const deletedAccounts: string[] = [];
  const recovery: { at: string | null; codes: { c: string; used: boolean }[] } = snap ? { at: snap.recovery.at, codes: snap.recovery.codes.map((c) => ({ ...c })) } : { at: null, codes: [] };
  const mails: MockMail[] = snap ? snap.mails.map((m) => ({ ...m })) : [];
  const sockets = new Set<{ conn: RealtimeConn; topic: string; joinRef: string; userId: string }>();

  const rowKey = (userId: string, kind: string, id: string) => `${userId}|${kind}:${id}`;
  const put = (userId: string, kind: string, id: string, data: unknown, deleted: boolean, clientAt?: string | null): MockRow => {
    const key = rowKey(userId, kind, id);
    const prev = rows.get(key);
    const row: MockRow = { user_id: userId, kind, id, data: JSON.parse(JSON.stringify(data ?? {})), deleted, rev: (prev?.rev ?? 0) + 1, updated_at: stamp(), client_updated_at: clientAt ?? null };
    rows.set(key, row);
    return row;
  };
  if (snap) for (const r of snap.rows) rows.set(rowKey(r.user_id, r.kind, r.id), { ...r });
  else for (const d of opts.docs ?? []) put(users[0]!.id, d.kind, d.id, d.data, !!d.deleted);

  let lazyDone = !!snap || !opts.lazyDocs;
  const seedLazy = () => {
    if (lazyDone || !opts.lazyDocs) return;
    lazyDone = true;
    for (const d of opts.lazyDocs.get()) {
      put(users[0]!.id, d.kind, d.id, d.data, false);
      for (const i of opts.lazyDocs.copyTo) if (users[i]) put(users[i]!.id, d.kind, d.id, d.data, false);
    }
    changed();
  };

  const userJson = (u: MockUser) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.confirmed ? "2026-03-01T09:05:00Z" : null,
    confirmed_at: u.confirmed ? "2026-03-01T09:05:00Z" : null,
    last_sign_in_at: opts.realClock ? new Date().toISOString() : "2026-10-12T08:00:00Z",
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
    changed();
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

  const authErr = (status: number, code: string, msg: string): MockRes => jsonRes(status, { code: status, error_code: code, msg });

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
      s.conn.send(JSON.stringify([null, null, s.topic, "postgres_changes", payload]));
    }
  };

  const realtime: SupabaseCore["realtime"] = {
    open(conn) {
      return {
        message(raw) {
          let msg: unknown;
          try {
            msg = JSON.parse(raw);
          } catch {
            return;
          }
          if (!Array.isArray(msg)) return;
          const [joinRef, ref, topic, event, payload] = msg as [string | null, string | null, string, string, Record<string, unknown>];
          if (event === "heartbeat") conn.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
          else if (event === "phx_join") {
            const cfg = (payload?.config ?? {}) as { postgres_changes?: Array<{ event: string; schema: string; table: string; filter?: string }> };
            const bindings = (cfg.postgres_changes ?? []).map((b) => ({ ...b, id: 4242 }));
            const userId = /user_id=eq\.(.+)$/.exec(bindings[0]?.filter ?? "")?.[1] ?? "";
            sockets.add({ conn, topic, joinRef: joinRef ?? "", userId });
            conn.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]));
            conn.send(JSON.stringify([joinRef, null, topic, "system", { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes", channel: topic }]));
          } else if (event === "phx_leave") {
            for (const s of sockets) if (s.conn === conn && s.topic === topic) sockets.delete(s);
            conn.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
          } else if (ref) conn.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        },
        close() {
          for (const s of sockets) if (s.conn === conn) sockets.delete(s);
        },
      };
    },
  };

  const record = (kind: MockMail["kind"], email: string, redirectTo: string | null) => {
    if (!opts.mailbox) return;
    mails.push({ id: `mail-${++seq}`, kind, email, redirectTo, at: new Date().toISOString(), opened: false });
    changed();
  };

  const newUser = (email: string, password: string, confirmed: boolean): MockUser => {
    const n = users.length + 1;
    const u: MockUser = { id: `0000000${n}-2222-4222-8222-22222222222${n}`, email, password, confirmed, created_at: createdNow(), factors: [], privacy: {} };
    users.push(u);
    changed();
    return u;
  };

  function handleSupabase(req: MockReq): MockRes {
    const { method, url, body } = req;
    if (method === "OPTIONS") return { status: 204, headers: CORS };
    const path = url.pathname;
    calls.push(`${method} ${path}`);
    const auth = req.headers["authorization"];

    /* ---------------- auth ---------------- */
    if (path === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = users.find((x) => x.email === String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) return authErr(400, "invalid_credentials", "Invalid login credentials");
        if (!u.confirmed) return authErr(400, "email_not_confirmed", "Email not confirmed");
        return jsonRes(200, newSession(u, "aal1"));
      }
      if (grant === "refresh_token") {
        const s = sessions.get(String(body.refresh_token ?? ""));
        const u = s && users.find((x) => x.id === s.userId);
        if (!s || !u) return authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
        return jsonRes(200, newSession(u, s.aal, s.sessionId));
      }
      if (grant === "pkce") {
        // the code a mail link brought back (Showroom `openMail`): one use, then the session of that account
        const code = String(body.auth_code ?? "");
        const hit = codes.get(code);
        const u = hit && users.find((x) => x.id === hit.userId);
        if (!hit || !u) return authErr(400, "flow_state_not_found", "invalid flow state, no valid flow state found");
        codes.delete(code);
        changed();
        return jsonRes(200, newSession(u, "aal1"));
      }
      return authErr(400, "validation_failed", "unsupported grant");
    }
    if (path === "/auth/v1/user") {
      const u = userOf(auth);
      if (!u) return authErr(401, "bad_jwt", "invalid JWT");
      if (method === "PUT" && typeof body.password === "string") {
        u.password = body.password;
        changed();
      }
      return jsonRes(200, userJson(u));
    }
    if (path === "/auth/v1/logout") return { status: 204, headers: CORS };
    if (path === "/auth/v1/signup") {
      const email = String(body.email ?? "").toLowerCase();
      const existing = users.find((x) => x.email === email);
      if (existing) return jsonRes(200, { ...userJson(existing), identities: [] });
      const u = newUser(email, String(body.password ?? ""), !opts.signupConfirm);
      if (opts.signupConfirm) record("confirm", email, url.searchParams.get("redirect_to"));
      return jsonRes(200, opts.signupConfirm ? userJson(u) : newSession(u, "aal1"));
    }
    if (path === "/auth/v1/otp") {
      const email = String(body.email ?? "").toLowerCase();
      if (opts.mailbox && email) {
        if (!users.some((x) => x.email === email) && body.create_user !== false) newUser(email, "", true);
        record("magic", email, url.searchParams.get("redirect_to"));
      }
      return jsonRes(200, {});
    }
    if (path === "/auth/v1/recover") {
      const email = String(body.email ?? "").toLowerCase();
      if (users.some((x) => x.email === email)) record("reset", email, url.searchParams.get("redirect_to"));
      return jsonRes(200, {});
    }
    if (path === "/auth/v1/resend") {
      const email = String(body.email ?? "").toLowerCase();
      if (users.some((x) => x.email === email)) record("confirm", email, url.searchParams.get("redirect_to"));
      return jsonRes(200, {});
    }
    if (path === "/auth/v1/factors" && method === "POST") {
      const u = userOf(auth);
      if (!u) return authErr(401, "bad_jwt", "invalid JWT");
      const f: MockFactor = { id: `fac-${++seq}`, friendly_name: String(body.friendly_name ?? "Authenticator"), factor_type: "totp", status: "unverified", created_at: stamp(), updated_at: stamp() };
      u.factors.push(f);
      changed();
      return jsonRes(200, { id: f.id, type: "totp", friendly_name: f.friendly_name, totp: { qr_code: fakeQrSvg(seq), secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: `otpauth://totp/Trade%20Journal:${u.email}?secret=JBSWY3DPEHPK3PXP` } });
    }
    const factorRoute = /^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(path);
    if (factorRoute) {
      const u = userOf(auth);
      const f = u?.factors.find((x) => x.id === factorRoute[1]);
      if (!u || !f) return authErr(404, "mfa_factor_not_found", "Factor not found");
      if (method === "DELETE") {
        u.factors = u.factors.filter((x) => x !== f);
        changed();
        return jsonRes(200, { id: f.id });
      }
      if (factorRoute[2] === "challenge") return jsonRes(200, { id: `ch-${++seq}`, type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
      if (factorRoute[2] === "verify") {
        if (body.code !== TOTP_CODE) return authErr(422, "mfa_verification_failed", "Invalid TOTP code entered");
        f.status = "verified";
        const c = claimsOf(auth);
        return jsonRes(200, newSession(u, "aal2", String(c?.session_id ?? `sess-${++seq}`)));
      }
    }

    /* ---------------- PostgREST ---------------- */
    const u = userOf(auth);
    if (path === "/rest/v1/journal_docs") {
      seedLazy();
      if (!u) return jsonRes(401, { code: "PGRST301", message: "JWT expired" });
      const mfaOk = !u.factors.some((f) => f.status === "verified") || claimsOf(auth)?.aal === "aal2";
      if (method === "GET") {
        let list = [...rows.values()].filter((r) => r.user_id === u.id && mfaOk && matches(r as unknown as Record<string, unknown>, url.searchParams));
        list.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        list = list.slice(offset, offset + limit);
        return jsonRes(200, list.map(pick));
      }
      if (!mfaOk) return jsonRes(403, { code: "42501", message: "new row violates row-level security policy" });
      if (method === "POST") {
        const prefer = req.headers["prefer"] ?? "";
        const items = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
        const out: MockRow[] = [];
        for (const it of items) {
          const key = rowKey(u.id, String(it.kind), String(it.id));
          if (!/merge-duplicates/.test(prefer) && rows.has(key)) return jsonRes(409, { code: "23505", message: "duplicate key value violates unique constraint" });
          const existed = rows.has(key);
          const row = put(u.id, String(it.kind), String(it.id), it.data, it.deleted === true, (it.client_updated_at as string | null) ?? null);
          out.push(row);
          pushRealtime(row, existed ? "UPDATE" : "INSERT");
        }
        changed();
        return jsonRes(201, out.map(pick));
      }
      if (method === "PATCH") {
        const out: MockRow[] = [];
        for (const r of [...rows.values()]) {
          if (r.user_id !== u.id || !matches(r as unknown as Record<string, unknown>, url.searchParams)) continue;
          const row = put(u.id, r.kind, r.id, body.data ?? r.data, body.deleted === true, (body.client_updated_at as string | null) ?? null);
          out.push(row);
          pushRealtime(row, "UPDATE");
        }
        changed();
        return jsonRes(200, out.map(pick));
      }
    }
    if (path === "/rest/v1/profiles") {
      if (!u) return jsonRes(401, { code: "PGRST301", message: "JWT expired" });
      if (method === "GET") return jsonRes(200, [{ privacy: u.privacy }]);
      if (method === "PATCH") {
        u.privacy = (body.privacy as Record<string, unknown>) ?? u.privacy;
        changed();
        return { status: 204, headers: CORS };
      }
    }
    if (path === "/rest/v1/rpc/my_sessions") {
      if (!u) return jsonRes(401, { code: "PGRST301", message: "JWT expired" });
      const current = String(claimsOf(auth)?.session_id ?? "");
      const list = [
        { id: current || "sess-current", created_at: "2026-10-12T07:00:00Z", updated_at: new Date().toISOString(), refreshed_at: new Date().toISOString(), user_agent: req.headers["user-agent"] ?? "", ip: "192.168.178.x", aal: "aal1", is_current: true },
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
      return jsonRes(200, list);
    }
    return jsonRes(404, { code: "PGRST000", message: `mock: no route for ${method} ${path}` });
  }

  function handleFunctions(req: MockReq): MockRes {
    const { url, body } = req;
    const u = userOf(req.headers["authorization"]);
    const send = fnRes;
    if (url.pathname === "/api/v1/log") {
      logs.push(body);
      return send(202, { stored: true });
    }
    if (url.pathname === "/api/v1/flags") return send(200, { switches: { sync: !!opts.syncOff, calls: false, ai: false, checkout: false } });
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
    if (url.pathname === "/api/v1/account/mfa-recovery") {
      if (req.method === "GET") return send(200, { total: recovery.codes.length, remaining: recovery.codes.filter((c) => !c.used).length, createdAt: recovery.at });
      const b = body as { action?: string; code?: string };
      if (b.action === "generate") {
        if (!u.factors.some((f) => f.status === "verified")) return send(409, { error: { code: "mfa_not_enabled", message: "Richte zuerst den Zwei-Faktor-Schutz ein." } });
        recovery.at = new Date().toISOString();
        recovery.codes = ["ABCDE-FGHJK", "KMNPQ-RSTUV", "WXYZ2-34567", "89ABC-DEFGH", "JKLMN-PQRST", "UVWXY-Z2345", "67892-ABCDE", "FGHJK-LMNPQ"].map((c) => ({ c, used: false }));
        changed();
        return send(200, { codes: recovery.codes.map((x) => x.c), createdAt: recovery.at });
      }
      const hit = recovery.codes.find((x) => !x.used && x.c.replace("-", "") === String(b.code ?? "").toUpperCase().replace(/[\s-]/g, ""));
      if (!hit) return send(422, { error: { code: "invalid_code", message: "Dieser Code passt nicht oder wurde schon benutzt." } });
      hit.used = true;
      const removed = u.factors.length;
      u.factors = [];
      recovery.codes = [];
      audit.push({ action: "auth.mfa.recovery.used", at: new Date().toISOString() });
      changed();
      return send(200, { factorsRemoved: removed });
    }
    if (url.pathname === "/api/v1/account/delete") {
      if (req.method === "GET") {
        const sub = opts.subscription ?? "none";
        return send(200, {
          confirmWord: "LÖSCHEN",
          subscription: { state: sub, plan: sub === "none" ? "free" : "pro", status: sub === "none" ? "none" : "active", currentPeriodEnd: sub === "none" ? null : "2026-12-01T00:00:00Z", cancelAtPeriodEnd: sub === "ending" },
          data: { trades: live.filter((r) => r.kind === "trade").length, hyblock: 0, days: live.filter((r) => r.kind === "day").length, screenshots: 3, backups: 2 },
        });
      }
      const b = body as { confirm?: string; acknowledgeSubscription?: boolean };
      if (b.confirm !== "LÖSCHEN") return send(422, { error: { code: "confirm_mismatch", message: "Bitte tippe LÖSCHEN zur Bestätigung." } });
      if ((opts.subscription ?? "none") !== "none" && b.acknowledgeSubscription !== true) return send(409, { error: { code: "subscription_ack_required", message: "Dein Abo läuft noch." } });
      deletedAccounts.push(u.id);
      for (const [k, r] of rows) if (r.user_id === u.id) rows.delete(k);
      users.splice(users.indexOf(u), 1);
      changed();
      return send(200, { deleted: true, canceledSubscriptions: 0, files: { screenshots: 0, backups: 2 } });
    }
    if (url.pathname === "/api/v1/account/backups") {
      const day = url.searchParams.get("day");
      if (!day) return send(200, { items: [{ day: "2026-10-11", size: 48_213 }, { day: "2026-10-10", size: 47_902 }] });
      return send(200, backup());
    }
    if (url.pathname === "/api/v1/audit") {
      if (req.method === "POST") {
        audit.push({ action: String((body as { action?: string }).action), at: new Date().toISOString() });
        changed();
        return send(201, { ok: true });
      }
      return send(200, { items: [...audit].reverse().slice(0, 8).map((a, i) => ({ id: audit.length - i, action: a.action, meta: {}, at: a.at })), next: null });
    }
    return send(404, { error: { code: "not_found", message: "Nicht gefunden." } });
  }

  return {
    rows,
    users,
    audit,
    logs,
    calls,
    deletedAccounts,
    mails,
    handleSupabase,
    handleFunctions,
    realtime,
    userOf,
    async emit(kind, id, data, deleted = false) {
      const userId = users[0]!.id;
      const existed = rows.has(rowKey(userId, kind, id));
      const row = put(userId, kind, id, data, deleted);
      pushRealtime(row, existed ? "UPDATE" : "INSERT");
      changed();
      return row;
    },
    live(key) {
      const r = rows.get(`${users[0]?.id}|${key}`);
      return r && !r.deleted ? r.data : undefined;
    },
    openMail(id) {
      const mail = mails.find((m) => m.id === id);
      const u = mail && users.find((x) => x.email === mail.email);
      if (!mail || !u) return null;
      if (mail.kind === "confirm") u.confirmed = true;
      mail.opened = true;
      const code = `demo-code-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      codes.set(code, { userId: u.id });
      const base = mail.redirectTo ?? "/";
      const url = `${base}${base.includes("?") ? "&" : "?"}code=${code}`;
      changed();
      return { url, email: mail.email };
    },
    issueSession(email) {
      const u = users.find((x) => x.email === email.toLowerCase());
      return u ? newSession(u, "aal1") : null;
    },
    snapshot() {
      return {
        users: JSON.parse(JSON.stringify(users)) as MockUser[],
        rows: [...rows.values()].map((r) => ({ ...r })),
        sessions: [...sessions.entries()],
        codes: [...codes.entries()],
        audit: [...audit],
        recovery: { at: recovery.at, codes: recovery.codes.map((c) => ({ ...c })) },
        mails: mails.map((m) => ({ ...m })),
        tick,
        seq,
      };
    },
  };
}
