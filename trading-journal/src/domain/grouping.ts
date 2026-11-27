/**
 * Trade groups (Journal v3, P06) – pure, no React.
 *
 * Records belong together when
 * - they share a `positionId` (one position split over several records, e.g. an exchange import per partial close),
 * - they share a `groupId` (a free group the trader made),
 * - one names the other in `hedgeOf`, or
 * - (automatic hedge detection, opt-out) they are opposite sides of the same pair in the same account / venue and their
 *   time in the market overlaps.
 * Links are transitive (union-find); only groups with ≥ 2 members are reported. A trade without an exit time is held
 * from `date` until `now` while open and only for its entry minute once closed (no guessed holding time).
 */
import type { AccountId, Side } from "./types";

export type GroupKind = "position" | "group" | "hedge";

/** What grouping needs of a trade (works on `Trade` and `EnrichedTrade`). */
export interface GroupableTrade {
  id: string;
  side: Side;
  status: "open" | "closed";
  date: string;
  exitDate?: string;
  pair: string;
  account?: AccountId;
  exchange?: string;
  exchangeAccount?: string;
  positionId?: string;
  groupId?: string;
  hedgeOf?: string;
  pnl?: number | null;
  r?: number | null;
  risk?: number | null;
  createdAt?: string;
}

export interface TradeGroup<T extends GroupableTrade = GroupableTrade> {
  /** Stable id: `pos:<positionId>`, `grp:<groupId>` or `hedge:<first member id>`. */
  id: string;
  kind: GroupKind;
  /** Members in time order. */
  members: T[];
  /** "long" / "short" when every member points the same way, else "hedge". */
  side: Side | "hedge";
  /** Σ P&L of the members that have one; `null` when none has. */
  pnl: number | null;
  /** Σ risk of the members (`null` unless every member has one). */
  risk: number | null;
  /** `pnl ÷ risk` of the group. */
  r: number | null;
  /** Any member still open. */
  open: boolean;
  /** First entry / last known exit (ms). */
  from: number;
  to: number;
  /** German label, e.g. "Hedge · Long + Short", "Position · 3 Teile". */
  label: string;
  /** The hedge link was found automatically (no explicit field). */
  auto: boolean;
}

export interface GroupOptions {
  /** Automatic hedge detection (default true). */
  hedges?: boolean;
  /** Clock for open trades (ms). */
  now?: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Comparable pair: upper case, venue prefix / perp suffix / separators dropped (`BINANCE:BTCUSDT.P` → `BTCUSDT`). */
export function pairKey(pair: string): string {
  const s = (pair || "").trim();
  const bare = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s;
  return bare
    .toUpperCase()
    .replace(/\.P$|[-_]?PERP(ETUAL)?$|[-_]?SWAP$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Entry time (ms) of a trade (`date`, else `createdAt`). */
export function entryMs(t: Pick<GroupableTrade, "date" | "createdAt">): number {
  const v = new Date(t.date || t.createdAt || 0).getTime();
  return Number.isFinite(v) ? v : 0;
}

/** Exit time (ms): `exitDate` when known, `now` while open, else the entry minute (closed, exit time unknown). */
export function exitMs(t: Pick<GroupableTrade, "date" | "createdAt" | "exitDate" | "status">, now: number = Date.now()): number {
  const start = entryMs(t);
  if (t.exitDate) {
    const v = new Date(t.exitDate).getTime();
    if (Number.isFinite(v) && v >= start) return v;
  }
  return t.status === "open" ? Math.max(start, now) : start + 60_000;
}

class Union {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  join(a: string, b: string): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.parent.set(y, x);
  }
}

/**
 * An open trade older than this takes no part in the automatic detection: a position forgotten as "open" in the journal
 * would otherwise pair with every later trade of the other side (explicit `hedgeOf` still links it).
 */
export const STALE_OPEN_MS = 14 * 86_400_000;

/**
 * Automatic hedge pairs: opposite sides, same `pairKey`, same account (missing = scalp) and – when both name one – same
 * venue / venue account, overlapping time in the market. Sweep over the entry times, O(n log n + k).
 */
export function detectHedges<T extends GroupableTrade>(trades: readonly T[], now: number = Date.now()): [string, string][] {
  const items = trades
    .map((t) => ({ t, from: entryMs(t), to: exitMs(t, now), key: hedgeScope(t) }))
    .filter((x) => x.key !== "" && !(x.t.status === "open" && now - x.from > STALE_OPEN_MS))
    .sort((a, b) => a.from - b.from);
  const out: [string, string][] = [];
  const active: typeof items = [];
  for (const cur of items) {
    // drop everything that ended before this one starts (strict: touching intervals do not overlap)
    for (let i = active.length - 1; i >= 0; i--) if (active[i]!.to <= cur.from) active.splice(i, 1);
    for (const o of active) {
      if (o.key === cur.key && o.t.side !== cur.t.side && Math.min(o.to, cur.to) > Math.max(o.from, cur.from)) out.push([o.t.id, cur.t.id]);
    }
    active.push(cur);
  }
  return out;
}

function hedgeScope(t: GroupableTrade): string {
  const pair = pairKey(t.pair);
  if (!pair) return "";
  return [pair, t.account ?? "scalp", (t.exchange ?? "").toLowerCase(), t.exchangeAccount ?? ""].join("|");
}

/** All groups (≥ 2 members) of `trades` plus a lookup id → group. Trades keep their input objects. */
export function groupTrades<T extends GroupableTrade>(trades: readonly T[], opts: GroupOptions = {}): { groups: TradeGroup<T>[]; groupOf: Map<string, TradeGroup<T>> } {
  const now = opts.now ?? Date.now();
  const u = new Union();
  const byId = new Map(trades.map((t) => [t.id, t] as const));
  const firstBy = new Map<string, string>();
  const explicitHedge = new Set<string>();
  const autoHedge = new Set<string>();
  const link = (key: string, id: string) => {
    const first = firstBy.get(key);
    if (first) u.join(first, id);
    else firstBy.set(key, id);
  };
  for (const t of trades) {
    if (t.positionId) link(`pos:${t.positionId}`, t.id);
    if (t.groupId) link(`grp:${t.groupId}`, t.id);
    if (t.hedgeOf && byId.has(t.hedgeOf) && t.hedgeOf !== t.id) {
      u.join(t.hedgeOf, t.id);
      explicitHedge.add(t.id).add(t.hedgeOf);
    }
  }
  if (opts.hedges !== false) {
    for (const [a, b] of detectHedges(trades, now)) {
      if (u.find(a) === u.find(b)) continue;
      u.join(a, b);
      autoHedge.add(a).add(b);
    }
  }

  const buckets = new Map<string, T[]>();
  for (const t of trades) {
    const root = u.find(t.id);
    const list = buckets.get(root);
    if (list) list.push(t);
    else buckets.set(root, [t]);
  }

  const groups: TradeGroup<T>[] = [];
  const groupOf = new Map<string, TradeGroup<T>>();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const members = [...list].sort((a, b) => entryMs(a) - entryMs(b) || a.id.localeCompare(b.id));
    const sides = new Set(members.map((m) => m.side));
    const hedge = sides.size > 1;
    const posId = members.find((m) => m.positionId)?.positionId;
    const grpId = members.find((m) => m.groupId)?.groupId;
    const kind: GroupKind = hedge ? "hedge" : posId ? "position" : "group";
    const pnls = members.map((m) => m.pnl).filter(fin);
    const pnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null;
    const risk = members.every((m) => fin(m.risk) && m.risk > 0) ? members.reduce((a, m) => a + (m.risk as number), 0) : null;
    const id = kind === "position" ? `pos:${posId}` : kind === "group" ? `grp:${grpId ?? members[0]!.id}` : `hedge:${members[0]!.id}`;
    const g: TradeGroup<T> = {
      id,
      kind,
      members,
      side: hedge ? "hedge" : members[0]!.side,
      pnl,
      risk,
      r: pnl != null && risk ? pnl / risk : null,
      open: members.some((m) => m.status === "open"),
      from: Math.min(...members.map(entryMs)),
      to: Math.max(...members.map((m) => exitMs(m, now))),
      label: groupLabel(kind, members),
      auto: hedge && !members.some((m) => explicitHedge.has(m.id)) && members.some((m) => autoHedge.has(m.id)),
    };
    groups.push(g);
    for (const m of members) groupOf.set(m.id, g);
  }
  groups.sort((a, b) => a.from - b.from);
  return { groups, groupOf };
}

/** German group label. */
export function groupLabel(kind: GroupKind, members: readonly Pick<GroupableTrade, "side">[]): string {
  if (kind === "hedge") {
    const longs = members.filter((m) => m.side === "long").length;
    const shorts = members.length - longs;
    return `Hedge · ${longs > 1 ? `${longs}× ` : ""}Long + ${shorts > 1 ? `${shorts}× ` : ""}Short`;
  }
  if (kind === "position") return `Position · ${members.length} Teile`;
  return `Gruppe · ${members.length} Trades`;
}

/** One entry of a grouped list: a single trade or a whole group (at the position of its first listed member). */
export type GroupedRow<T extends GroupableTrade> = { kind: "trade"; trade: T } | { kind: "group"; group: TradeGroup<T> };

/**
 * The visible rows with their groups folded in: a group appears once, where its first member appears in `rows`
 * (the list's sort order is kept); its members are listed inside it in time order. Groups are built from `rows`
 * only, so a filter that leaves one member shows it as a plain trade.
 */
export function groupRows<T extends GroupableTrade>(rows: readonly T[], opts: GroupOptions = {}): GroupedRow<T>[] {
  const { groupOf } = groupTrades(rows, opts);
  const seen = new Set<string>();
  const out: GroupedRow<T>[] = [];
  for (const t of rows) {
    const g = groupOf.get(t.id);
    if (!g) {
      out.push({ kind: "trade", trade: t });
      continue;
    }
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push({ kind: "group", group: g });
  }
  return out;
}
