/**
 * Berichte page state (P04, per tab, in memory): the report kind, the chosen period (its stable key, `null` = the
 * newest finished period with trades), the focus of the sections and the direction of the last switch (the split
 * flap rolls down for an older period, up for a newer one; the strip wipe follows).
 *
 * Router seam for the integrator (P14): `#berichte?p=<key>` – `berichtePeriodFromQuery(query)` validates the key,
 * `openReport(key)` selects it (kind included), `berichteQuery(key)` builds the query for a link.
 */
import { create } from "zustand";
import { REPORT_KINDS, periodFromKey, type ReportFocus, type ReportKind } from "@/domain/reports";

export type FlapDir = "up" | "down";

interface BerichteState {
  kind: ReportKind;
  /** chosen period key (`null` = default: newest finished period with trades) */
  key: string | null;
  focus: ReportFocus;
  /** roll direction of the last period switch */
  dir: FlapDir;
  setKind: (kind: ReportKind) => void;
  setPeriod: (key: string, dir?: FlapDir) => void;
  setFocus: (focus: ReportFocus) => void;
  reset: () => void;
}

const INITIAL = { kind: "week" as ReportKind, key: null as string | null, focus: "all" as ReportFocus, dir: "up" as FlapDir };

export const useBerichteUi = create<BerichteState>()((set, get) => ({
  ...INITIAL,
  setKind: (kind) => {
    if (kind === get().kind) return;
    const dir: FlapDir = REPORT_KINDS.indexOf(kind) < REPORT_KINDS.indexOf(get().kind) ? "down" : "up";
    set({ kind, key: null, dir });
  },
  setPeriod: (key, dir) => {
    const p = periodFromKey(key);
    if (!p) return;
    set({ kind: p.kind, key: p.key, dir: dir ?? (get().key && get().key! > p.key ? "down" : "up") });
  },
  setFocus: (focus) => set({ focus }),
  reset: () => set(INITIAL),
}));

/** Query name of the deep link `#berichte?p=<key>`. */
export const BERICHTE_QUERY_KEY = "p";

/** `p=2026-W41` for a link to a report. */
export function berichteQuery(key: string): string {
  return `${BERICHTE_QUERY_KEY}=${encodeURIComponent(key)}`;
}

/** The valid period key of a `#berichte?…` query, or null. */
export function berichtePeriodFromQuery(query: string | null | undefined): string | null {
  if (!query) return null;
  const raw = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).get(BERICHTE_QUERY_KEY);
  return periodFromKey(raw)?.key ?? null;
}

/** Selects the report of `key` (kind included). False for an invalid key. */
export function openReport(key: string): boolean {
  const p = periodFromKey(key);
  if (!p) return false;
  useBerichteUi.getState().setPeriod(p.key);
  return true;
}
