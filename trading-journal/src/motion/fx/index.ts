/**
 * `@/motion/fx` – creative one-shot effects for the feature pages (P01). Every effect animates only transform / opacity
 * / filter / clip-path, takes its timing from `@/motion/tokens` (file-local measured values in an exported config
 * object), is reduced-motion safe (static end state), has no blur under `html[data-safe-fx]`, runs finite (the one
 * declared loop, `RadarSweep`, only while a scan runs) and is decorative (aria-hidden) with the real value kept
 * accessible. Contracts and examples: `src/motion/README.md` → "fx kit".
 */
export { FX_TONE, FX_HEX, playWaapi, useFxPlay, type FxTone, type WaapiTiming } from "./shared";
export { monotoneCurve, expApproach, smoothstep, progressIn, easeInOutCubic, type CurveKeys } from "./curve";

export { GlowBreak, GLOW_BREAK, type GlowBreakProps, type GlowBreakTone } from "./GlowBreak";
export { BreakoutStreak, BREAKOUT_STREAK, streakParticles, streakAt, streakDuration, type BreakoutStreakProps, type StreakDirection, type StreakParticle } from "./BreakoutStreak";
export { RadarSweep, RADAR_SWEEP, type RadarSweepProps } from "./RadarSweep";
export { LiquidGauge, LIQUID_GAUGE, waveKick, waveDecay, type LiquidGaugeProps } from "./LiquidGauge";
export { EquityDraw, EQUITY_DRAW, equityPoints, pointAt, type EquityDrawProps, type EquityPoint } from "./EquityDraw";
export { HeatGridReveal, HEAT_GRID, heatDelay, heatColor, type HeatGridRevealProps } from "./HeatGridReveal";
export { SplitFlap, flapDirection, flapChars, type SplitFlapProps } from "./SplitFlap";
export { CoachStream, COACH_STREAM, streamPace, streamCount, type CoachStreamProps } from "./CoachStream";
export { ConfidenceMeter, CONFIDENCE_METER, confidenceFrame, confidenceTone, type ConfidenceMeterProps } from "./ConfidenceMeter";
export { NumberCascade, NUMBER_CASCADE, lockAt, rainDigit, type NumberCascadeProps } from "./NumberCascade";
export { DissolveOut, DISSOLVE, dissolveElement, dissolveGrid, dissolveOrder, dissolvePath, type DissolveOutProps, type DissolveOptions } from "./DissolveOut";
export { SpotlightSweep, SPOTLIGHT_SWEEP, type SpotlightSweepProps } from "./SpotlightSweep";
export { celebrateStreak, celebrateRecord, STREAK_ECHO_FROM, type CelebrateTarget } from "./celebrate";
export { DotMatrixText, matrixText, PRESET_FRAMES, type DotMatrixTextProps, type DotMatrixTextPreset } from "./DotMatrixText";
