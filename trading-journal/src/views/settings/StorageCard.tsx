import { memo, useState, type ReactNode } from "react";
import { DISPLAY_STRINGS, isIosSafari, promptInstall, toggleFullscreen, useCanInstall, useFullscreen, useFullscreenSupported, useStandalone } from "@/app/pwa";
import { NO_STORAGE_STRONG, NO_STORAGE_TEXT, useNoStorage } from "@/app/LocalModeBanner";
import { IS_FILE_BUILD, IS_SHARE, isFileProtocol } from "@/edition";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { KEY_PREFIX } from "@/store/storage";

export const STORAGE_STRINGS = {
  title: "Version & Speicher",
  note: "Welche Ausgabe du nutzt und wo deine Daten liegen.",
  edition: "Version",
  personal: "Persönlich",
  share: "Zum Teilen (ohne persönliche Daten)",
  target: "Ausführung",
  web: "Web-App",
  file: "Datei (lokal geöffnet)",
  where: "Speicherort",
  cloud: "claude.ai, auf allen Geräten synchron",
  local: "Dieser Browser auf diesem Gerät",
  none: "Nirgends – nur bis die Seite geschlossen wird",
  connecting: "Wird geprüft …",
  keys: "Speicher-Schlüssel",
  keysShare: "eigener Bereich, berührt die persönliche Version nicht",
  keysPersonal: "kompatibel mit der Datei-Version: gleiche Schlüssel und Felder",
  noStorageHint: "Nutze im Feld „Daten“ „Backup importieren“ und vor dem Schließen „Backup (JSON)“.",
  display: DISPLAY_STRINGS.section,
  fullscreenOn: "Vollbild einschalten",
  fullscreenOff: "Vollbild beenden",
  install: DISPLAY_STRINGS.install,
  installed: DISPLAY_STRINGS.installed,
  installHint: DISPLAY_STRINGS.installHint,
  installHintIos: DISPLAY_STRINGS.installHintIos,
  displayNote: "Ohne Browserleiste (z. B. der graue Balken über der Taskleiste): als App installieren oder Vollbild.",
} as const;

const S = STORAGE_STRINGS;

/**
 * NEW `Version & Speicher` card: the edition (persönlich / zum Teilen), web app vs. local file, where the journal
 * persists (claude.ai / this browser / nowhere; the mode pill itself sits on the `Daten` card), the storage
 * namespace (`tj2-*` / `tj2share-*`), the no-storage path ("Speichern nicht möglich.") and the display actions against
 * the host's bottom bar (`App installieren`, `Vollbild`). Event driven, no timers.
 */
export const StorageCard = memo(function StorageCard({ className }: { className?: string }) {
  const mode = useJournal((s) => s.mode);
  const noStorage = useNoStorage();
  const file = IS_FILE_BUILD || isFileProtocol();
  const where = noStorage ? S.none : mode === "cloud" ? S.cloud : mode === "connecting" ? S.connecting : S.local;

  return (
    <Card
      title={S.title}
      note={S.note}
      className={className}
      data-testid="settings-storage-card"
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row term={S.edition} value={IS_SHARE ? S.share : S.personal} />
        <Row term={S.target} value={file ? S.file : S.web} />
        <Row term={S.where} value={where} tone={noStorage ? "text-[#ff8a90]" : undefined} />
        <Row term={S.keys} value={<span className="num font-mono">{`${KEY_PREFIX}*`}</span>} sub={IS_SHARE ? S.keysShare : S.keysPersonal} />
      </dl>

      {noStorage && (
        <p className="mt-4 rounded-xl border border-signal/40 bg-signal/[0.07] p-3 text-[12.5px] leading-relaxed text-[#ff8a90]" data-testid="settings-no-storage">
          <strong className="font-semibold">{NO_STORAGE_STRONG}</strong>
          {NO_STORAGE_TEXT} {S.noStorageHint}
        </p>
      )}

      <DisplayRow />
    </Card>
  );
});

function Row({ term, value, sub, tone }: { term: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{term}</dt>
      <dd className={cn("text-[13px] text-fg/90 [overflow-wrap:anywhere]", tone)}>{value}</dd>
      {sub && <dd className="text-[11px] text-faint">{sub}</dd>}
    </div>
  );
}

/** `Anzeige`: install (when the browser offers it), fullscreen (when the API exists), else the manual hint. */
function DisplayRow() {
  const canInstall = useCanInstall();
  const standalone = useStandalone();
  const fsSupported = useFullscreenSupported();
  const fs = useFullscreen();
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const file = IS_FILE_BUILD || isFileProtocol();
  const hint = standalone ? S.installed : file ? null : isIosSafari() ? S.installHintIos : S.installHint;
  if (!canInstall && !fsSupported && !hint) return null;
  return (
    <div className="mt-5 grid gap-2 border-t border-line pt-4">
      <span className="label !text-[9.5px]">{S.display}</span>
      <p className="text-[11.5px] text-faint">{S.displayNote}</p>
      <div className="flex flex-wrap items-center gap-2">
        {canInstall && !standalone && (
          <Button
            size="sm"
            onClick={() =>
              void promptInstall().then((r) => {
                if (r === "accepted") setInstallMsg(S.installed);
              })
            }
          >
            {S.install}
          </Button>
        )}
        {fsSupported && (
          <Button size="sm" aria-pressed={fs} onClick={() => void toggleFullscreen()}>
            {fs ? S.fullscreenOff : S.fullscreenOn}
          </Button>
        )}
      </div>
      {(installMsg || (!canInstall && hint)) && <p className="text-[11.5px] text-mute">{installMsg ?? hint}</p>}
    </div>
  );
}
