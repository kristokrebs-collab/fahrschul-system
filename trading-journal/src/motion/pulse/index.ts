/**
 * pulse-motion ports (120 Hz). Components and their props; each component's measured tokens are re-exported as
 * `<NAME>_CONFIG`. The pure timeline helpers stay importable from the component files (tests use them there).
 */
export * from "./engine";
export { stepSpring, springRests, type SpringState } from "./springStep";
export { createTimeline, usePlayTrigger, watchActivity, canHoverNow, springStep, type Timeline } from "./textKit";

export { AsciiCascade, CONFIG as ASCII_CASCADE_CONFIG, type AsciiCascadeProps } from "./AsciiCascade";
export { PixelTextFill, CONFIG as PIXEL_TEXT_FILL_CONFIG, type PixelTextFillProps } from "./PixelTextFill";
export { Typewriter, CONFIG as TYPEWRITER_CONFIG, type TypewriterProps } from "./Typewriter";
export { TextMorph, CONFIG as TEXT_MORPH_CONFIG, type TextMorphProps } from "./TextMorph";
export { TextPrism, CONFIG as TEXT_PRISM_CONFIG, type TextPrismProps } from "./TextPrism";
export { DancingLetters, DancingSvgWord, useDancingLetters, CONFIG as DANCING_LETTERS_CONFIG, type DancingLettersProps, type DancingSvgWordProps } from "./DancingLetters";
export { TactileHighlight, CONFIG as TACTILE_HIGHLIGHT_CONFIG, type TactileHighlightProps, type HighlightTone } from "./TactileHighlight";

export { MorphSelect, CONFIG as MORPH_SELECT_CONFIG, type MorphSelectProps, type MorphSelectOption } from "./MorphSelect";
export { Autocomplete, CONFIG as AUTOCOMPLETE_CONFIG, type AutocompleteProps, type AutocompleteItem } from "./Autocomplete";
export { NotchedFrame, CONFIG as NOTCHED_FRAME_CONFIG, type NotchedFrameProps } from "./NotchedFrame";
export { WidgetGrid, useLift, CONFIG as WIDGET_GRID_CONFIG, type WidgetGridProps, type WidgetGridItem, type LiftHandle } from "./WidgetGrid";
export { StripWipe, playStripWipe, CONFIG as STRIP_WIPE_CONFIG, type StripWipeProps, type StripWipeOptions } from "./StripWipe";
export { Marquee, CONFIG as MARQUEE_CONFIG, type MarqueeProps } from "./Marquee";

// P01: the remaining pack animations as reusable components (the app's own dock, command navigation and intro stay
// their own builds)
export { ScrubTimeline, spanProgress, scrubKey, timeAtX, playStep, formatSeconds, CONFIG as SCRUB_TIMELINE_CONFIG, type ScrubTimelineProps, type ScrubSpan, type ScrubMarker, type ScrubTone } from "./ScrubTimeline";
export { MilestoneRail, segmentSeconds, pinnedReveal, CONFIG as MILESTONE_RAIL_CONFIG, type MilestoneRailProps, type Milestone, type MilestoneTone } from "./MilestoneRail";
export { MagnifyRow, magnifyBell, magnifyLayout, CONFIG as MAGNIFY_ROW_CONFIG, type MagnifyRowProps, type MagnifyItem } from "./MagnifyRow";
export { FullscreenWipe, WipeItem, wipeItemDelay, CONFIG as FULLSCREEN_WIPE_CONFIG, type FullscreenWipeProps } from "./FullscreenWipe";
export { GlyphZoom, glyphCamera, deepestPoint, CONFIG as GLYPH_ZOOM_CONFIG, type GlyphZoomProps } from "./GlyphZoom";
export { ReelWindow, reelStart, reelAt, collapseAt, spreadAt, CONFIG as REEL_WINDOW_CONFIG, type ReelWindowProps } from "./ReelWindow";
export { CardSpread, fanPose, dealRotation, CONFIG as CARD_SPREAD_CONFIG, type CardSpreadProps } from "./CardSpread";
export { OrbitSpread, orbitPose, orbitProgress, CONFIG as ORBIT_SPREAD_CONFIG, type OrbitSpreadProps, type OrbitPose } from "./OrbitSpread";
export { LaunchGrid, LaunchSlot, launchAt, CONFIG as LAUNCH_GRID_CONFIG, type LaunchGridProps, type LaunchFrame } from "./LaunchGrid";
