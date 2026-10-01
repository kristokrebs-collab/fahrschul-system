import { useEffect, useRef, type RefObject } from "react";
import { HoldButton, type HoldButtonProps } from "@/motion/HoldButton";

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
 * Focus hand-off for an inline confirmation that replaces its trigger: when it opens, focus lands on the safe
 * answer (`no`); when it closes while focus was lost with it (still on `<body>`), focus returns to `trigger` (the
 * `HoldConfirm` button). Focus the user moved elsewhere is never taken back.
 */
export function useConfirmFocus(confirming: boolean): { trigger: RefObject<HTMLButtonElement | null>; no: RefObject<HTMLButtonElement | null> } {
  const trigger = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  const was = useRef(confirming);
  useEffect(() => {
    if (was.current === confirming) return;
    was.current = confirming;
    if (confirming) {
      no.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    trigger.current?.focus();
  }, [confirming]);
  return { trigger, no };
}
