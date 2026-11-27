/**
 * `journal_docs` access for the sync engine (P09). The engine only sees `RemoteJournal`; `createSupabaseRemote` is the
 * PostgREST + Realtime implementation (RLS limits every call to the signed-in user), tests use an in-memory fake.
 * Lives in the lazy cloud chunk (only `import type` from supabase-js here).
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { DOC_COLUMNS, SETTINGS_ID, type DocKind, type DocRow } from "./docs";

export interface UpsertDoc {
  kind: DocKind;
  id: string;
  data: unknown;
  deleted: boolean;
  /** The record's own `updatedAt` (or the deletion time) – informational column. */
  clientUpdatedAt?: string | null;
}

export type SettingsWrite = { ok: true; row: DocRow } | { ok: false; current: DocRow | null };

export type RealtimeStatus = "live" | "down";

export interface RemoteJournal {
  /** Every row of the user (tombstones included). */
  pullAll(): Promise<DocRow[]>;
  /** Rows written after `since` (server time, ISO) – catch-up after a realtime gap. */
  pullSince(since: string): Promise<DocRow[]>;
  /** Upserts rows (never settings); resolves with the stored rows. */
  upsert(docs: readonly UpsertDoc[]): Promise<DocRow[]>;
  /** Optimistic settings write: insert when `expectedRev` is null, else update where rev = expectedRev. */
  writeSettings(data: unknown, expectedRev: number | null, clientUpdatedAt: string): Promise<SettingsWrite>;
  /** Realtime row stream of the user (INSERT/UPDATE); returns the unsubscribe. */
  subscribe(onRow: (row: DocRow) => void, onStatus: (s: RealtimeStatus) => void): () => void;
}

/** Network / server failure the engine retries later (offline, 5xx, timeouts). */
export class RemoteError extends Error {
  readonly retryable: boolean;
  readonly code: string | null;
  constructor(message: string, retryable: boolean, code: string | null = null) {
    super(message);
    this.name = "RemoteError";
    this.retryable = retryable;
    this.code = code;
  }
}

const PAGE = 1000;
const CHUNK = 200;

interface PgError {
  message?: string;
  code?: string;
  status?: number;
}

function fail(error: PgError | null | undefined, what: string): never {
  const code = error?.code ?? null;
  // PostgREST: 42501 = RLS refused (e.g. aal2 needed), PGRST301 = JWT expired; fetch failures have no code
  const retryable = !code || code === "PGRST301" || /^(08|53|57|58|XX)/.test(code) || /fetch|network|timeout/i.test(error?.message ?? "");
  throw new RemoteError(`${what}: ${error?.message ?? "failed"}`, retryable, code);
}

/** Supabase implementation for the signed-in user `userId`. */
export function createSupabaseRemote(sb: SupabaseClient, userId: string): RemoteJournal {
  const table = () => sb.from("journal_docs");

  async function paged(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError | null }>, what: string): Promise<DocRow[]> {
    const out: DocRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let res: { data: unknown; error: PgError | null };
      try {
        res = await build(from, from + PAGE - 1);
      } catch (e) {
        throw new RemoteError(`${what}: ${e instanceof Error ? e.message : "network"}`, true);
      }
      if (res.error) fail(res.error, what);
      const rows = (res.data ?? []) as DocRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  return {
    pullAll() {
      return paged((a, b) => table().select(DOC_COLUMNS).eq("user_id", userId).order("updated_at", { ascending: true }).order("kind").order("id").range(a, b), "pull");
    },
    pullSince(since) {
      return paged((a, b) => table().select(DOC_COLUMNS).eq("user_id", userId).gt("updated_at", since).order("updated_at", { ascending: true }).range(a, b), "pullSince");
    },
    async upsert(docs) {
      const out: DocRow[] = [];
      for (let i = 0; i < docs.length; i += CHUNK) {
        const rows = docs.slice(i, i + CHUNK).map((d) => ({
          user_id: userId,
          kind: d.kind,
          id: d.id,
          data: d.data,
          deleted: d.deleted,
          client_updated_at: d.clientUpdatedAt || null,
        }));
        let res: { data: unknown; error: PgError | null };
        try {
          res = await table().upsert(rows, { onConflict: "user_id,kind,id" }).select(DOC_COLUMNS);
        } catch (e) {
          throw new RemoteError(`upsert: ${e instanceof Error ? e.message : "network"}`, true);
        }
        if (res.error) fail(res.error, "upsert");
        out.push(...((res.data ?? []) as DocRow[]));
      }
      return out;
    },
    async writeSettings(data, expectedRev, clientUpdatedAt) {
      const row = { user_id: userId, kind: "settings", id: SETTINGS_ID, data, deleted: false, client_updated_at: clientUpdatedAt || null };
      let res: { data: unknown; error: PgError | null };
      try {
        res =
          expectedRev === null
            ? await table().insert(row).select(DOC_COLUMNS)
            : await table().update({ data, deleted: false, client_updated_at: row.client_updated_at }).eq("user_id", userId).eq("kind", "settings").eq("id", SETTINGS_ID).eq("rev", expectedRev).select(DOC_COLUMNS);
      } catch (e) {
        throw new RemoteError(`settings: ${e instanceof Error ? e.message : "network"}`, true);
      }
      // insert into an existing row → unique violation = somebody else was first
      if (res.error && res.error.code !== "23505") fail(res.error, "settings");
      const stored = (res.data ?? []) as DocRow[];
      if (!res.error && stored[0]) return { ok: true, row: stored[0] };
      let cur: { data: unknown; error: PgError | null };
      try {
        cur = await table().select(DOC_COLUMNS).eq("user_id", userId).eq("kind", "settings").eq("id", SETTINGS_ID).limit(1);
      } catch (e) {
        throw new RemoteError(`settings: ${e instanceof Error ? e.message : "network"}`, true);
      }
      if (cur.error) fail(cur.error, "settings");
      return { ok: false, current: ((cur.data ?? []) as DocRow[])[0] ?? null };
    },
    subscribe(onRow, onStatus) {
      let channel: RealtimeChannel | null = sb
        .channel(`journal-docs:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "journal_docs", filter: `user_id=eq.${userId}` }, (payload) => {
          const row = payload.new as Partial<DocRow> | undefined;
          if (row && typeof row.kind === "string" && typeof row.id === "string") onRow(row as DocRow);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onStatus("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus("down");
        });
      return () => {
        if (!channel) return;
        const c = channel;
        channel = null;
        void sb.removeChannel(c);
      };
    },
  };
}
