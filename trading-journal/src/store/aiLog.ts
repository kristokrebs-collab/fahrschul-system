/**
 * Writes of the KI-Protokoll (`settings.aiLog`, F24): one calm line per AI answer – helper, model, time, taken over or not.
 * Saved at once (no draft, no Speichern button) from the LATEST settings, so a write never throws away what another tab or the
 * cloud sync wrote in between; unknown keys and entries this version cannot read survive (`withAiLog`). It NEVER throws and
 * never blocks the helper that called it: a log that cannot be written is a missing line, not a failed answer. No question, no
 * answer and no text of any kind is passed in here – the input type has no field for it.
 */
import { aiLogOfSettings, appendEntry, decideEntry, withAiLog, type AiLogInput } from "@/domain/provenance";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";

async function save(build: (settings: ReturnType<typeof useJournal.getState>["settings"]) => unknown): Promise<boolean> {
  const { settings, saveSettings, loaded } = useJournal.getState();
  if (!loaded) return false;
  try {
    const aiLog = build(settings);
    if (aiLog === settings.aiLog) return true;
    await saveSettings({ ...settings, aiLog });
    return true;
  } catch {
    return false;
  }
}

/** Adds one entry; returns its id (`null` when it could not be written). */
export async function recordAi(input: AiLogInput, now: number = Date.now()): Promise<string | null> {
  const id = newId("ai_");
  const ok = await save((s) => withAiLog(s.aiLog, appendEntry(aiLogOfSettings(s).entries, input, id, now)));
  return ok ? id : null;
}

/** Marks an entry that was open as taken over (true) or not (false); an entry that already has an answer keeps it. */
export async function decideAi(id: string, adopted: boolean): Promise<boolean> {
  return save((s) => {
    const entries = aiLogOfSettings(s).entries;
    return entries.some((e) => e.id === id && e.adopted == null) ? withAiLog(s.aiLog, decideEntry(entries, id, adopted)) : s.aiLog;
  });
}

/** Empties the log (the trader's own click). */
export async function clearAiLog(): Promise<boolean> {
  return save((s) => (aiLogOfSettings(s).entries.length ? withAiLog(s.aiLog, []) : s.aiLog));
}
