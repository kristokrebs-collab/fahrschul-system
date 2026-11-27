/**
 * The glass switch follows the settings (`settings.glass`, `@/motion/glass`): on the hydrate, a save in the settings page, a cloud
 * pull, an import – whenever an explicit choice arrives it is applied to `html[data-glass]` at once and mirrored for the next boot.
 * Settings without the key (a fresh account, data from before the switch) leave this device's mirrored choice alone.
 */
import { applyGlass, withGlass, type GlassPref } from "@/motion/glass";
import { useJournal } from "@/store/journalStore";

const explicit = (v: unknown): v is GlassPref => v === "on" || v === "off";

export function installGlassSync(): () => void {
  const first = useJournal.getState().settings.glass;
  if (explicit(first)) applyGlass(first);
  return useJournal.subscribe((s, prev) => {
    if (s.settings.glass !== prev.settings.glass && explicit(s.settings.glass)) applyGlass(s.settings.glass);
  });
}

/** The reader's pick: shown at once (no reload), then saved with the settings. Resolves false when the save failed. */
export async function chooseGlass(pref: GlassPref): Promise<boolean> {
  applyGlass(pref);
  const { settings, saveSettings } = useJournal.getState();
  try {
    await saveSettings(withGlass(settings, pref));
    return true;
  } catch {
    return false;
  }
}
