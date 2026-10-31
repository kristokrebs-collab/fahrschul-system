/**
 * Actions on the versions of the drafts (F15) and the import of playbooks (F13 / F45) that touch the lab store: restoring a
 * version, saving the editor as a new version of a draft, adding a foreign playbook as a marked draft and the "Probe im
 * Labor" (puts the rules into the set-up and starts the run). Everything is the user's click; nothing runs by itself.
 */
import { nextSetupColor } from "@/domain/defaults";
import { sanitizeCustom, type CustomConfig } from "@/domain/lab";
import { playbookRelation, revisionNote, setupFromPlaybook, type Playbook, type PlaybookRelation } from "@/domain/playbook";
import { sanitizeSignalCfg } from "@/domain/signals";
import type { Setup } from "@/domain/types";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { startLab, useLabor, type CustomDraft, type DraftOrigin } from "./laborStore";
import { useVersions } from "./versionsStore";

/** Puts a version's rules back into the draft (a NEW version "Wiederhergestellt aus Version n") and into the editor. */
export function restoreVersion(draftId: string, n: number): boolean {
  const v = useVersions.getState().map[draftId]?.find((x) => x.n === n);
  const lab = useLabor.getState();
  if (!v || !lab.drafts.some((d) => d.id === draftId)) return false;
  lab.replaceDraftConfig(draftId, v.config);
  useVersions.getState().record(draftId, v.config, `Wiederhergestellt aus Version ${n}`);
  useLabor.getState().setCfg({ strategy: "custom", custom: v.config });
  return true;
}

export type SaveVersion = { ok: true; n: number | null } | { ok: false; reason: "gone" | "full" };

/** Saves the editor's idea into the draft `draftId` (under that draft's name); `n: null` = nothing had changed. */
export function saveEditorAsVersion(draftId: string, note: string): SaveVersion {
  const lab = useLabor.getState();
  const d = lab.drafts.find((x) => x.id === draftId);
  if (!d) return { ok: false, reason: "gone" };
  const before = useVersions.getState().map[draftId]?.at(-1)?.n ?? 0;
  const id = lab.saveDraft(d.name);
  if (id == null) return { ok: false, reason: "full" };
  const latest = useVersions.getState().map[draftId]?.at(-1);
  if (latest && latest.n > before && note.trim()) useVersions.getState().setNote(draftId, latest.n, note);
  return { ok: true, n: latest && latest.n > before ? latest.n : null };
}

/** What a draft remembers about the playbook it came from (F45): the id and revision, the author's note and checklist. */
export function originOf(pb: Playbook, now: number): DraftOrigin {
  return { kind: "playbook", title: pb.title, author: pb.author, importedAt: now, key: pb.key, ...(pb.id && pb.rev != null ? { pid: pb.id, rev: pb.rev } : {}), ...(pb.changes ? { changes: pb.changes } : {}), ...(pb.checklist.length ? { checklist: pb.checklist } : {}) };
}

/** Adds an imported playbook as a new draft that stays marked "fremd". */
export function addPlaybookDraft(pb: Playbook, now: number = Date.now()): string | null {
  return useLabor.getState().addForeignDraft(pb.title, pb.config, originOf(pb, now));
}

/** The draft that came from the same playbook (same id) as `pb` – the newest one when there are several; `null` = none. */
export function findPlaybookDraft(pb: Pick<Playbook, "id">): CustomDraft | null {
  if (!pb.id) return null;
  return useLabor.getState().drafts.find((d) => d.origin?.pid === pb.id) ?? null;
}

/** How a file relates to the draft it belongs to (`none` / `other` without one). */
export function relationOf(pb: Playbook, draft: CustomDraft | null): PlaybookRelation {
  if (!draft?.origin) return { kind: "none" };
  return playbookRelation({ pid: draft.origin.pid ?? null, rev: draft.origin.rev ?? null, key: draft.origin.key }, draft.config, pb);
}

/**
 * Takes a newer revision over into the draft it belongs to: the rules become a NEW version of that draft ("Fassung 2 von Anna: …", so
 * the change can be taken back with "Wiederherstellen"), the origin remembers the revision. Only on the reader's click; the draft's name stays.
 */
export function applyPlaybookUpdate(draftId: string, pb: Playbook, now: number = Date.now()): boolean {
  const lab = useLabor.getState();
  const d = lab.drafts.find((x) => x.id === draftId);
  if (!d?.origin) return false;
  const config = sanitizeCustom({ ...pb.config, name: d.name });
  if (!lab.replaceDraftConfig(draftId, config)) return false;
  useVersions.getState().record(draftId, config, revisionNote(pb), now);
  lab.setDraftOrigin(draftId, originOf(pb, now));
  return true;
}

/** The journal setup (Entscheidungsgrundlage) of a playbook, with its checklist – written only on the reader's click. Returns its name, or `null` when saving failed. */
export async function addPlaybookSetup(pb: Playbook): Promise<string | null> {
  const { settings, saveSettings } = useJournal.getState();
  const setup: Setup = setupFromPlaybook(pb, settings.setups, nextSetupColor(settings.setups), newId);
  try {
    await saveSettings({ ...settings, setups: [...settings.setups, setup] });
    return setup.name;
  } catch {
    return null;
  }
}

/** "Probe im Labor": the rules go into the set-up (strategy "Eigene Idee", the playbook's market when it names one) and the run starts. */
export async function probeInLab(config: CustomConfig, symbol: string | null): Promise<void> {
  const lab = useLabor.getState();
  lab.setCfg({ strategy: "custom", custom: sanitizeCustom(config), ...(symbol ? { symbol } : {}) });
  await startLab(sanitizeSignalCfg(useJournal.getState().settings.signals));
}

/** The latest run summary of the lab for these rules (same rules → same key), or null. */
export function runOfKey(key: string) {
  return useLabor.getState().runs.find((r) => r.strategy === "custom" && r.id.startsWith(`custom#${key}:`)) ?? null;
}
