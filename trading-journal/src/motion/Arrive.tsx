import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { stagedIn } from "./stagedIn";
import { useReducedFx } from "./useReducedFx";

type ArriveTag = "div" | "p" | "span" | "li";

export interface ArriveProps extends HTMLAttributes<HTMLElement> {
  as?: ArriveTag;
  /** `false`: mount without the entrance (e.g. on the first render of the surface around it, whose own reveal is the entrance). */
  play?: boolean;
  children?: ReactNode;
}

/** px a piece rises and s it takes – shorter than a card's entrance (`stagedIn` default 8 px / 0.42 s): the piece is small and was asked for. */
export const ARRIVE_RISE = 6;
export const ARRIVE_S = 0.3;

/**
 * A piece that appears IN PLACE after an action – an option row under a switch, an inline question next to its button, a line that
 * replaces another (Bewegungsprüfung Runde 17: these stood there within one frame while everything around them moves). It rises in
 * once on mount: one native animation on the piece itself (`stagedIn`: opacity + a short rise, `fill: backwards`, nothing can stay
 * hidden), no wrapper, no React state. Give it a `key` to replay it for new content. Reduced motion and engines without Web Animations
 * (jsdom) show it at once.
 */
export function Arrive({ as = "div", play = true, children, ...rest }: ArriveProps) {
  const Tag = as as "div";
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  // the decision is taken at mount: a later change of `play` must not start an entrance on a piece that already stands
  const on = useRef(play && !reduced);
  useLayoutEffect(() => {
    if (!on.current || !ref.current) return;
    return stagedIn([ref.current], { rise: ARRIVE_RISE, duration: ARRIVE_S });
  }, []);
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
