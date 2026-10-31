import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { AccountId } from "@/domain/types";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/cn";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { inputClass } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { pushToast, useUi } from "@/store/uiStore";
import { useShotExtractState } from "@/journal/extract/availability";
import { resolveZone } from "@/journal/extract/candidate";
import { detectLocaleStyle } from "@/journal/extract/locale";
import { localZoneId, ZONE_CHOICES } from "@/journal/extract/time";
import type { Extraction } from "@/journal/extract/contract";
import { cropUrl, IMAGE_ACCEPT, loadPicture, ocrSupport, PictureError, progressText, startEngine, type Picture } from "../browser";
import { ocrCandidates } from "../candidates";
import { buildTrade, commitTrades, undoCommit } from "../commit";
import type { OcrEngine } from "../engine";
import { combine, readPicture } from "../pipeline";
import { applyOcrEdits, previewRows, type OcrEdit } from "../preview";
import type { PageRecords } from "../records";
import { closeScreenshotImport, useOcrImport } from "../store";
import type { OcrExtraction } from "../toExtraction";
import type { Raster } from "../types";
import { PreviewRowCard } from "./PreviewList";

export const OCR_STRINGS = {
  title: "Screenshot importieren",
  lead: "Lade einen Screenshot deiner Order-, Positions- oder Trade-Historie (Bitunix, Bybit, Binance, BingX, MEXC, OKX, Bitget, KuCoin, Blofin). Die Trades werden erkannt und hier geprüft – erst „Eintragen“ schreibt sie ins Journal, und mit „Rückgängig“ nimmst du sie wieder heraus.",
  honest: "Die Texterkennung läuft nur auf deinem Gerät und kann sich vertun – prüfe die gelb markierten Felder. Bilder werden weder gespeichert noch gesendet.",
  firstLoad: "Beim ersten Mal lädt dein Browser die Texterkennung einmalig (ca. 8 MB, von dieser Seite, nicht von Dritten); danach kommt sie aus dem Cache.",
  drop: "Screenshot hierher ziehen",
  dropSub: "oder einfügen (Strg/Cmd + V) · PNG, JPEG, WebP · mehrere Bilder möglich",
  choose: "Bilder auswählen",
  more: "Weiteres Bild hinzufügen",
  read: "Auslesen",
  cancel: "Abbrechen",
  close: "Schließen",
  retry: "Erneut versuchen",
  decoding: "Bild wird geöffnet …",
  reading: (i: number, n: number) => (n > 1 ? `Bild ${i + 1} von ${n} wird gelesen …` : "Das Bild wird gelesen …"),
  checking: "Zahlen werden nachgeprüft …",
  none: "Auf dem Bild wurde kein Trade erkannt. Probiere einen größeren Ausschnitt mit Symbol (z. B. BTCUSDT) und den Werten dahinter – oder trage die Werte von Hand ein.",
  found: (n: number) => (n === 1 ? "1 Trade erkannt" : `${n} Trades erkannt`),
  attention: (n: number) => (n === 0 ? "nichts Unsicheres" : n === 1 ? "1 Feld gelb markiert" : `${n} Felder gelb markiert`),
  incomplete: (n: number) => (n === 1 ? "1 Karte unvollständig" : `${n} Karten unvollständig`),
  incompleteHelp: "Unvollständige Karten werden nicht eingetragen – fehlende Werte werden nie geraten.",
  zone: "Zeitzone der Screenshots",
  zoneAuto: "Wie in der Börsen-App – ich nehme deine Zeit an",
  account: "Konto",
  commit: (n: number) => (n === 1 ? "Trade eintragen" : `Alle ${n} Trades eintragen`),
  commitNone: "Keinen Trade ausgewählt",
  written: (n: number) => (n === 1 ? "1 Trade eingetragen" : `${n} Trades eingetragen`),
  undo: "Rückgängig",
  undone: (n: number) => (n === 1 ? "1 Trade wieder entfernt" : `${n} Trades wieder entfernt`),
  partial: (ok: number, all: number) => `${ok} von ${all} Trades eingetragen – Speichern fehlgeschlagen`,
  engineAi: "KI (Server, genauer – sendet die Bilder an den Betreiber-Dienst)",
  engineOcr: "Auf diesem Gerät (nichts verlässt es)",
  engineLabel: "Lesen mit",
  advice: "Keine professionelle Finanzberatung.",
} as const;
const S = OCR_STRINGS;

const MAX_PICTURES = 8;
const isImage = (f: File): boolean => f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|avif|gif|bmp)$/i.test(f.name);

interface Slot {
  id: string;
  name: string;
  file: File;
  picture: Picture | null;
  error: string | null;
  /** Page index of the OCR result (stable: results refer to it). */
  page: number;
}

type Phase = "pick" | "reading" | "preview" | "error";

export default function OcrImportSheet() {
  const open = useOcrImport((s) => s.open);
  const seq = useOcrImport((s) => s.seq);
  const handed = useOcrImport((s) => s.files);
  const trades = useJournal((s) => s.trades);
  const currency = useJournal((s) => s.settings.currency);
  const acc = useUi((s) => s.acc);
  const ai = useShotExtractState() === "ready";
  const support = useMemo(() => ocrSupport(), []);

  const [phase, setPhase] = useState<Phase>("pick");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pages, setPages] = useState<PageRecords[]>([]);
  const [aiReply, setAiReply] = useState<Extraction | null>(null);
  const [mode, setMode] = useState<"ocr" | "ai">("ocr");
  const [progress, setProgress] = useState<{ fraction: number; text: string }>({ fraction: 0, text: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [edits, setEdits] = useState<OcrEdit[]>([]);
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [zoneId, setZoneId] = useState("auto");
  const [account, setAccount] = useState<AccountId>(acc === "makro" ? "makro" : "scalp");
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [busyWrite, setBusyWrite] = useState(false);

  const engine = useRef<OcrEngine | null>(null);
  const rasters = useRef(new Map<string, Raster>());
  const cancelled = useRef(false);
  const nextPage = useRef(0);
  const urls = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const slotsRef = useRef<Slot[]>([]);
  slotsRef.current = slots;

  const releaseUrls = useCallback(() => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current.clear();
  }, []);

  const stopEngine = useCallback(() => {
    const e = engine.current;
    engine.current = null;
    if (e) void e.terminate().catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    stopEngine();
    releaseUrls();
    for (const s of slotsRef.current) s.picture?.bitmap.close?.();
    rasters.current.clear();
    nextPage.current = 0;
    setPhase("pick");
    setSlots([]);
    setPages([]);
    setAiReply(null);
    setMode("ocr");
    setMessage(null);
    setEdits([]);
    setTaken({});
    setOpenIds({});
    setZoneId("auto");
    setCrops({});
    setAccount(acc === "makro" ? "makro" : "scalp");
    setBusyWrite(false);
  }, [acc, releaseUrls, stopEngine]);

  const close = useCallback(() => {
    closeScreenshotImport();
  }, []);

  /* every opening starts fresh (and takes the pictures the opener handed over) */
  const addFiles = useCallback(async (files: readonly File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) {
      setMessage(files.length ? "Das war kein Bild. Wähle einen Screenshot (PNG, JPEG, WebP)." : null);
      return;
    }
    setMessage(null);
    const room = MAX_PICTURES - slotsRef.current.length;
    if (imgs.length > room) setMessage(`Höchstens ${MAX_PICTURES} Bilder auf einmal – die übrigen wurden nicht übernommen.`);
    for (const file of imgs.slice(0, Math.max(0, room))) {
      const id = newId("shot_");
      const page = nextPage.current++;
      try {
        const { picture, raster } = await loadPicture(file, id);
        rasters.current.set(id, raster);
        setSlots((s) => [...s, { id, name: file.name, file, picture, error: null, page }]);
        urls.current.add(picture.thumb);
      } catch (e) {
        setSlots((s) => [...s, { id, name: file.name, file, picture: null, error: e instanceof PictureError ? e.message : "Das Bild ließ sich nicht öffnen.", page }]);
      }
    }
  }, []);

  const lastSeq = useRef(0);
  useEffect(() => {
    if (!open) {
      lastSeq.current = 0;
      return;
    }
    if (lastSeq.current === seq) return;
    lastSeq.current = seq;
    reset();
    cancelled.current = false;
    if (handed.length) void addFiles(handed);
  }, [open, seq, handed, reset, addFiles]);

  useEffect(() => () => {
    cancelled.current = true;
    stopEngine();
    releaseUrls();
  }, [releaseUrls, stopEngine]);

  /* paste (Strg/Cmd + V) while the sheet is open */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const readRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent): void => {
      const files = [...(e.clipboardData?.files ?? [])];
      const fromItems = files.length ? files : [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (!fromItems.some(isImage)) return;
      e.preventDefault();
      void addFiles(fromItems).then(() => {
        if (phaseRef.current === "preview") void readRef.current();
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, addFiles]);

  /* reading */
  const run = useCallback(async () => {
    const todo = slotsRef.current.filter((s) => s.picture && (mode === "ai" || !pagesRef.current.some((p) => p.page === s.page)));
    if (!todo.length && mode === "ocr") {
      setPhase(pagesRef.current.length ? "preview" : "pick");
      return;
    }
    cancelled.current = false;
    setMessage(null);
    setPhase("reading");
    setNow(new Date());
    try {
      if (mode === "ai") {
        setProgress({ fraction: 0.2, text: "Bilder werden verkleinert …" });
        const { prepareImages, requestExtraction } = await import("@/journal/extract/client");
        const images = await prepareImages(slotsRef.current.filter((s) => s.picture).map((s) => s.file));
        if (cancelled.current) return;
        setProgress({ fraction: 0.5, text: "Die KI liest die Bilder … das dauert bis zu 20 Sekunden." });
        const reply = await requestExtraction(images, { timezone: localZoneId() });
        if (cancelled.current) return;
        setAiReply(reply);
        setPhase("preview");
        return;
      }
      setProgress({ fraction: 0, text: S.decoding });
      if (!engine.current) {
        const started = await startEngine((p) => {
          if (!cancelled.current && loadingEngine.current) setProgress({ fraction: 0, text: progressText(p) });
        });
        if (cancelled.current) {
          void started.terminate();
          return;
        }
        engine.current = started;
      }
      loadingEngine.current = false;
      for (let i = 0; i < todo.length; i++) {
        const slot = todo[i]!;
        const raster = rasters.current.get(slot.id);
        if (!raster) continue;
        const res = await readPicture(
          raster,
          slot.page,
          engine.current!,
          (p) => {
            if (!cancelled.current) setProgress({ fraction: p.fraction, text: p.phase === "refine" ? S.checking : S.reading(i, todo.length) });
          },
          i,
          todo.length,
        );
        if (cancelled.current) return;
        rasters.current.delete(slot.id);
        setPages((list) => [...list.filter((x) => x.page !== slot.page), res.records]);
        pagesRef.current = [...pagesRef.current.filter((x) => x.page !== slot.page), res.records];
      }
      setPhase("preview");
    } catch (e) {
      if (cancelled.current) return;
      stopEngine();
      setMessage(e instanceof Error && e.message ? `Das Auslesen hat nicht geklappt: ${e.message}` : "Das Auslesen hat nicht geklappt.");
      setPhase("error");
    }
  }, [mode, stopEngine]);
  const loadingEngine = useRef(true);
  const pagesRef = useRef<PageRecords[]>([]);
  pagesRef.current = pages;
  readRef.current = run;

  const cancelReading = (): void => {
    cancelled.current = true;
    stopEngine();
    loadingEngine.current = true;
    setPhase(pages.length ? "preview" : "pick");
  };

  /* what was read */
  const extraction: OcrExtraction | null = useMemo(() => {
    if (mode === "ai" && aiReply) return { extraction: aiReply, sources: aiReply.trades.map(() => []), incomplete: [], skipped: [], pages: [] };
    return pages.length ? combine(pages) : null;
  }, [mode, aiReply, pages]);
  const zone = useMemo(() => resolveZone(null, zoneId === "auto" ? null : (ZONE_CHOICES.find((z) => z.id === zoneId)?.zone ?? null), localZoneId()), [zoneId]);
  const built = useMemo(() => (extraction ? ocrCandidates(extraction, { now, zone, localZone: localZoneId(), fallbackStyle: detectLocaleStyle() }) : null), [extraction, now, zone]);
  const cands = useMemo(() => (built ? applyOcrEdits(built.candidates, edits, now) : []), [built, edits, now]);
  const rows = useMemo(() => (built ? previewRows(cands, built.recordsOf, { trades, currency, now, edits }) : []), [built, cands, trades, currency, now, edits]);
  const isTaken = (id: string, dupOrBlocked: boolean): boolean => taken[id] ?? !dupOrBlocked;
  const writable = rows.filter((r) => isTaken(r.id, !!r.duplicate) && !r.blocked);
  const attention = rows.reduce((n, r) => n + r.attention, 0);
  const viewLabel = pages.find((p) => p.view !== "unknown")?.viewLabel ?? "Screenshot";

  /* row crops (local, from the picture in memory) */
  useEffect(() => {
    if (phase !== "preview") return;
    let alive = true;
    void (async () => {
      for (const r of rows) {
        const c = r.crops[0];
        const slot = c ? slots.find((s) => s.page === c.page) : null;
        if (!c || !slot?.picture) continue;
        const key = `${c.page}:${Math.round(c.box.x0)}:${Math.round(c.box.y0)}:${Math.round(c.box.x1)}:${Math.round(c.box.y1)}`;
        if (crops[key] != null || !(openIds[r.id] ?? true)) continue;
        const url = await cropUrl({ bitmap: slot.picture.bitmap, width: slot.picture.width, height: slot.picture.height }, c.box);
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        if (url) urls.current.add(url);
        setCrops((m) => ({ ...m, [key]: url }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [phase, rows, slots, openIds, crops]);
  const cropOf = (r: (typeof rows)[number]): string | null => {
    const c = r.crops[0];
    return c ? (crops[`${c.page}:${Math.round(c.box.x0)}:${Math.round(c.box.y0)}:${Math.round(c.box.x1)}:${Math.round(c.box.y1)}`] ?? null) : null;
  };

  const writeAll = async (): Promise<void> => {
    if (!writable.length || busyWrite) return;
    setBusyWrite(true);
    const ctx = { account, now: new Date(), zoneText: zone.text, viewLabel };
    const out = [];
    for (const r of writable) {
      const c = cands.find((x) => x.id === r.id);
      if (!c) continue;
      const b = buildTrade(c, built?.recordsOf.get(c.id) ?? [], ctx, currency);
      if (b.ok) out.push(b.trade);
    }
    const res = await commitTrades(out);
    setBusyWrite(false);
    if (!res.ids.length) {
      pushToast({ kind: "error", title: "Speichern fehlgeschlagen", detail: "Es wurde nichts eingetragen." });
      return;
    }
    closeScreenshotImport();
    navigate("trades");
    if (res.failed) pushToast({ kind: "error", title: S.partial(res.ids.length, out.length) });
    else
      pushToast({
        kind: "success",
        title: S.written(res.ids.length),
        duration: 9000,
        action: {
          label: S.undo,
          onClick: () => {
            void undoCommit(res.ids).then((n) => pushToast({ kind: "info", title: S.undone(n) }));
          },
        },
      });
  };

  const removeSlot = (id: string): void => {
    const s = slots.find((x) => x.id === id);
    s?.picture?.bitmap.close?.();
    rasters.current.delete(id);
    setSlots((l) => l.filter((x) => x.id !== id));
    if (s) setPages((p) => p.filter((x) => x.page !== s.page));
  };

  const onFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    void addFiles(files).then(() => {
      if (phaseRef.current === "preview") void readRef.current();
    });
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]).then(() => {
      if (phaseRef.current === "preview") void readRef.current();
    });
  };

  const readable = slots.filter((s) => s.picture).length;
  const busy = phase === "reading";
  return (
    <Sheet
      open={open}
      onClose={close}
      size="lg"
      title={S.title}
      dismissGuard={false}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={busy ? cancelReading : close} data-testid="ocr-cancel">
            {busy ? S.cancel : phase === "preview" || phase === "error" ? S.close : S.cancel}
          </Button>
          {(phase === "pick" || phase === "error") && (
            <Button variant="primary" disabled={!readable || !support.ok} onClick={() => void run()} data-testid="ocr-read">
              {phase === "error" ? S.retry : S.read}
            </Button>
          )}
          {phase === "preview" && (
            <Button variant="primary" disabled={!writable.length || busyWrite} onClick={() => void writeAll()} data-testid="ocr-commit">
              {writable.length ? S.commit(writable.length) : S.commitNone}
            </Button>
          )}
        </>
      }
    >
      <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" aria-label="Screenshots auswählen" onChange={onFiles} data-testid="ocr-file" tabIndex={-1} />
      <div className="grid gap-4" data-testid="ocr-sheet" data-phase={phase} data-mode={mode}>
        {(phase === "pick" || phase === "error") && (
          <>
            <StaggerItem>
              <p className="text-[13px] leading-relaxed text-mute">{S.lead}</p>
            </StaggerItem>
            {ai && (
              <StaggerItem className="grid gap-1.5">
                <span className="label !text-mute">{S.engineLabel}</span>
                <Segmented
                  aria-label={S.engineLabel}
                  size="sm"
                  value={mode}
                  onChange={(v) => {
                    setMode(v);
                    setAiReply(null);
                  }}
                  options={[
                    { v: "ocr", label: S.engineOcr },
                    { v: "ai", label: S.engineAi },
                  ]}
                />
              </StaggerItem>
            )}
            <StaggerItem>
              {support.ok ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  data-testid="ocr-drop"
                  className={cn("grid justify-items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors", dragging ? "border-white/60 bg-white/[0.04]" : "border-line-2 bg-ink-950/40")}
                >
                  <p className="text-[15px] font-medium">{S.drop}</p>
                  <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-mute">{S.dropSub}</p>
                  <Button onClick={() => fileInput.current?.click()} data-testid="ocr-choose">
                    {S.choose}
                  </Button>
                </div>
              ) : (
                <p role="alert" className="rounded-xl border border-warn/40 bg-warn/[0.07] px-3.5 py-3 text-[13px] leading-relaxed" data-testid="ocr-unsupported">
                  {support.reason}
                </p>
              )}
            </StaggerItem>
            {slots.length > 0 && (
              <StaggerItem>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-label="Gewählte Bilder">
                  {slots.map((s) => (
                    <li key={s.id} className="relative overflow-hidden rounded-xl border border-line bg-ink-850" data-testid="ocr-picture">
                      {s.picture ? <img src={s.picture.thumb} alt={s.name} className="aspect-[3/4] w-full object-cover object-top" /> : <p className="grid aspect-[3/4] place-items-center px-2 text-center text-[11.5px] text-warn">{s.error}</p>}
                      <button
                        type="button"
                        onClick={() => removeSlot(s.id)}
                        aria-label={`${s.name} entfernen`}
                        className="touch-hit absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full border border-line-2 bg-ink-950/85 text-[13px] text-mute hover:text-fg"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </StaggerItem>
            )}
            {phase === "error" && message && (
              <StaggerItem>
                <p role="alert" className="rounded-xl border border-warn/40 bg-warn/[0.07] px-3.5 py-3 text-[13px] leading-relaxed" data-testid="ocr-message">
                  {message}
                </p>
              </StaggerItem>
            )}
            {phase === "pick" && message && (
              <StaggerItem>
                <p role="status" className="text-[12.5px] text-warn" data-testid="ocr-message">
                  {message}
                </p>
              </StaggerItem>
            )}
            <StaggerItem>
              <p className="text-[12px] leading-relaxed text-faint">{mode === "ai" ? "Im KI-Modus werden die verkleinerten Bilder zum Auslesen an den Betreiber-Dienst gesendet und nicht gespeichert." : S.honest}</p>
              {mode === "ocr" && <p className="mt-1 text-[12px] leading-relaxed text-faint">{S.firstLoad}</p>}
            </StaggerItem>
          </>
        )}

        {busy && (
          <StaggerItem>
            <div role="status" aria-live="polite" className="grid gap-2.5 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3 text-[13px] text-mute" data-testid="ocr-busy">
              <span className="flex items-center gap-3">
                <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-signal" />
                {progress.text}
              </span>
              <span aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                <span className="block h-full origin-left rounded-full bg-fg/70" style={{ transform: `scaleX(${Math.max(0.03, Math.min(1, progress.fraction))})`, transition: "transform 300ms ease-out" }} />
              </span>
            </div>
          </StaggerItem>
        )}

        {phase === "preview" && extraction && (
          <>
            <StaggerItem>
              <p role="status" aria-live="polite" className="text-[13.5px] font-medium" data-testid="ocr-summary">
                {rows.length ? S.found(rows.length) : "Kein Trade erkannt"}
                {rows.length > 0 && (
                  <>
                    {" · "}
                    <span className={attention ? "text-warn" : "text-mute"}>{S.attention(attention)}</span>
                  </>
                )}
                {extraction.incomplete.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-warn">{S.incomplete(extraction.incomplete.length)}</span>
                  </>
                )}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">{mode === "ai" ? "Die KI hat gelesen – prüfe jede Zahl." : S.honest}</p>
              {pages.length > 0 && (
                <p className="mt-1 text-[12px] text-faint">
                  Erkannt: {viewLabel}
                  {pages[0]?.layout === "cards" ? " (Karten)" : pages[0]?.layout === "table" ? " (Tabelle)" : ""}
                </p>
              )}
              {slots.length < MAX_PICTURES && (
                <Button size="sm" className="mt-2" onClick={() => fileInput.current?.click()} data-testid="ocr-more">
                  {S.more}
                </Button>
              )}
            </StaggerItem>
            {extraction.incomplete.map((c, i) => (
              <StaggerItem key={`${c.page}-${i}`}>
                <p role="status" className="rounded-xl border border-warn/40 bg-warn/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed" data-testid="ocr-incomplete">
                  {c.text}
                </p>
              </StaggerItem>
            ))}
            {extraction.skipped.map((s, i) => (
              <StaggerItem key={`${s.page}-s${i}`}>
                <p className="text-[12px] text-mute" data-testid="ocr-skipped">
                  {s.text}
                </p>
              </StaggerItem>
            ))}
            {rows.length === 0 && extraction.incomplete.length === 0 && (
              <StaggerItem>
                <p role="alert" className="rounded-xl border border-warn/40 bg-warn/[0.07] px-3.5 py-3 text-[13px] leading-relaxed" data-testid="ocr-none">
                  {S.none}
                </p>
              </StaggerItem>
            )}
            {rows.length > 0 && (
              <>
                <StaggerItem className="grid gap-3 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="grid gap-1.5">
                    <label htmlFor="ocr-zone" className="label !text-mute">
                      {S.zone}
                    </label>
                    <select id="ocr-zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={cn(inputClass, "pointer-coarse:min-h-11")} data-testid="ocr-zone">
                      <option value="auto">{S.zoneAuto}</option>
                      {ZONE_CHOICES.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[12px] leading-relaxed text-mute" data-testid="ocr-zone-text">
                      {zone.text}
                    </p>
                  </div>
                  <div className="grid content-start gap-1.5">
                    <span className="label !text-mute">{S.account}</span>
                    <Segmented
                      aria-label={S.account}
                      size="sm"
                      value={account}
                      onChange={setAccount}
                      options={[
                        { v: "scalp", label: "Scalp" },
                        { v: "makro", label: "Makro" },
                      ]}
                    />
                  </div>
                </StaggerItem>
                {rows.map((r, i) => (
                  <StaggerItem key={r.id}>
                    <PreviewRowCard
                      row={r}
                      index={i}
                      taken={isTaken(r.id, !!r.duplicate) && !r.blocked}
                      cropUrl={cropOf(r)}
                      open={openIds[r.id] ?? (rows.length <= 2 || r.attention > 0 || !!r.blocked)}
                      onToggleOpen={() => setOpenIds((m) => ({ ...m, [r.id]: !(m[r.id] ?? (rows.length <= 2 || r.attention > 0 || !!r.blocked)) }))}
                      onTake={(on) => setTaken((m) => ({ ...m, [r.id]: on }))}
                      onEdit={(e) => setEdits((list) => [...list.filter((x) => !(x.id === e.id && x.kind === e.kind && (x.kind !== "field" || (e.kind === "field" && x.key === e.key)) && (x.kind !== "time" || (e.kind === "time" && x.key === e.key)))), e])}
                    />
                  </StaggerItem>
                ))}
                <StaggerItem>
                  <p className="text-[12px] leading-relaxed text-faint">
                    {extraction.incomplete.length > 0 ? `${S.incompleteHelp} ` : ""}
                    Gelb = unsicher gelesen oder angenommen, „abgeleitet“ = aus anderen Zahlen berechnet, nicht gelesen. {S.advice}
                  </p>
                </StaggerItem>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
