import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type ChangeEvent } from "react";
import { fmt } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { importBackup, parseBackup, previewText, type ImportMode, type ImportPreview, type ImportResult } from "@/store/backup";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";

export const IMPORT_STRINGS = {
  title: "Backup importieren",
  intro: "Wähle eine JSON-Datei aus dem Export. Vor dem Schreiben legt das Journal einen Snapshot des aktuellen Stands an.",
  file: "Backup-Datei",
  choose: "Datei wählen",
  chosen: (name: string) => `Datei: ${name}`,
  mode: "Modus",
  merge: "Zusammenführen",
  replace: "Ersetzen",
  mergeHelp: "Trades und Ablesungen nach ID zusammenführen, bei Konflikt gewinnt der neuere Stand. Grundlagen nach ID mergen, Einstellungen bleiben.",
  replaceHelp: "Alles aus dem Backup übernehmen. Der aktuelle Stand wird vorher gesichert.",
  confirm: "Alles ersetzen?",
  yes: "Ja",
  no: "Nein",
  cancel: "Abbrechen",
  run: "Importieren",
  running: "Importiert …",
  failed: "Import fehlgeschlagen",
  trades: "Trades",
  setups: "Grundlagen",
  readings: "Ablesungen",
  exportedAt: "exportiert am",
  readError: "Datei konnte nicht gelesen werden",
} as const;

export const IMPORT_MODES: readonly { v: ImportMode; label: string }[] = [
  { v: "merge", label: IMPORT_STRINGS.merge },
  { v: "replace", label: IMPORT_STRINGS.replace },
];

type Parsed = { ok: true; text: string; preview: ImportPreview } | { ok: false; error: string };

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import (the `Daten` card refreshes its backup list). */
  onDone?: (result: ImportResult) => void;
  /** Injected reader for tests (defaults to `File.text()`). */
  readFile?: (file: File) => Promise<string>;
}

/**
 * `Backup importieren` (Plan 8.5, Sheet 540 px): file input `.json` → `parseBackup` preview
 * (`{n} Trades, {m} Grundlagen, {k} Ablesungen · exportiert am {date}`, counts as `MotionNumber`) →
 * mode `Zusammenführen | Ersetzen` → inline `Alles ersetzen? Ja / Nein` → `importBackup` with a
 * progress bar. Toasts (`Backup importiert` / `Import fehlgeschlagen`) come from the store.
 *
 * Motion: the body blocks cascade in (`StaggerItem`), the preview counts up from 0, the progress bar glides on
 * `spring.bar` with a shimmer band while busy and turns win-green at 100 %, and `Importieren` in `Ersetzen` mode is
 * a `HoldConfirm` (a click still asks `Alles ersetzen?`, holding it imports right away).
 */
export function ImportDialog({ open, onClose, onDone, readFile }: ImportDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedFx();
  const { trigger: runTrigger, no: confirmNo } = useConfirmFocus(confirm);

  // Reset on open (render-phase state adjustment instead of an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFileName("");
      setParsed(null);
      setMode("merge");
      setConfirm(false);
      setProgress(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setConfirm(false);
    try {
      const text = await (readFile ? readFile(file) : file.text());
      const res = parseBackup(text);
      setParsed(res.ok ? { ok: true, text, preview: res.preview } : { ok: false, error: res.path ? `${res.path}: ${res.error}` : res.error });
    } catch {
      setParsed({ ok: false, error: IMPORT_STRINGS.readError });
    }
  }

  async function run() {
    if (!parsed?.ok) return;
    setProgress(15);
    const tick = setInterval(() => setProgress((p) => (p == null ? p : Math.min(85, p + 10))), 120);
    try {
      const result = await importBackup(parsed.text, { mode });
      clearInterval(tick);
      setProgress(100);
      if (result.ok) {
        onDone?.(result);
        onClose();
      } else {
        setParsed({ ok: false, error: result.error ?? IMPORT_STRINGS.failed });
        setProgress(null);
        setConfirm(false);
      }
    } catch {
      clearInterval(tick);
      setProgress(null);
    }
  }

  const busy = progress != null && progress < 100;
  const canRun = Boolean(parsed?.ok) && !busy;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title={IMPORT_STRINGS.title}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose} disabled={busy}>
            {IMPORT_STRINGS.cancel}
          </Button>
          {mode === "replace" && confirm ? (
            <motion.span
              className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#ff8a90]"
              role="alert"
              initial={reduced ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ default: tween.fade, scale: spring.pop }}
            >
              {IMPORT_STRINGS.confirm}
              <Button size="sm" variant="danger" onClick={run} disabled={!canRun}>
                {IMPORT_STRINGS.yes}
              </Button>
              <Button ref={confirmNo} size="sm" onClick={() => setConfirm(false)}>
                {IMPORT_STRINGS.no}
              </Button>
            </motion.span>
          ) : mode === "replace" ? (
            <HoldConfirm ref={runTrigger} variant="primary" disabled={!canRun} onAsk={() => setConfirm(true)} onConfirm={() => void run()} aria-busy={busy || undefined}>
              {busy ? IMPORT_STRINGS.running : IMPORT_STRINGS.run}
            </HoldConfirm>
          ) : (
            <Button variant="primary" disabled={!canRun} onClick={() => void run()} aria-busy={busy || undefined}>
              <TextRoll mode="roll" text={busy ? IMPORT_STRINGS.running : IMPORT_STRINGS.run} />
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <StaggerItem>
          <p className="text-[13px] text-mute">{IMPORT_STRINGS.intro}</p>
        </StaggerItem>

        <StaggerItem className="flex flex-wrap items-center gap-3">
          <input ref={inputRef} type="file" accept=".json,application/json" aria-label={IMPORT_STRINGS.file} onChange={onFile} className="sr-only" />
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {IMPORT_STRINGS.choose}
          </Button>
          {fileName && (
            <motion.span key={fileName} className="truncate font-mono text-[12px] text-mute" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tween.fade}>
              {IMPORT_STRINGS.chosen(fileName)}
            </motion.span>
          )}
        </StaggerItem>

        <AnimatePresence mode="popLayout" initial={false}>
          {parsed?.ok && (
            <motion.div
              key="preview"
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
              transition={spring.layout}
              style={{ borderRadius: 12 }}
              className="grid gap-3 rounded-xl border border-line bg-ink-950/50 p-4"
              data-testid="import-preview"
            >
              <dl className="grid grid-cols-3 gap-2">
                {(
                  [
                    [IMPORT_STRINGS.trades, parsed.preview.trades],
                    [IMPORT_STRINGS.setups, parsed.preview.setups],
                    [IMPORT_STRINGS.readings, parsed.preview.readings],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
                    <dd className="num font-mono text-[17px] font-medium">
                      <MotionNumber value={n} decimals={0} countOnReveal />
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-[12.5px] text-mute" data-testid="import-preview-text">
                {previewText(parsed.preview)}
              </p>
              {parsed.preview.exportedAt && <span className="sr-only">{`${IMPORT_STRINGS.exportedAt} ${fmt.date(new Date(parsed.preview.exportedAt))}`}</span>}
            </motion.div>
          )}
          {parsed && !parsed.ok && (
            <motion.p
              key="error"
              layout
              role="alert"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={spring.layout}
              style={{ borderRadius: 12 }}
              className="rounded-xl border border-loss/30 bg-loss/[0.07] px-3 py-2 text-[13px] text-loss"
            >
              {IMPORT_STRINGS.failed}: {parsed.error}
            </motion.p>
          )}
        </AnimatePresence>

        <StaggerItem className="grid gap-1.5">
          <span id="import-mode-label" className="label">
            {IMPORT_STRINGS.mode}
          </span>
          <Segmented
            aria-labelledby="import-mode-label"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setConfirm(false);
            }}
            options={IMPORT_MODES}
          />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={mode}
              className="text-[11px] text-faint"
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={tween.fade}
            >
              {mode === "merge" ? IMPORT_STRINGS.mergeHelp : IMPORT_STRINGS.replaceHelp}
            </motion.span>
          </AnimatePresence>
        </StaggerItem>

        {progress != null && <ImportProgress value={progress} />}
      </div>
    </Sheet>
  );
}

/**
 * Import progress (`role="progressbar"`): the fill glides to each new value on `spring.bar` (transform only), a
 * pre-rendered shimmer band sweeps across the filled part while the import runs (it lives inside the fill, so it
 * never runs ahead of the progress), and the fill crossfades to win-green when complete.
 * Reduced motion: the fill jumps, no band.
 */
function ImportProgress({ value }: { value: number }) {
  const reduced = useReducedFx();
  const done = value >= 100;
  return (
    <div
      role="progressbar"
      aria-label={IMPORT_STRINGS.running}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
    >
      <motion.div
        className="absolute inset-0 origin-left rounded-full bg-fg"
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: value / 100 }}
        transition={reduced ? { duration: 0 } : spring.bar}
      >
        {!reduced && !done && <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-fx-shimmer bg-gradient-to-r from-transparent via-ink-950/35 to-transparent" />}
        <motion.span className="absolute inset-0 rounded-full bg-win" initial={false} animate={{ opacity: done ? 1 : 0 }} transition={reduced ? { duration: 0 } : tween.crossfade} />
      </motion.div>
    </div>
  );
}
