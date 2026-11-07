import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/primitives/Button";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ScreenshotRef } from "@/domain/types";
import { useBackClose, useFocusTrap, useInertOutside, useScrollLock } from "@/motion/a11y";
import { StripWipe } from "@/motion/pulse/StripWipe";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { pushToast } from "@/store/uiStore";
import { isOriginal, shotFacts } from "./info";
import { ShotImage } from "./ShotThumb";

export interface ShotLightboxProps {
  shots: readonly ScreenshotRef[];
  /** Open at this index; `null` = closed. */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  title?: string;
}

/** Contain-fit snapshot of the shown picture over the stage background (the `StripWipe` source of the next switch). */
function snapshot(stage: HTMLElement | null): HTMLCanvasElement | null {
  if (!stage) return null;
  const img = stage.querySelector("img");
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#040404";
  ctx.fillRect(0, 0, w, h);
  if (img && img.complete && img.naturalWidth > 0) {
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    try {
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } catch {
      /* unreadable picture: the strips show the plain stage */
    }
  }
  return c;
}

/**
 * The picture in the stage: the fast derived preview first; „Original ansehen“ lays the exact stored file over it and
 * shows it as soon as the browser has decoded it (a 12 MB PNG never leaves the stage empty).
 */
function LightboxPicture({ shot, original }: { shot: ScreenshotRef; original: boolean }) {
  const [ready, setReady] = useState(false);
  // toggled off: forget the loaded state, so the next look fades the original in again
  if (!original && ready) setReady(false);
  return (
    <>
      <ShotImage shot={shot} fit="contain" />
      {original && (
        <span className="absolute inset-0 transition-opacity duration-200" style={{ opacity: ready ? 1 : 0 }} data-testid="shot-original-layer" data-ready={ready || undefined}>
          <ShotImage shot={shot} fit="contain" variant="original" className="bg-ink-950" onLoaded={() => setReady(true)} />
        </span>
      )}
    </>
  );
}

/** „Original ansehen“ (toggle) and „Original herunterladen“ (the exact bytes under their own file name). */
function Actions({ shot, original, onToggle }: { shot: ScreenshotRef; original: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);
  const exact = isOriginal(shot);
  if (shot.store === "url") return null;
  const run = async () => {
    setBusy(true);
    try {
      const m = await import("./original");
      pushToast(m.downloadMessage(shot, await m.downloadOriginal(shot)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onToggle} aria-pressed={original} data-testid="shot-view-original">
        {original ? "Vorschau zeigen" : exact ? "Original ansehen" : "Größere Ansicht"}
      </Button>
      <Button size="sm" onClick={() => void run()} loading={busy} data-testid="shot-download-original">
        {exact ? "Original herunterladen" : "Version herunterladen"}
      </Button>
    </span>
  );
}

/**
 * Full-screen screenshot viewer (Journal v3). Opens with a fade + settle (`spring.enter`); switching pictures plays the
 * pulse `StripWipe` – the previous picture (a contain-fit canvas snapshot) peels away in 10 strips. ← / → and swipe
 * switch, Escape / backdrop / Android back close. It is its own modal session above whatever opened it (portal to
 * `body`, focus trap, outside isolated); Escape is caught in the capture phase, so only the viewer closes.
 */
export function ShotLightbox({ shots, index, onIndex, onClose, title = "Screenshot" }: ShotLightboxProps) {
  const reduced = useReducedFx();
  const open = index != null && shots.length > 0;
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [wipe, setWipe] = useState<{ n: number; from: HTMLCanvasElement | null }>({ n: 0, from: null });
  const [original, setOriginal] = useState<{ id: string; on: boolean }>({ id: "", on: false });
  const swipeX = useRef<number | null>(null);
  const i = index == null ? 0 : Math.min(Math.max(0, index), shots.length - 1);
  const shot = shots[i];
  const showOriginal = !!shot && original.id === shot.id && original.on;

  useFocusTrap(panelRef, open);
  useInertOutside(panelRef, open);
  useScrollLock(open);
  useBackClose(open, onClose);

  const go = (step: number) => {
    if (shots.length < 2) return;
    setWipe((w) => ({ n: w.n + 1, from: snapshot(stageRef.current) }));
    onIndex((i + step + shots.length) % shots.length);
  };
  const goRef = useRef(go);
  const closeRef = useRef(onClose);
  useEffect(() => {
    goRef.current = go;
    closeRef.current = onClose;
  });

  // keys in the capture phase: the dialog underneath (trade detail) must not see this Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goRef.current(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goRef.current(-1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") swipeX.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const x0 = swipeX.current;
    swipeX.current = null;
    if (x0 == null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && shot && (
        <motion.div
          key="lightbox"
          // a cinematic layer: the screenshots stay on ink in light mode too (themes.css dark island)
          data-theme-scope="dark"
          className="fixed inset-0 z-[75] grid place-items-center bg-black/90 p-3 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={tween.fade}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${title} ${i + 1} von ${shots.length}`}
            className="relative grid w-full max-w-[1200px] gap-3 outline-none"
            initial={reduced ? false : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0, transitionEnd: { transform: "none" } }}
            transition={{ default: spring.enter, opacity: tween.fade }}
          >
            <div className="flex items-center justify-between gap-3 text-[12px] text-mute">
              <span className="font-mono tabular-nums">
                {i + 1} / {shots.length}
                {shot.caption ? <span className="ml-2 font-sans text-fg/85">{shot.caption}</span> : null}
              </span>
              <Button size="sm" onClick={onClose} aria-label="Screenshot schließen">
                Schließen
              </Button>
            </div>
            <div
              ref={stageRef}
              className="relative h-[min(66vh,760px)] w-full touch-pan-y overflow-hidden bg-ink-950"
              style={{ borderRadius: radius.card }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (swipeX.current = null)}
            >
              <LightboxPicture key={shot.id} shot={shot} original={showOriginal} />
              <StripWipe trigger={wipe.n} from={wipe.from} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2" data-testid="shot-facts-row">
              <span className="min-w-0 text-[11.5px] leading-snug text-mute" data-testid="shot-facts">
                {shotFacts(shot)}
                {shot.sha256 ? (
                  <span className="ml-2 font-mono text-faint" title={`SHA-256 ${shot.sha256}`}>
                    SHA-256 {shot.sha256.slice(0, 10)}…
                  </span>
                ) : null}
              </span>
              <Actions key={shot.id} shot={shot} original={showOriginal} onToggle={() => setOriginal({ id: shot.id, on: !showOriginal })} />
            </div>
            {shots.length > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button type="button" onClick={() => go(-1)} aria-label="Vorheriger Screenshot" className="grid size-10 place-items-center rounded-full border border-line-2 text-fg transition-colors hover:border-white/40 pointer-coarse:size-11">
                  ‹
                </button>
                <span className="flex items-center gap-1.5" aria-hidden="true">
                  {shots.map((s, k) => (
                    <span key={s.id} className={k === i ? "h-1.5 w-4 rounded-full bg-fg" : "size-1.5 rounded-full bg-white/25"} />
                  ))}
                </span>
                <button type="button" onClick={() => go(1)} aria-label="Nächster Screenshot" className="grid size-10 place-items-center rounded-full border border-line-2 text-fg transition-colors hover:border-white/40 pointer-coarse:size-11">
                  ›
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
