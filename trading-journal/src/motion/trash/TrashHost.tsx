import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { dwell, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { holdTrash, undoTrash, useTrash, type TrashEntry } from "./trashStore";
import "./trash.css";

/** Above the sheets (z 60), under the toast island (z 95). */
const TRASH_Z = 94;

/** Small bin: the lid opens as the pill lands and closes once (`trash-lid`, CSS, transform only). */
function Bin() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px] shrink-0 text-mute" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.2 7.6l.7 8.2c.1.9.8 1.5 1.7 1.5h4.8c.9 0 1.6-.6 1.7-1.5l.7-8.2" />
      <path d="M8.4 10.2v4.2M11.6 10.2v4.2" />
      <g className="trash-lid">
        <path d="M3.6 5.9h12.8" />
        <path d="M7.9 5.9V4.5c0-.6.4-1 1-1h2.2c.6 0 1 .4 1 1v1.4" />
      </g>
    </svg>
  );
}

const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Pill({ e, reduced }: { e: TrashEntry; reduced: boolean }) {
  const held = e.state === "held" || e.state === "restoring";
  const failed = e.state === "failed";
  const busy = e.state === "restoring";
  return (
    <motion.div
      layout="position"
      data-trash-pill=""
      data-testid="trash-pill"
      data-kind={e.kind}
      data-state={e.state}
      data-held={held ? "" : undefined}
      className="pointer-events-auto relative flex max-w-full items-center gap-2.5 overflow-hidden rounded-2xl border border-line-2 bg-ink-800 py-1 pl-3.5 pr-1.5 shadow-[0_18px_50px_rgb(0_0_0/0.5)]"
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.88 }}
      animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
      exit={{ opacity: 0, y: 6, scale: 0.96, transition: tween.exit }}
      transition={{ default: spring.pop, opacity: tween.fade, layout: spring.layout }}
      onPointerEnter={() => holdTrash(e.id, true)}
      onPointerLeave={() => holdTrash(e.id, false)}
      onFocusCapture={() => holdTrash(e.id, true)}
      onBlurCapture={() => holdTrash(e.id, false)}
    >
      <Bin />
      <span className={cn("min-w-0 text-[13px] leading-snug", failed ? "text-(--color-danger-text)" : "text-fg")} data-testid="trash-text">
        {failed ? `${e.subject}: nicht wiederhergestellt` : busy ? `${e.subject} wird zurückgeholt …` : `${e.subject} entfernt`}
      </span>
      <button
        type="button"
        data-testid="trash-undo"
        disabled={busy}
        onClick={() => void undoTrash(e.id)}
        className="touch-hit min-h-11 shrink-0 rounded-xl px-3.5 text-[13px] font-semibold text-fg transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:shadow-(--ring-glow-btn) disabled:opacity-50 pointer-coarse:min-h-11"
      >
        {failed ? "Nochmal" : "Rückgängig"}
      </button>
      {/* the undo window: a bar that runs out once (CSS, transform only); stops while the pill is hovered / focused */}
      <span key={failed ? "again" : "first"} aria-hidden="true" className="trash-bar pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-fg/45" style={{ animationDuration: `${dwell.undo}s` }} />
    </motion.div>
  );
}

/**
 * Host of the Papierkorb: the pills of everything that was just removed ("Screenshot 2 entfernt · Rückgängig"), one live
 * region for the screen reader (the sentence of each event, one tick after the host is there so it is announced), and the
 * keyboard undo (Strg / ⌘ + Z while no text field has the focus). One lazy chunk, mounted by `DeferredHosts` after the first
 * removal; at rest the container is a 0 × 0 box – no empty layer over the page.
 */
export default function TrashHost() {
  const entries = useTrash((s) => s.entries);
  const announce = useTrash((s) => s.announce);
  const reduced = useReducedFx();
  const [said, setSaid] = useState({ n: 0, text: "" });

  // the host mounts together with the first entry: say the sentence one frame later, as a change of an existing region
  useEffect(() => {
    const id = setTimeout(() => setSaid(announce), 80);
    return () => clearTimeout(id);
  }, [announce]);

  useEffect(() => {
    if (!entries.length) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() !== "z" || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || typing(ev.target)) return;
      const last = useTrash.getState().entries.at(-1);
      if (!last) return;
      ev.preventDefault();
      void undoTrash(last.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries.length]);

  const idle = entries.length === 0;
  return (
    <div
      data-trash-host=""
      data-layer="Papierkorb"
      data-idle={idle ? "" : undefined}
      role="status"
      aria-live="polite"
      style={{ zIndex: TRASH_Z }}
      className={cn(
        idle
          ? "pointer-events-none fixed bottom-0 left-0 size-0 overflow-hidden"
          : "pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] mx-auto flex max-w-[520px] flex-col items-center gap-2 px-4",
      )}
    >
      <span className="sr-only" data-testid="trash-live" key={said.n}>
        {said.text}
      </span>
      <NoLayoutCascade>
        <AnimatePresence initial={false}>
          {entries.map((e) => (
            <Pill key={e.id} e={e} reduced={reduced} />
          ))}
        </AnimatePresence>
      </NoLayoutCascade>
    </div>
  );
}
