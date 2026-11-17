/**
 * Per-viewer choices of the Transaktionsbuch (F70): the zone the book is read in and the matching scope. A convenience in
 * `localStorage` (works without it); the year and the flag filter live in the component.
 */
import { create } from "zustand";
import { deviceTimeZone, isValidTimeZone } from "@/domain/events/zone";
import type { Scope } from "@/domain/ledger";
import { storageKey } from "@/store/storage";

const KEY = storageKey("ledger");

interface Stored {
  v: 1;
  tz: string | null;
  scope: Scope;
}

function read(): Stored {
  const d: Stored = { v: 1, tz: null, scope: "position" };
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Partial<Stored> | null;
    if (!raw || raw.v !== 1) return d;
    return { v: 1, tz: isValidTimeZone(raw.tz) ? raw.tz : null, scope: raw.scope === "market" ? "market" : "position" };
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
  setScope(scope: Scope): void;
}

export const useLedgerPrefs = create<State>()((set, get) => ({
  ...read(),
  setTz(tz) {
    set({ tz: tz && isValidTimeZone(tz) ? tz : null });
    write({ v: 1, tz: get().tz, scope: get().scope });
  },
  setScope(scope) {
    set({ scope });
    write({ v: 1, tz: get().tz, scope });
  },
}));

/** The zone the book is read in: the chosen one, else the device's. */
export const useLedgerZone = (): string => useLedgerPrefs((s) => s.tz) ?? deviceTimeZone();
