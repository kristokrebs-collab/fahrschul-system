export * from "@/motion/tokens";
export { MotionRoot } from "@/motion/MotionRoot";
export { NoLayoutCascade, LayoutCascade } from "@/motion/NoLayoutCascade";
export { PageSwitch, type PageSwitchProps } from "@/motion/PageSwitch";
export { MorphDialogProvider, useMorphDialog, useMorphSource, useMorphDialogGuard, useCloseMorphDialogOnUnmount, type MorphDialogGuard, type MorphDialogRequest, type MorphDialogState, type MorphSourceState } from "@/motion/MorphDialog";
export { MorphCard, MorphTitle, type MorphCardProps, type MorphTitleProps } from "@/motion/MorphCard";
export { Sheet, type SheetProps } from "@/motion/Sheet";
export { HoverPill, useHoverGroup, type HoverPillProps, type HoverGroupBinding } from "@/motion/HoverPill";
export { MotionNumber, useAnimatedNumber, formatNumber, toneOf, type MotionNumberProps, type NumberTone, type FormatNumberOptions } from "@/motion/MotionNumber";
export { RollingDigits, carryPosition, intDigitCount, type RollingDigitsProps } from "@/motion/RollingDigits";
export { StatusPill, type StatusPillProps, type StatusTone, type RingCycle, type ChangeSource } from "@/motion/StatusPill";
export { useReducedFx } from "@/motion/useReducedFx";
export { usePressable, type PressableOptions, type PressableProps } from "@/motion/usePressable";
export { useMediaQuery, useCanHover, useIsDesktop } from "@/motion/useMediaQuery";
export {
  useFocusTrap,
  useScrollLock,
  useInertOutside,
  useEscape,
  useDialogBehaviour,
  SETTLE_FALLBACK_MS,
  INERT_EXEMPT_SELECTOR,
  type DialogBehaviourOptions,
} from "@/motion/a11y";
export { StaggerItem, sectionDelay, withSectionStagger, STAGGER_HIDDEN, STAGGER_SHOWN, type StaggerItemProps } from "@/motion/Stagger";
export { observeInView, canObserveInView, useFirstInView, type InViewListener } from "@/motion/inView";
export { nowMv, useNowMv, retainClock, clockHolders, msToNextSecond, CLOCK_SLACK_MS } from "@/motion/clock";
export { Reveal, RevealGroup, RevealItem, revealDelay, REVEAL_FROM, type RevealProps, type RevealGroupProps, type RevealItemProps } from "@/motion/Reveal";
export { TextShimmer, type TextShimmerProps } from "@/motion/TextShimmer";
export { TextRoll, morphGlyphs, MORPH_MAX_CHARS, type TextRollProps, type TextRollMode, type MorphGlyph } from "@/motion/TextRoll";
export { TextScramble, scrambleText, scrambleDuration, SCRAMBLE_CHARSET, type TextScrambleProps } from "@/motion/TextScramble";
export { ValueFlash, useValueFlash, flashDirection, FLASH_COOLDOWN_MS, type ValueFlashProps, type ValueFlashOptions } from "@/motion/ValueFlash";
export { LiveText, useSmoothedValue, formatLive, type LiveTextProps } from "@/motion/LiveText";
export { PulseDot, pingAllowed, PING_MIN_INTERVAL_MS, type PulseDotProps, type PulseTone } from "@/motion/PulseDot";
export { Celebrate, celebrateFrom, burstParticles, mulberry32, MAX_PARTICLES, type CelebrateFromOptions, type Particle } from "@/motion/Celebrate";
export {
  DotMatrix,
  textFrame,
  glyphFor,
  meterColumn,
  signedMeterColumn,
  meterFrame,
  chevronFrames,
  waveFrames,
  frameIndexAt,
  emptyFrame,
  normalizeFrame,
  DIGIT_GLYPHS,
  LOADER_FRAMES,
  PULSE_FRAMES,
  WAVE_FRAMES,
  SNAKE_FRAMES,
  type DotMatrixProps,
  type DotMatrixPreset,
  type DotTone,
  type Frame as DotFrame,
} from "@/motion/DotMatrix";
export { HoldButton, type HoldButtonProps, type HoldPhase } from "@/motion/HoldButton";
export { HoldConfirm, useConfirmFocus, HOLD_CONFIRM_TITLE, type HoldConfirmProps } from "@/motion/HoldConfirm";
export { Switch, type SwitchProps, type SwitchSize, type SwitchTone } from "@/motion/Switch";
