/**
 * The room a `SectionNav` takes (53 px; 65 px with chips of 44 px on a coarse pointer) – a page whose strip loads lazily keeps
 * this room free meanwhile (`SettingsNav`), so nothing below it moves when the strip arrives. In its own module: importing
 * the strip itself would pull its chunk in.
 */
export const SECTION_NAV_BOX = "min-h-[53px] pointer-coarse:min-h-[65px]";
