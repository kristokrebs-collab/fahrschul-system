/**
 * Writes of the structure view: `settings.trendlines` is saved at once (like the Schlüsselmarken and Box cards – no draft,
 * no Speichern button; the settings page's own draft does not hold this key, so its save keeps it). Unknown keys survive
 * (`withTrendlines`).
 */
import { normalizeTfs, withTrendlines, type TrendlinesCfg } from "@/domain/trendlines";
import { useJournal } from "@/store/journalStore";

export async function writeTrendlines(patch: Partial<TrendlinesCfg>): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const trendlines = withTrendlines(settings.trendlines, patch);
  if (trendlines === settings.trendlines) return true;
  try {
    await saveSettings({ ...settings, trendlines });
    return true;
  } catch {
    return false;
  }
}

/** The timeframe list with `tf` switched on or off. */
export const toggledTfs = (tfs: readonly string[], tf: string, on: boolean) => normalizeTfs(on ? [...tfs, tf] : tfs.filter((t) => t !== tf));
