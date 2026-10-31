import { useEffect, useRef, useState, type RefObject } from "react";
import { UNREACHABLE_SELECTOR } from "@/motion/a11y";
import { HoldButton, type HoldButtonProps } from "@/motion/HoldButton";
import { spring, tween } from "@/motion/tokens";

/** Tooltip of every two-path destructive button. */
export const HOLD_CONFIRM_TITLE = "Tippen fragt nach · Halten bestätigt sofort";

export interface HoldConfirmProps extends Omit<HoldButtonProps, "onConfirm" | "onRelease" | "fallback" | "title"> {
  /** A tap, click, quick Enter/Space or assistive-tech activation: ask first (the inline confirmation). */
  onAsk: () => void;
  /** A completed hold: the hold itself was the confirmation, act immediately. */
  onConfirm: () => void;
  title?: string;
}

/**
 * Destructive action with two paths (21st.dev "Hold to Confirm", adapted): holding the button fills it on
 * `tween.hold` and confirms without a second step; anything shorter – a click, a quick key press, a screen-reader
 * activation – falls back to the caller's inline confirmation (`Wirklich löschen? Ja / Nein`), so every existing
 * flow, its accessible names and its keyboard path stay intact. The short path is `HoldButton`'s
 * `onRelease(false)`; a cancelled press (pointer leaves, blur, Escape) asks nothing. `ref` is the native button
 * (`useConfirmFocus` hands focus back to it).
 */
export function HoldConfirm({ onAsk, onConfirm, title = HOLD_CONFIRM_TITLE, ...rest }: HoldConfirmProps) {
  return (
    <HoldButton
      {...rest}
      title={title}
      fallback={false}
      onConfirm={onConfirm}
      onRelease={(completed) => {
        if (!completed) onAsk();
      }}
    />
  );
}

/**
 * A ref object that runs `onAttach` whenever React attaches a new element to it. Keeps the `RefObject` shape the
 * callers pass as `ref`, while letting an element that mounts LATER (an inline confirmation that waits for the
 * previous group's exit) still receive the focus that was meant for it.
 */
function attachRef(onAttach: (el: HTMLButtonElement) => void): RefObject<HTMLButtonElement | null> {
  let current: HTMLButtonElement | null = null;
  return {
    get current() {
      return current;
    },
    set current(el: HTMLButtonElement | null) {
      current = el;
      if (el) onAttach(el);
    },
  };
}

/** Focus is "lost" when it sits on <body>, on a detached element or on one of `gone` (the group that is leaving). */
function focusLost(gone: (HTMLElement | null)[]): boolean {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected || gone.some((g) => g != null && (g === a || g.contains(a)));
}

/**
 * Focus hand-off for an inline confirmation that replaces its trigger: when it opens, focus lands on the safe
 * answer (`no`); when it closes while focus was lost with it (on `<body>` or still on the leaving `Nein`), focus
 * returns to `trigger` (the `HoldConfirm` button). Works when the swap is sequenced (the arriving element mounts
 * after the leaving one's exit): the focus is delivered when the element attaches. Focus the user moved elsewhere is
 * never taken back.
 */
export function useConfirmFocus(confirming: boolean): { trigger: RefObject<HTMLButtonElement | null>; no: RefObject<HTMLButtonElement | null> } {
  const [hand] = useState(() => createHandOff());
  const was = useRef(confirming);
  useEffect(() => {
    if (was.current === confirming) return;
    was.current = confirming;
    hand.request(confirming ? "no" : "trigger");
  }, [confirming, hand]);
  return hand.refs;
}

/** The focus hand-off state machine behind `useConfirmFocus` (outside React: refs, pending target, delivery). */
function createHandOff() {
  let want: "no" | "trigger" | null = null;
  const refs: { trigger: RefObject<HTMLButtonElement | null>; no: RefObject<HTMLButtonElement | null> } = {
    trigger: attachRef((el) => {
      if (want !== "trigger") return;
      want = null;
      if (focusLost([refs.no.current])) el.focus();
    }),
    no: attachRef((el) => {
      if (want !== "no") return;
      want = null;
      el.focus();
    }),
  };
  const request = (target: "no" | "trigger") => {
    const el = refs[target].current;
    const usable = el?.isConnected && !el.closest(UNREACHABLE_SELECTOR);
    if (!usable) {
      want = target;
      return;
    }
    want = null;
    if (target === "no" || focusLost([refs.no.current])) el.focus();
  };
  return { refs, request };
}

/**
 * Motion props for the two groups of an inline confirmation inside `AnimatePresence mode="wait" initial={false}`:
 * the leaving group fades/scales out on `tween.exit`, then the arriving one pops in (`spring.pop`) – never both at
 * once, never a one-frame cut (TR-06). Give the row a fixed min height so the swap never changes its height.
 */
export function confirmSwapMotion(reduced: boolean) {
  return {
    initial: reduced ? false : { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96, transition: tween.exit },
    transition: { default: tween.fade, scale: spring.pop },
  } as const;
}
