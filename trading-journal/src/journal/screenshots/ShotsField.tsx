import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { ScreenshotRef } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { cloudShotOwner } from "./cloud";
import { imagesOf } from "./image";
import { ShotLightbox } from "./ShotLightbox";
import { ShotThumb } from "./ShotThumb";
import { addShots, MAX_SHOTS, promoteToCloud } from "./shots";
import { collectShotGarbage, referencedShotKeys, shotStorage } from "./store";

export interface ShotsFieldProps {
  value: readonly ScreenshotRef[];
  /** Functional update (an upload finishing later patches the list as it is then). */
  onChange: (update: (prev: ScreenshotRef[]) => ScreenshotRef[]) => void;
}

/**
 * Screenshots of a trade in the editor: drop images on the zone (its border turns into marching ants while something
 * is dragged over it), paste them anywhere in the open editor (Strg / ⌘ + V – text pastes stay text), or pick files.
 * Pictures are shrunk and kept locally (IndexedDB); signed in, each one is also uploaded to the cloud in the
 * background. Thumbnails are `NotchedFrame`s that pop in (`spring.pop`, staggered) and open the `StripWipe` lightbox.
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
  const countRef = useRef(value.length);
  useEffect(() => {
    countRef.current = value.length;
  }, [value.length]);

  const take = async (files: readonly Blob[]) => {
    if (!files.length) return;
    setBusy((n) => n + 1);
    try {
      const { refs, errors } = await addShots(files, Math.max(0, MAX_SHOTS - countRef.current));
      if (refs.length) onChange((prev) => [...prev, ...refs]);
      if (errors.length) pushToast({ kind: "error", title: "Screenshot nicht übernommen", detail: errors[0] });
      // signed in: copy each picture to the cloud and swap the reference when it is there
      if (refs.length && cloudShotOwner()) {
        for (const ref of refs) {
          void promoteToCloud(ref).then((cloud) => {
            if (cloud) onChange((prev) => prev.map((r) => (r.id === ref.id ? cloud : r)));
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

  // unmount (editor closed): collect the blobs no trade references
  useEffect(
    () => () => {
      const s = useJournal.getState();
      if (!s.loaded) return;
      void collectShotGarbage(referencedShotKeys(s.trades));
    },
    [],
  );

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
        {over && <span aria-hidden="true" className="fx-ants rounded-2xl [--fx-ants-color:rgb(255_255_255/0.55)] [--fx-ants-width:1.5px]" />}
        <span className="text-[13px] font-medium text-fg">{over ? "Loslassen zum Ablegen" : busy ? "Wird übernommen …" : "Screenshot hierher ziehen"}</span>
        <span className="text-[11.5px] text-mute">oder einfügen (Strg / ⌘ + V) · bis {MAX_SHOTS} Bilder</span>
        <label htmlFor={`${id}-file`} className={cn("mt-1.5 cursor-pointer rounded-full border border-line-2 px-3 py-1.5 text-[12px] text-fg transition-colors hover:border-white/40 pointer-coarse:min-h-11 pointer-coarse:py-2.5", full && "pointer-events-none opacity-40")}>
          Bild wählen
        </label>
        <input id={`${id}-file`} ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={onPick} disabled={full} />
      </div>
      {memoryOnly && <p className="text-[11.5px] text-warn">Dieser Browser erlaubt keinen lokalen Bildspeicher: Screenshots bleiben nur bis zum Neuladen.</p>}
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
      <ShotLightbox shots={value} index={view} onIndex={setView} onClose={() => setView(null)} />
    </div>
  );
}
