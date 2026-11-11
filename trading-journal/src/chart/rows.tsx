import { Children, useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ElementType, type RefObject } from "react";
import { useIntroGate } from "@/intro/introStore";
import { canObserveInView, observeInView } from "@/motion/inView";
import { useReducedFx } from "@/motion/useReducedFx";
import { isRich } from "./rich";

/** Rows that are staggered; the rest of a long list is there at once (the CSS only addresses `:nth-child(-n + 12)`). */
export const ROWS_STAGGER_MAX = 12;
/** The arm/release attributes stay this long after the first view (stagger 12 × 30 ms + 420 ms), then the list is plain again. */
const RELEASE_MS = 1000;

/**
 * Lists and tables on the rich pages (Runde 10): the first rows rise one after the other the first time the list is on
 * screen. `[data-rows-arm]` holds them at opacity 0 from before the first paint, `[data-rows-go]` plays the CSS stagger
 * (`rich.css`), then both are gone. Once per element, never on a re-render or a re-sort; nothing happens outside `[data-rich]`,
 * under reduced motion or without an `IntersectionObserver`. `count` = the number of rows: a list that fills late arms when
 * its first row arrives.
 */
export function useRowsIn(ref: RefObject<HTMLElement | null>, count: number): void {
  const reduced = useReducedFx();
  const gate = useIntroGate();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || count === 0 || reduced || !gate || el.hasAttribute("data-rows-seen") || !canObserveInView() || !isRich(el)) return;
    el.setAttribute("data-rows-arm", "");
    let timer = 0;
    const off = observeInView(el, (inView) => {
      if (!inView) return;
      off();
      el.setAttribute("data-rows-seen", "");
      el.removeAttribute("data-rows-arm");
      el.setAttribute("data-rows-go", "");
      timer = window.setTimeout(() => el.removeAttribute("data-rows-go"), RELEASE_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
      el.removeAttribute("data-rows-arm");
      el.removeAttribute("data-rows-go");
    };
  }, [ref, count > 0, reduced, gate]); // eslint-disable-line react-hooks/exhaustive-deps -- only whether there are rows matters
}

type RowsProps<T extends ElementType> = { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as">;

/** `<ul>` (or `as="tbody"` / `"div"` …) whose rows rise in on the rich pages – a drop-in for a plain list container. */
export function Rows<T extends ElementType = "ul">({ as, children, ...rest }: RowsProps<T>) {
  const ref = useRef<HTMLElement>(null);
  useRowsIn(ref, Children.count(children));
  const Tag = (as ?? "ul") as ElementType;
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
