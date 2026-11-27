/**
 * Frost panel (Runde 13, Paket B) – the frosted surface of "Heute abschließen" and "Frag dein Journal": a calm headline, one line under
 * it, and the parts below building up one after the other (45 ms apart) the first time the panel is seen.
 *
 * `useSeen` is the one switch of every frost entrance: the element gets `data-in` once it is 10 % on screen (the shared observer of
 * `@/motion/inView`); without an `IntersectionObserver` it is "seen" at once, so nothing can stay hidden. The entrance itself is CSS
 * (`frost.css`: `.fr-st` with `--i`); under reduced motion it is a short crossfade without movement.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import "./frost.css";

/** Step between two parts of a frost entrance (ms) – the `--i` of `.fr-st` is multiplied by it in `frost.css`. */
export const FROST_STAGGER_MS = 45;

/** `--i` for the n-th part of a staggered frost entrance. */
export const st = (i: number): CSSProperties => ({ ["--i" as string]: i });

/** `true` once the element has been on screen (stays true). */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => !canObserveInView());
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const off = observeInView(el, (inView) => {
      if (inView) setSeen(true);
    });
    return off;
  }, [seen]);
  return [ref, seen];
}

export interface FrostPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}

export function FrostPanel({ title, note, children, className, ...rest }: FrostPanelProps) {
  const id = useId();
  const [ref, seen] = useSeen<HTMLElement>();
  return (
    <section ref={ref} className={cn("fr-panel fr-glass", className)} aria-labelledby={id} data-in={seen ? "" : undefined} {...rest}>
      <header className="fr-head fr-st" style={st(0)}>
        <h2 id={id} className="fr-h">
          {title}
        </h2>
        {note && <p className="fr-sub">{note}</p>}
      </header>
      {children}
    </section>
  );
}
