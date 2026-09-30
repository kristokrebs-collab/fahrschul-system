import { WarnBanner } from "@/primitives/WarnBanner";
import { GlyphClose } from "@/primitives/icons";
import { hasClaudeRuntime } from "@/store/capability";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const LOCAL_BANNER_STRONG = "Lokaler Modus.";
export const LOCAL_BANNER_TEXT =
  " Die Datenbank ist hier nicht erreichbar, Trades bleiben nur in diesem Browser. Öffne das Journal über claude.ai, damit es auf allen Geräten synchron ist.";
/** NEW (Plan 1.5): appended when the page runs outside claude.ai (Netlify). */
export const LOCAL_BANNER_NETLIFY = " Nutze Backup (JSON) unter Einstellungen → Daten.";
export const LOCAL_BANNER_CLOSE = "Hinweis schließen";

/** True while the banner should be visible (`mode === "local"`, never during `connecting`, not when dismissed). */
export function useLocalBannerOpen(): boolean {
  const mode = useJournal((s) => s.mode);
  const hidden = useUi((s) => s.hideLocalBanner);
  return mode === "local" && !hidden;
}

/**
 * `Lokaler Modus.` banner (Plan 1.5): text 1:1, Netlify variant sentence, close cross
 * (`aria-label="Hinweis schließen"`) → `tj2-ui.hideLocalBanner`. Exit `tween.exit`; the following
 * `main` children are `layout` elements and move up on `spring.layout` (see `App.tsx`).
 */
export function LocalModeBanner() {
  const open = useLocalBannerOpen();
  const setPref = useUi((s) => s.setPref);
  const netlify = !hasClaudeRuntime();
  return (
    <WarnBanner
      open={open}
      className="mb-5"
      action={
        <button
          type="button"
          aria-label={LOCAL_BANNER_CLOSE}
          onClick={() => setPref("hideLocalBanner", true)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-warn/80 transition-colors hover:bg-warn/15 hover:text-warn"
        >
          <GlyphClose className="size-3" />
        </button>
      }
    >
      <strong className="font-semibold">{LOCAL_BANNER_STRONG}</strong>
      {LOCAL_BANNER_TEXT}
      {netlify && LOCAL_BANNER_NETLIFY}
    </WarnBanner>
  );
}
