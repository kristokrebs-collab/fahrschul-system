/**
 * Versions of the saved rule drafts (F15), kept in the browser next to the drafts (`storageKey("labor-draft-versions")`,
 * versioned wrapper, a convenience like the drafts themselves: it works without it). The pure rules (diff, limits, reading)
 * are `@/domain/lab/versions`; `laborStore` calls `recordVersion` whenever a draft is saved.
 */
import { create } from "zustand";
import { addVersion, parseVersions, setNote, trimTotal, VERSIONS_FORMAT, type DraftVersion, type VersionMap } from "@/domain/lab/versions";
import type { CustomConfig } from "@/domain/lab";
import { storageKey } from "@/store/storage";

const KEY = storageKey("labor-draft-versions");

function read(): VersionMap {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? parseVersions(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function write(map: VersionMap): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: VERSIONS_FORMAT, items: map }));
  } catch {
    /* private mode / quota: works without remembering */
  }
}

interface VersionsState {
  map: VersionMap;
  /** a version of `config` for the draft when it differs from the newest one; returns the new version or null */
  record(draftId: string, config: CustomConfig, note?: string, at?: number): DraftVersion | null;
  setNote(draftId: string, n: number, note: string): void;
  drop(draftId: string): void;
  /** a first version for every draft that has none (drafts saved before versions existed) */
  seed(drafts: readonly { id: string; savedAt: number; config: CustomConfig }[]): void;
}

export const useVersions = create<VersionsState>()((set, get) => ({
  map: read(),
  record(draftId, config, note = "", at = Date.now()) {
    const list = get().map[draftId] ?? [];
    const next = addVersion(list, config, at, note);
    if (next === list) return null;
    const map = trimTotal({ ...get().map, [draftId]: next });
    write(map);
    set({ map });
    return next[next.length - 1] ?? null;
  },
  setNote(draftId, n, note) {
    const list = get().map[draftId];
    if (!list) return;
    const map = { ...get().map, [draftId]: setNote(list, n, note) };
    write(map);
    set({ map });
  },
  drop(draftId) {
    if (!(draftId in get().map)) return;
    const { [draftId]: _gone, ...rest } = get().map;
    void _gone;
    write(rest);
    set({ map: rest });
  },
  seed(drafts) {
    let map = get().map;
    for (const d of drafts) {
      if (map[d.id]?.length) continue;
      map = trimTotal({ ...map, [d.id]: addVersion([], d.config, d.savedAt, "Stand vor der Versionierung") });
    }
    if (map !== get().map) {
      write(map);
      set({ map });
    }
  },
}));

/** The newest version of a draft, or null. */
export const latestVersion = (draftId: string): DraftVersion | null => useVersions.getState().map[draftId]?.at(-1) ?? null;

/** Test hook. */
export function __resetVersions(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  useVersions.setState({ map: {} });
}
