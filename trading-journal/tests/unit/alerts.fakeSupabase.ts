/**
 * A small in-memory Supabase for the alarm functions' HTTP tests: tables with the PostgREST calls the functions use (`select / insert / upsert /
 * update / delete` with `eq neq is in not lt order limit maybeSingle`, the two embeds `alert_deliveries(...)` / `alert_events(...)`), the
 * `rate_hit` counter, `alert_phone_revoke`, and the auth calls (`getClaims`, `admin.getUserById`, `mfa.listFactors`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  hits: Map<string, number>;
  claims: Record<string, unknown> | null;
  user: { email: string | null; confirmed: boolean };
  /** forces an error code on the next write to this table */
  failWrite: Map<string, string>;
}

export function newDb(): FakeDb {
  return { tables: {}, hits: new Map(), claims: null, user: { email: "trader@example.test", confirmed: true }, failWrite: new Map() };
}

const keyOf = (table: string): string[] => (table === "alert_events" || table === "alert_deliveries" ? ["id"] : table === "app_config" ? ["key"] : table === "profiles" ? ["id"] : ["user_id"]);

class Q implements PromiseLike<{ data: unknown; error: { code: string } | null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private conflict = "";
  private lim = Infinity;
  private ord: { col: string; asc: boolean } | null = null;
  private single = false;
  private cols = "*";
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select(cols = "*"): this {
    this.cols = cols;
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(row: Row, o?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = row;
    this.conflict = o?.onConflict ?? keyOf(this.table)[0]!;
    return this;
  }
  update(row: Row): this {
    this.op = "update";
    this.payload = row;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown): this {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown): this {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  is(c: string, v: null): this {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, v: unknown[]): this {
    this.filters.push((r) => v.includes(r[c]));
    return this;
  }
  not(c: string, _op: string, v: null): this {
    this.filters.push((r) => (r[c] ?? null) !== v);
    return this;
  }
  lt(c: string, v: string): this {
    this.filters.push((r) => String(r[c]) < v);
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  order(col: string, o: { ascending: boolean }): this {
    this.ord = { col, asc: o.ascending };
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }
  then<T1, T2>(ok?: ((v: { data: unknown; error: { code: string } | null }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): { data: unknown; error: { code: string } | null } {
    const rows = (this.db.tables[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op !== "select") {
      const code = this.db.failWrite.get(this.table);
      if (code) {
        this.db.failWrite.delete(this.table);
        return { data: null, error: { code } };
      }
    }
    if (this.op === "insert") {
      rows.push({ id: `${this.table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...this.payload! });
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const i = rows.findIndex((r) => r[this.conflict] === this.payload![this.conflict]);
      if (i >= 0) rows[i] = { ...rows[i], ...this.payload! };
      else rows.push({ ...this.payload! });
      return this.uniqueVerified(rows);
    }
    if (this.op === "update") {
      for (const r of rows.filter(match)) Object.assign(r, this.payload!);
      return this.uniqueVerified(rows);
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !match(r));
      return { data: null, error: null };
    }
    let out = rows.filter(match);
    if (this.ord) out = [...out].sort((a, b) => (String(a[this.ord!.col]) < String(b[this.ord!.col]) ? -1 : 1) * (this.ord!.asc ? 1 : -1));
    out = out.slice(0, this.lim).map((r) => this.embed(r));
    return { data: this.single ? (out[0] ?? null) : out, error: null };
  }
  /** the partial unique index of `alert_phone_secrets (number_hash) where verified` */
  private uniqueVerified(rows: Row[]): { data: unknown; error: { code: string } | null } {
    if (this.table !== "alert_phone_secrets") return { data: null, error: null };
    const v = rows.filter((r) => r.verified === true);
    return new Set(v.map((r) => r.number_hash)).size === v.length ? { data: null, error: null } : { data: null, error: { code: "23505" } };
  }
  private embed(r: Row): Row {
    if (this.cols.includes("alert_deliveries(")) return { ...r, alert_deliveries: (this.db.tables.alert_deliveries ?? []).filter((d) => d.event_id === r.id) };
    if (this.cols.includes("alert_events(")) return { ...r, alert_events: (this.db.tables.alert_events ?? []).find((e) => e.id === r.event_id) ?? null };
    return r;
  }
}

export function fakeSupabase(db: FakeDb): SupabaseClient {
  return {
    from: (t: string) => new Q(db, t),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "rate_hit") {
        const k = String(args.p_key);
        db.hits.set(k, (db.hits.get(k) ?? 0) + 1);
        return { data: db.hits.get(k), error: null };
      }
      if (name === "alert_phone_revoke") {
        const u = args.p_user;
        for (const r of db.tables.alert_phones ?? []) if (r.user_id === u) r.status = "revoked";
        db.tables.alert_phone_secrets = (db.tables.alert_phone_secrets ?? []).filter((r) => r.user_id !== u);
        return { data: 0, error: null };
      }
      return { data: null, error: { code: "42883" } };
    },
    auth: {
      getClaims: async () => (db.claims ? { data: { claims: db.claims }, error: null } : { data: null, error: { message: "bad" } }),
      admin: {
        getUserById: async () => ({ data: { user: db.user.email ? { email: db.user.email, email_confirmed_at: db.user.confirmed ? "2026-01-01" : null } : null }, error: null }),
        mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) },
      },
    },
  } as unknown as SupabaseClient;
}
