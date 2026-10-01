import { AnimatePresence, motion } from "motion/react";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
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

const CLIP_CLOSED = "inset(0% 0% 100% 0% round 16px)";
const CLIP_OPEN = "inset(0% 0% 0% 0% round 16px)";

/**
 * `Lokaler Modus.` banner (Plan 1.5): text 1:1, Netlify variant sentence, close cross (`aria-label="Hinweis
 * schließen"`) → `tj2-ui.hideLocalBanner`; the soft warn pulse in front of the text is WarnBanner's own dot (three
 * pings, then it rests – no second, endlessly pinging dot).
 * Enter (when the mode turns local after boot; never on the first paint): drops in from `y −8` while a clip-path
 * reveal opens it top → bottom (`spring.layout`) and it fades in (`tween.fade`). Exit fades on `tween.exit` with
 * `popLayout`, so the banner leaves the flow at once and the page below (a `layout` element keyed on the banner state,
 * see `App.tsx`) moves up on `spring.layout` while it fades. Reduced motion: opacity only.
 */
export function LocalModeBanner() {
  const open = useLocalBannerOpen();
  const setPref = useUi((s) => s.setPref);
  const reduced = useReducedFx();
  const netlify = !hasClaudeRuntime();
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {open && (
        <motion.div
          key="local-banner"
          className="mb-5"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, clipPath: CLIP_CLOSED }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, clipPath: CLIP_OPEN, transitionEnd: { clipPath: "none" } }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={{ y: spring.layout, clipPath: spring.layout, opacity: tween.fade }}
        >
          <WarnBanner
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
