import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import type { StoreMode } from "@/domain/types";
import { dateTime, date as fmtDate } from "@/lib/format";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { exportCsv, exportJson, lastAutoBackup, listBackups, restoreBackup, type BackupEntry, type BackupKind } from "@/store/backup";
import { canDownload, DOWNLOAD_UNAVAILABLE } from "@/store/download";
import { MODE_LABELS, useJournal } from "@/store/journalStore";
import { readQuarantine } from "@/store/migrate";
import { ActionButton, GlyphDownload } from "./fx";
import { IntroPref } from "./IntroPref";

export const DATA_STRINGS = {
  title: "Daten",
  intro: "Sichere dein Journal als Datei. CSV öffnet sich direkt in Excel oder Numbers.",
  csv: "CSV exportieren",
  json: "Backup (JSON)",
  import: "Backup importieren",
  lastBackup: (d: string) => `Letztes Backup ${d}`,
  noBackup: "Noch kein Backup",
  restoreTitle: "Wiederherstellen",
  restore: "Wiederherstellen",
  confirm: "Alles ersetzen?",
  yes: "Ja",
  no: "Nein",
  quarantine: "Quarantäne ansehen",
  quarantineHide: "Quarantäne ausblenden",
  quarantineNote: (n: number) => `${n} Einträge konnten nicht gelesen werden und liegen unverändert in tj2-quarantine.`,
  footer: (trades: number, setups: number, rules: number) => `${trades} Trades gespeichert · ${setups} Grundlagen · ${rules} Grundregeln`,
  trades: (n: number) => `${n} Trades`,
  showAll: "Alle anzeigen",
} as const;

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = { auto: "Automatisch", import: "Vor Import", v0: "Migration" };

const MODE_TONE: Record<StoreMode, BadgeTone> = { cloud: "win", local: "warn", error: "loss", connecting: "mute" };

const VISIBLE_BACKUPS = 5;

export interface DataCardProps {
  /** Opens the `ImportDialog` (rendered by the page outside the card, see SettingsView). */
  onImport: () => void;
  className?: string;
}

/**
 * `Daten` card (Plan 6.4 / 8.5 / 8.6): export CSV/JSON, `Backup importieren` (opens the page-level ImportDialog),
 * mode pill (`Synchronisiert | Nur dieser Browser | Offline | Verbinde …`), `Letztes Backup {date}`,
 * the `Wiederherstellen` list of snapshots (restore = import with `Ersetzen`, inline confirm),
 * `Quarantäne ansehen` when records were quarantined, and the counts footer.
 *
 * Motion: the export buttons turn their download glyph into a spinner and then a drawn ✓ once the file is handed
 * to the browser; the mode badge breathes while synchronised; `Wiederherstellen` is a `HoldConfirm` (a click still
 * asks `Alles ersetzen?`, holding it restores at once).
 */
export function DataCard({ onImport, className }: DataCardProps) {
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  const mode = useJournal((s) => s.mode);
  const quarantined = useJournal((s) => s.quarantined);

  const [version, setVersion] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [confirmTag, setConfirmTag] = useState<string | null>(null);
  const [showQuarantine, setShowQuarantine] = useState(false);
  const [busy, setBusy] = useState(false);
  const downloadable = canDownload();

  // Snapshot list: recomputed after every journal change (import / restore / auto backup) or manual refresh.
  const backups: BackupEntry[] = useMemo(() => listBackups(), [trades, settings, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const last = useMemo(() => lastAutoBackup(), [backups]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = showAll ? backups : backups.slice(0, VISIBLE_BACKUPS);
  const ids = visible.map((b) => b.tag).join();
  const modeLabel = MODE_LABELS[mode];

  async function restore(tag: string) {
    setBusy(true);
    try {
      await restoreBackup(tag);
    } finally {
      setBusy(false);
      setConfirmTag(null);
      refresh();
    }
  }

  return (
    <Card
      title={DATA_STRINGS.title}
      action={
        <Badge tone={MODE_TONE[mode]} title={modeLabel.text} dot ping={mode === "cloud"}>
          {modeLabel.text}
        </Badge>
      }
      className={className}
    >
      <p className="mb-4 text-[13px] text-mute">{DATA_STRINGS.intro}</p>
      <div className="flex flex-wrap gap-2">
        {downloadable ? (
          <>
            <ActionButton icon={<GlyphDownload />} onRun={() => exportCsv()}>
              {DATA_STRINGS.csv}
            </ActionButton>
            <ActionButton icon={<GlyphDownload />} onRun={() => exportJson()}>
              {DATA_STRINGS.json}
            </ActionButton>
          </>
        ) : (
          <p className="text-[12.5px] text-faint">{DOWNLOAD_UNAVAILABLE}</p>
        )}
        <Button onClick={onImport}>{DATA_STRINGS.import}</Button>
      </div>

      <div className="mt-5 grid gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-mute">
          <span>{last ? DATA_STRINGS.lastBackup(fmtDate(new Date(last.at))) : DATA_STRINGS.noBackup}</span>
          {backups.length > 0 && <span className="label !text-[9.5px]">{DATA_STRINGS.restoreTitle}</span>}
        </div>
        {backups.length > 0 && (
          <motion.ul layout layoutDependency={ids} transition={{ layout: spring.layout }} className="grid gap-1.5" aria-label={DATA_STRINGS.restoreTitle}>
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((b) => (
                <BackupRow
                  key={b.tag}
                  entry={b}
                  ids={ids}
                  confirming={confirmTag === b.tag}
                  busy={busy}
                  onAsk={() => setConfirmTag(b.tag)}
                  onCancel={() => setConfirmTag(null)}
                  onRestore={() => void restore(b.tag)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
        {backups.length > VISIBLE_BACKUPS && !showAll && (
          <Button size="sm" className="justify-self-start" onClick={() => setShowAll(true)}>
            {DATA_STRINGS.showAll}
          </Button>
        )}
      </div>

      {quarantined > 0 && (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <p className="text-[12.5px] text-warn">{DATA_STRINGS.quarantineNote(quarantined)}</p>
          <Button size="sm" className="justify-self-start" onClick={() => setShowQuarantine((v) => !v)} aria-expanded={showQuarantine}>
            {showQuarantine ? DATA_STRINGS.quarantineHide : DATA_STRINGS.quarantine}
          </Button>
          {showQuarantine && (
            <pre className="max-h-[240px] overflow-auto rounded-xl border border-line bg-ink-950/60 p-3 font-mono text-[11px] text-mute">{JSON.stringify(readQuarantine(), null, 2)}</pre>
          )}
        </div>
      )}

      <IntroPref />

      <div className="mt-5 grid gap-1 border-t border-line pt-4 text-[12.5px] text-mute">
        <span>{DATA_STRINGS.footer(trades.length, settings.setups.length, settings.rules.length)}</span>
      </div>
    </Card>
  );
}

interface BackupRowProps {
  entry: BackupEntry;
  /** Visible tags joined – the rows' `layoutDependency`. */
  ids: string;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRestore: () => void;
}

/** One snapshot: date · kind · trades, `Wiederherstellen` (hold, or click → inline `Alles ersetzen? Ja / Nein`). */
function BackupRow({ entry: b, ids, confirming, busy, onAsk, onCancel, onRestore }: BackupRowProps) {
  const reduced = useReducedFx();
  const { trigger, no } = useConfirmFocus(confirming);
  const when = b.at ? dateTime(new Date(b.at)) : b.tag;
  return (
    <motion.li
      layout
      layoutDependency={ids}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
      transition={{ ...spring.layout, layout: spring.layout }}
      style={{ borderRadius: radius.input }}
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="num font-mono text-fg/90">{when}</span>
        <span className="text-faint">·</span>
        <span className="text-mute">{BACKUP_KIND_LABELS[b.kind]}</span>
        <span className="text-faint">·</span>
        <span className="num font-mono text-mute">{DATA_STRINGS.trades(b.trades)}</span>
      </span>
      {confirming ? (
        <motion.span
          className="flex flex-wrap items-center gap-2 text-[#ff8a90]"
          role="alert"
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ default: tween.fade, scale: spring.pop }}
        >
          {DATA_STRINGS.confirm}
          <Button size="sm" variant="danger" disabled={busy} onClick={onRestore}>
            {DATA_STRINGS.yes}
          </Button>
          <Button ref={no} size="sm" onClick={onCancel}>
            {DATA_STRINGS.no}
          </Button>
        </motion.span>
      ) : (
        <HoldConfirm ref={trigger} variant="ghost" size="sm" disabled={busy} onAsk={onAsk} onConfirm={onRestore} aria-label={`${DATA_STRINGS.restore}: ${when}`}>
          {DATA_STRINGS.restore}
        </HoldConfirm>
      )}
    </motion.li>
  );
}
