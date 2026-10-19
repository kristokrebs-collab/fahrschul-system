/**
 * Writes of the Schlüsselmarken cards: `settings.keyLevels` is saved at once (like the Lage and Box cards – no draft, no
 * Speichern button; the settings page's own draft does not hold this key, so its save keeps it). Every unknown key of
 * `settings.keyLevels` and every entry this version cannot read survives (`withKeyLevels`).
 */
import { duplicateKeyLevel, keyLevelsOfSettings, MAX_KEY_LEVELS, withKeyLevels, type AlertSettings, type KeyLevel, type KeyLevelsCfg } from "@/domain/keylevels";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { rearmKeyLevel } from "@/market/keylevels/alerts";

export type WriteResult = "ok" | "failed" | "limit";

async function write(patch: Partial<KeyLevelsCfg>): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const keyLevels = withKeyLevels(settings.keyLevels, patch);
  if (keyLevels === settings.keyLevels) return true;
  try {
    await saveSettings({ ...settings, keyLevels });
    return true;
  } catch {
    return false;
  }
}

const current = (): ReturnType<typeof keyLevelsOfSettings> => keyLevelsOfSettings(useJournal.getState().settings);

export async function saveLevel(level: KeyLevel): Promise<WriteResult> {
  const cfg = current();
  const exists = cfg.levels.some((l) => l.id === level.id);
  if (!exists && cfg.levels.length >= MAX_KEY_LEVELS) return "limit";
  const levels = exists ? cfg.levels.map((l) => (l.id === level.id ? level : l)) : [...cfg.levels, level];
  return (await write({ levels })) ? "ok" : "failed";
}

export async function removeLevel(id: string): Promise<WriteResult> {
  const cfg = current();
  return (await write({ levels: cfg.levels.filter((l) => l.id !== id) })) ? "ok" : "failed";
}

/** Duplicates an own or a fixed level into a new own level (alerts off, valid from now). */
export async function copyLevel(level: KeyLevel, now: number = Date.now()): Promise<WriteResult> {
  const cfg = current();
  if (cfg.levels.length >= MAX_KEY_LEVELS) return "limit";
  return (await write({ levels: [...cfg.levels, duplicateKeyLevel(level, newId("k_"), now)] })) ? "ok" : "failed";
}

export async function setLevelEnabled(id: string, enabled: boolean): Promise<WriteResult> {
  const cfg = current();
  return (await write({ levels: cfg.levels.map((l) => (l.id === id ? { ...l, enabled } : l)) })) ? "ok" : "failed";
}

export async function rearmLevel(id: string): Promise<void> {
  rearmKeyLevel(id);
}

export async function savePrecedence(precedence: KeyLevelsCfg["precedence"]): Promise<WriteResult> {
  return (await write({ precedence })) ? "ok" : "failed";
}

export async function savePlanToast(planToast: boolean): Promise<WriteResult> {
  return (await write({ planToast })) ? "ok" : "failed";
}

export async function saveAlertSettings(patch: Partial<AlertSettings>): Promise<WriteResult> {
  const cfg = current();
  return (await write({ alerts: { ...cfg.alerts, ...patch } })) ? "ok" : "failed";
}
