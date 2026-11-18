/**
 * Per-viewer choices of the Termine section (F43): the zone the times are shown in, which kinds of appointment are shown,
 * list or month. A convenience in `localStorage` (works without it, nothing here is data of the trader's journal).
 */
import { create } from "zustand";
import { deviceTimeZone, isValidTimeZone } from "@/domain/events/zone";
import { KIND_GROUPS, type KindGroup } from "@/domain/events/types";
import { storageKey } from "@/store/storage";

export type GroupId = KindGroup["id"];
export type TermineView = "liste" | "monat";

const KEY = storageKey("termine");
export const DEFAULT_GROUPS: readonly GroupId[] = ["expiry", "fomc", "us", "own"];

interface Stored {
  v: 1;
  tz: string | null;
  groups: GroupId[];
  view: TermineView;
}

function read(): Stored {
  const d: Stored = { v: 1, tz: null, groups: [...DEFAULT_GROUPS], view: "liste" };
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Partial<Stored> | null;
    if (!raw || raw.v !== 1) return d;
    const groups = Array.isArray(raw.groups) ? KIND_GROUPS.map((g) => g.id).filter((id) => (raw.groups as unknown[]).includes(id)) : d.groups;
    return { v: 1, tz: isValidTimeZone(raw.tz) ? raw.tz : null, groups, view: raw.view === "monat" ? "monat" : "liste" };
  } catch {
    return d;
  }
}

function write(s: Stored): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota: works without remembering */
  }
}

interface State extends Stored {
  setTz(tz: string | null): void;
  toggleGroup(id: GroupId): void;
  setView(v: TermineView): void;
}

export const useTermine = create<State>()((set, get) => ({
  ...read(),
  setTz(tz) {
    set({ tz: tz && isValidTimeZone(tz) ? tz : null });
    const { v, groups, view } = get();
    write({ v, tz: get().tz, groups, view });
  },
  toggleGroup(id) {
    const cur = get().groups;
    const next = KIND_GROUPS.map((g) => g.id).filter((g) => (g === id ? !cur.includes(g) : cur.includes(g)));
    set({ groups: next });
    write({ v: 1, tz: get().tz, groups: next, view: get().view });
  },
  setView(view) {
    set({ view });
    write({ v: 1, tz: get().tz, groups: get().groups, view });
  },
}));

/** The zone in use: the chosen one, else the device's. */
export const useZone = (): string => useTermine((s) => s.tz) ?? deviceTimeZone();
