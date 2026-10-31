import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ImportDialog } from "@/overlays/ImportDialog";
import { Button } from "@/primitives/Button";
import { WarnBanner } from "@/primitives/WarnBanner";
import { exportJson } from "@/store/backup";
import { hasClaudeRuntime } from "@/store/capability";
import { useJournal } from "@/store/journalStore";
import { IS_FILE_BUILD } from "@/edition";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";

export const LOCAL_BANNER_STRONG = "Lokaler Modus.";
export const LOCAL_BANNER_TEXT =
  " Die Datenbank ist hier nicht erreichbar, Trades bleiben nur in diesem Browser. Öffne das Journal über claude.ai, damit es auf allen Geräten synchron ist.";
/** NEW (Plan 1.5): appended when the page runs outside claude.ai (Netlify). */
export const LOCAL_BANNER_NETLIFY = " Nutze Backup (JSON) unter Einstellungen → Daten.";
/**
 * Review F8: a standalone web build without cloud config (a sold deployment) cannot point to claude.ai – that sentence
 * (PR #3) stays for the claude.ai runtime only. Here the banner says what the Konto card says: the trades stay in this
 * browser, back them up.
 */
export const STANDALONE_BANNER_TEXT = " Trades bleiben nur in diesem Browser auf diesem Gerät.";
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

/**
 * NEW (P09): with a configured cloud the claude.ai sentence would be wrong – the banner points to the login instead
 * (signed out), to the paused sync, or to the missing 2FA code (signed in, store still local).
 */
export const CLOUD_BANNER_TEXT = " Trades bleiben nur in diesem Browser. Melde dich an, dann ist dein Journal auf allen Geräten synchron.";
export const CLOUD_BANNER_PAUSED = " Du bist angemeldet, aber Sync ist auf diesem Gerät pausiert. Einschalten unter Konto → Datenschutz.";
export const CLOUD_BANNER_LOCKED = " Gib deinen 2FA-Code ein, dann startet der Sync.";
export const CLOUD_BANNER_SIGN_IN = "Anmelden";
export const CLOUD_BANNER_CODE = "Code eingeben";

/** True when nothing persists in this browser (local mode on the session-only store). */
export function useNoStorage(): boolean {
  const mode = useJournal((s) => s.mode);
  const storage = useJournal((s) => s.storage);
  return mode === "local" && storage === "unavailable";
}

/**
 * True while the BANNER is visible: only the red „Speichern nicht möglich.“ (local mode on the session-only store). It cannot be
 * dismissed – every change is lost on close. The ordinary local mode is the small header badge (`LocalModeBadge.tsx`) since Etappe 1a.
 */
export function useLocalBannerOpen(): boolean {
  return useNoStorage();
}

/** True in local mode with a working storage: the header shows the `Lokaler Modus` badge. */
export function useLocalBadgeOpen(): boolean {
  const mode = useJournal((s) => s.mode);
  const storage = useJournal((s) => s.storage);
  return mode === "local" && storage !== "unavailable";
}

export interface LocalModeCopy {
  strong: string;
  text: string;
  /** the one button the cloud variants add (sign in / enter the 2FA code), else `null` */
  action: { label: string; view: "signin" | "mfa" } | null;
}

/**
 * The words of the ordinary local mode, per runtime (claude.ai, standalone web, file build, cloud signed out / paused / locked) –
 * the same sentences the banner used, now read by the badge's explanation.
 */
export function useLocalModeCopy(): LocalModeCopy {
  const netlify = !hasClaudeRuntime();
  // P09: cloud configured on this web build → the text talks about the login instead of claude.ai
  const cloud = netlify && !IS_FILE_BUILD && cloudEnabled();
  const authPhase = useCloudSession((s) => s.phase);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const cloudText = authPhase === "signedIn" ? (needsMfa ? CLOUD_BANNER_LOCKED : CLOUD_BANNER_PAUSED) : CLOUD_BANNER_TEXT;
  const cloudAction =
    authPhase === "signedIn" ? (needsMfa ? { label: CLOUD_BANNER_CODE, view: "mfa" as const } : null) : authPhase === "signedOut" || authPhase === "idle" ? { label: CLOUD_BANNER_SIGN_IN, view: "signin" as const } : null;
  const strong = IS_FILE_BUILD ? FILE_BANNER_STRONG : LOCAL_BANNER_STRONG;
  const text = IS_FILE_BUILD ? FILE_BANNER_TEXT : cloud ? cloudText : netlify ? STANDALONE_BANNER_TEXT + LOCAL_BANNER_NETLIFY : LOCAL_BANNER_TEXT;
  return { strong, text, action: cloud ? cloudAction : null };
}

const CLIP_CLOSED = "inset(0% 0% 100% 0% round 16px)";
const CLIP_OPEN = "inset(0% 0% 0% 0% round 16px)";

/**
 * The red, not dismissible `Speichern nicht möglich.` banner (Plan 1.5; a browser that grants no usable storage, e.g. a file opened
 * from an Android `content://` URL): the journal runs in memory, `Backup importieren` (opens the `ImportDialog`) and `Backup
 * exportieren` are the way out. The ordinary `Lokaler Modus.` hint is NOT a banner any more but the small header badge
 * (`LocalModeBadge.tsx`) with the same sentences behind a tap – the page loses its top banner, nothing of the text is lost.
 * The soft warn pulse in front of the text is WarnBanner's own dot (three pings, then it rests).
 * Enter (when the mode turns local after boot; never on the first paint): drops in from `y −8` while a clip-path reveal opens it
 * top → bottom (`spring.layout`) and it fades in (`tween.fade`). Exit fades on `tween.exit` with `popLayout`. Reduced motion:
 * opacity only.
 */
export function LocalModeBanner() {
  const open = useLocalBannerOpen();
  const reduced = useReducedFx();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {open && (
          <motion.div
            key="no-storage-banner"
            className="mb-5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, clipPath: CLIP_CLOSED }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, clipPath: CLIP_OPEN, transitionEnd: { clipPath: "none" } }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ y: spring.layout, clipPath: spring.layout, opacity: tween.fade }}
          >
            <WarnBanner className="border-signal/40 bg-signal/[0.07] text-(--color-danger-text) [&>span]:bg-signal [&>span>span]:bg-signal">
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
          </motion.div>
        )}
      </AnimatePresence>
      {/* outside the animated wrapper: a transformed ancestor would become the containing block of the fixed sheet */}
      {open && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}
