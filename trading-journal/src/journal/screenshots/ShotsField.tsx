import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { ExtractButton } from "@/journal/extract/ExtractButton";
import { cloudShotOwner, UPLOAD_MESSAGES } from "./cloud";
import { imagesOf } from "./image";
import { shotStorageOf, STORAGE_MESSAGES } from "./info";
import { Button } from "@/primitives/Button";
import { ShotLightbox } from "./ShotLightbox";
import { ShotThumb } from "./ShotThumb";
import { addShots, MAX_SHOTS, promoteShot } from "./shots";
import { releaseCloudShots } from "./release";
import { collectShotGarbage, referencedShotKeys, shotStorage } from "./store";

export interface ShotsFieldProps {
  value: readonly ScreenshotRef[];
  /** Functional update (an upload finishing later patches the list as it is then). */
  onChange: (update: (prev: ScreenshotRef[]) => ScreenshotRef[]) => void;
}

/**
 * Screenshots of a trade in the editor: drop images on the zone (its border turns into marching ants while something
 * is dragged over it), paste them anywhere in the open editor (Strg / ⌘ + V – text pastes stay text), or pick files.
 * Pictures are kept locally exactly as they came (IndexedDB, original bytes + SHA-256; the small preview is derived
 * separately); signed in, each original is also uploaded unchanged to the cloud in the background. Where a picture is
 * NOT saved durably (no IndexedDB, device storage full) the field says so and offers the original as a download. Thumbnails are `NotchedFrame`s that pop in (`spring.pop`, staggered) and open the `StripWipe` lightbox.
 *
 * Blobs nobody references any more (a removed picture after saving, an editor closed without saving) are collected
 * when the field unmounts – but only once the journal is loaded.
 */
export function ShotsField({ value, onChange }: ShotsFieldProps) {
  const reduced = useReducedFx();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const depth = useRef(0);
  /** Cloud objects uploaded by this field (freed at unmount unless a saved trade references them). */
  const uploads = useRef(new Set<string>());
  const alive = useRef(true);
  const countRef = useRef(value.length);
  useEffect(() => {
    countRef.current = value.length;
  }, [value.length]);

  const take = async (files: readonly Blob[]) => {
    if (!files.length) return;
    setBusy((n) => n + 1);
    try {
      const { refs, errors, notes } = await addShots(files, Math.max(0, MAX_SHOTS - countRef.current));
      if (refs.length) onChange((prev) => [...prev, ...refs]);
      if (errors.length) pushToast({ kind: "error", title: "Screenshot nicht übernommen", detail: errors[0] });
      // the device storage is FULL: a surprise, so a toast says so with the way out (without any IndexedDB the field's
      // standing note and the „nicht dauerhaft gespeichert“ panel below already say it)
      if (notes.some((n) => n.kind === "quota")) pushToast({ kind: "error", title: "Speicher voll – nicht dauerhaft gespeichert", detail: STORAGE_MESSAGES.quota, duration: 9000 });
      // signed in: copy each original to the cloud and swap the reference when it is there
      if (refs.length && cloudShotOwner()) {
        let told = false;
        for (const ref of refs) {
          // a picture that is only in memory is uploaded too: signed in, the cloud copy is what makes it durable
          void promoteShot(ref).then((r) => {
            if (!r.ok) {
              // nothing was promised without a cloud / login; a refusal or failure is told once per batch
              if (r.problem !== "unavailable" && !told && alive.current) {
                told = true;
                pushToast({ kind: "info", title: "Nur auf diesem Gerät gespeichert", detail: UPLOAD_MESSAGES[r.problem] });
              }
              return;
            }
            const cloud = r.ref;
            uploads.current.add(cloud.key!);
            // the editor closed while the upload ran: the reference can no longer reach a trade – free the object
            if (!alive.current) void releaseCloudShots([cloud.key!]);
            else onChange((prev) => prev.map((x) => (x.id === ref.id ? cloud : x)));
          });
        }
      }
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });

  // paste anywhere while the editor is open: images only, text pastes untouched
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesOf(e.clipboardData).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void takeRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // unmount (editor closed): collect the blobs no trade references, and the cloud uploads of this editor session that
  // no saved trade took (closed without saving, picture removed before saving – PRIV-01)
  useEffect(() => {
    alive.current = true;
    const mine = uploads.current;
    return () => {
      alive.current = false;
      const s = useJournal.getState();
      if (!s.loaded) return;
      void collectShotGarbage(referencedShotKeys(s.trades));
      void releaseCloudShots(mine);
    };
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    void take(imagesOf(e.dataTransfer));
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void take(files);
  };
  const full = value.length >= MAX_SHOTS;
  const memoryOnly = shotStorage() === "memory";
  const ramShots = value.filter((r) => shotStorageOf(r) === "ram");
  const [saving, setSaving] = useState(false);
  const saveAll = async () => {
    setSaving(true);
    try {
      const m = await import("./original");
      for (const r of ramShots) pushToast(m.downloadMessage(r, await m.downloadOriginal(r)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div
        className={cn("relative grid place-items-center gap-1 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors", over ? "border-transparent bg-white/[0.05]" : "border-line-2")}
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={onDrop}
        data-testid="shots-drop"
      >
        {over && <span aria-hidden="true" className="fx-ants rounded-2xl [--fx-ants-color:rgb(var(--veil-rgb,255_255_255)/0.55)] [--fx-ants-width:1.5px]" />}
        <span className="text-[13px] font-medium text-fg">{over ? "Loslassen zum Ablegen" : busy ? "Wird übernommen …" : "Screenshot hierher ziehen"}</span>
        <span className="text-[11.5px] text-mute">oder einfügen (Strg / ⌘ + V) · bis {MAX_SHOTS} Bilder</span>
        <label htmlFor={`${id}-file`} className={cn("mt-1.5 cursor-pointer rounded-full border border-line-2 px-3 py-1.5 text-[12px] text-fg transition-colors hover:border-white/40 pointer-coarse:min-h-11 pointer-coarse:py-2.5", full && "pointer-events-none opacity-40")}>
          Bild wählen
        </label>
        <input id={`${id}-file`} ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={onPick} disabled={full} />
      </div>
      {memoryOnly && <p className="text-[11.5px] text-warn">Nicht dauerhaft gespeichert: Dieser Browser erlaubt keinen lokalen Bildspeicher, Screenshots bleiben nur bis zum Neuladen.</p>}
      {ramShots.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2" role="status" data-testid="shots-ram">
          <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-warn">
            {ramShots.length === 1 ? "1 Bild ist" : `${ramShots.length} Bilder sind`} nicht dauerhaft gespeichert {memoryOnly ? "(kein lokaler Bildspeicher)" : "(Speicher voll)"} – das Original bleibt unverändert, solange diese Seite offen ist.
          </p>
          <Button size="sm" onClick={() => void saveAll()} loading={saving} data-testid="shots-ram-download">
            {ramShots.length === 1 ? "Original herunterladen" : "Originale herunterladen"}
          </Button>
        </div>
      )}
      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="Screenshots">
          <AnimatePresence initial={false}>
            {value.map((shot, i) => (
              <motion.li
                key={shot.id}
                layout="position"
                className="relative"
                initial={reduced ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: tween.exit }}
                transition={{ scale: { ...spring.pop, delay: Math.min(i, stagger.max) * stagger.cards }, opacity: tween.fade, layout: spring.layout }}
                style={{ borderRadius: radius.card }}
              >
                <ShotThumb shot={shot} index={i} onOpen={() => setView(i)} badge />
                <button
                  type="button"
                  aria-label={`Screenshot ${i + 1} entfernen`}
                  onClick={() => onChange((prev) => prev.filter((r) => r.id !== shot.id))}
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-ink-950/85 text-mute transition-colors hover:text-loss pointer-coarse:size-11"
                >
                  <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <ExtractButton shots={value} />
      <ShotLightbox shots={value} index={view} onIndex={setView} onClose={() => setView(null)} />
    </div>
  );
}
