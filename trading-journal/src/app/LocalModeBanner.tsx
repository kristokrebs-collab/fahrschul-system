import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ImportDialog } from "@/overlays/ImportDialog";
import { Button } from "@/primitives/Button";
import { WarnBanner } from "@/primitives/WarnBanner";
import { GlyphClose } from "@/primitives/icons";
import { exportJson } from "@/store/backup";
import { hasClaudeRuntime } from "@/store/capability";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { IS_FILE_BUILD } from "@/edition";

export const LOCAL_BANNER_STRONG = "Lokaler Modus.";
export const LOCAL_BANNER_TEXT =
  " Die Datenbank ist hier nicht erreichbar, Trades bleiben nur in diesem Browser. Öffne das Journal über claude.ai, damit es auf allen Geräten synchron ist.";
/** NEW (Plan 1.5): appended when the page runs outside claude.ai (Netlify). */
export const LOCAL_BANNER_NETLIFY = " Nutze Backup (JSON) unter Einstellungen → Daten.";
export const LOCAL_BANNER_CLOSE = "Hinweis schließen";
/** Single-file builds: the data lives in this browser, there is no claude.ai sync to point to. */
export const FILE_BANNER_STRONG = "Datei-Version.";
export const FILE_BANNER_TEXT =
  " Deine Trades liegen nur in diesem Browser auf diesem Gerät. Sichere sie regelmäßig unter Einstellungen → Daten → Backup (JSON).";

/**
 * No usable storage (e.g. the file opened from an Android `content://` URL): the journal runs on a session-only
 * store. Not dismissible – every change is lost on close unless it is exported.
 */
export const NO_STORAGE_STRONG = "Speichern nicht möglich.";
export const NO_STORAGE_TEXT =
  " Dieser Browser erlaubt hier keinen dauerhaften Speicher, Änderungen gehen beim Schließen verloren. Importiere dein Backup (JSON), arbeite weiter und exportiere es vor dem Schließen wieder. Dauerhaft speichern: Datei in Chrome öffnen oder den Web-Link nutzen.";
export const NO_STORAGE_IMPORT = "Backup importieren";
export const NO_STORAGE_EXPORT = "Backup exportieren";

/** True when nothing persists in this browser (local mode on the session-only store). */
export function useNoStorage(): boolean {
  const mode = useJournal((s) => s.mode);
  const storage = useJournal((s) => s.storage);
  return mode === "local" && storage === "unavailable";
}

/**
 * True while the banner should be visible (`mode === "local"`, never during `connecting`, not when dismissed; the
 * no-storage variant cannot be dismissed).
 */
export function useLocalBannerOpen(): boolean {
  const mode = useJournal((s) => s.mode);
  const hidden = useUi((s) => s.hideLocalBanner);
  const noStorage = useNoStorage();
  return mode === "local" && (noStorage || !hidden);
}

const CLIP_CLOSED = "inset(0% 0% 100% 0% round 16px)";
const CLIP_OPEN = "inset(0% 0% 0% 0% round 16px)";

/**
 * `Lokaler Modus.` banner (Plan 1.5): text 1:1, Netlify variant sentence, close cross (`aria-label="Hinweis
 * schließen"`) → `tj2-ui.hideLocalBanner`; single-file builds say `Datei-Version.` instead. Without usable storage
 * (`useJournal.storage === "unavailable"`) a red, non-dismissible `Speichern nicht möglich.` variant with
 * `Backup importieren` (opens the `ImportDialog`) and `Backup exportieren` replaces it; the soft warn pulse in front of the text is WarnBanner's own dot (three
 * pings, then it rests – no second, endlessly pinging dot).
 * Enter (when the mode turns local after boot; never on the first paint): drops in from `y −8` while a clip-path
 * reveal opens it top → bottom (`spring.layout`) and it fades in (`tween.fade`). Exit fades on `tween.exit` with
 * `popLayout`, so the banner leaves the flow at once and the page below (a `layout` element keyed on the banner state,
 * see `App.tsx`) moves up on `spring.layout` while it fades. Reduced motion: opacity only.
 */
export function LocalModeBanner() {
  const open = useLocalBannerOpen();
  const noStorage = useNoStorage();
  const setPref = useUi((s) => s.setPref);
  const reduced = useReducedFx();
  const netlify = !hasClaudeRuntime();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {open && (
          <motion.div
            key={noStorage ? "no-storage-banner" : "local-banner"}
            className="mb-5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, clipPath: CLIP_CLOSED }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, clipPath: CLIP_OPEN, transitionEnd: { clipPath: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ y: spring.layout, clipPath: spring.layout, opacity: tween.fade }}
          >
            {noStorage ? (
              <WarnBanner className="border-signal/40 bg-signal/[0.07] text-[#ff8a90] [&>span]:bg-signal [&>span>span]:bg-signal">
                <strong className="font-semibold">{NO_STORAGE_STRONG}</strong>
                {NO_STORAGE_TEXT}
                <span className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" className="touch-hit" onClick={() => setImportOpen(true)}>
                    {NO_STORAGE_IMPORT}
                  </Button>
                  <Button size="sm" className="touch-hit" onClick={() => void exportJson()}>
                    {NO_STORAGE_EXPORT}
                  </Button>
                </span>
              </WarnBanner>
            ) : (
              <WarnBanner
                action={
                  <button
                    type="button"
                    aria-label={LOCAL_BANNER_CLOSE}
                    onClick={() => setPref("hideLocalBanner", true)}
                    className="touch-hit grid size-6 shrink-0 place-items-center rounded-full text-warn/80 transition-colors hover:bg-warn/15 hover:text-warn"
                  >
                    <GlyphClose className="size-3" />
                  </button>
                }
              >
                <strong className="font-semibold">{IS_FILE_BUILD ? FILE_BANNER_STRONG : LOCAL_BANNER_STRONG}</strong>
                {IS_FILE_BUILD ? FILE_BANNER_TEXT : LOCAL_BANNER_TEXT}
                {!IS_FILE_BUILD && netlify && LOCAL_BANNER_NETLIFY}
              </WarnBanner>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* outside the animated wrapper: a transformed ancestor would become the containing block of the fixed sheet */}
      {noStorage && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}
