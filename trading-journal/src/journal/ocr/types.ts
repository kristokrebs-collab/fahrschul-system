/**
 * Types of the local text recognition (OCR) of the screenshot import – pure, shared by the preprocessing, the layout
 * parser and the UI. Coordinates are ALWAYS pixels of the ORIGINAL picture (the engine's scale is divided out), so a
 * row crop for the preview is just `box` of the record.
 */

/** RGBA pixels, row-major (what `ImageData` and a decoded PNG / JPEG give). */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** One channel (0 = no ink … 255 = full ink, or plain grey, see the function that makes it). */
export interface Plane {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What colour a piece of text is painted in: exchanges paint losses red and profits green. */
export type InkColor = "red" | "green" | "light" | "dim";

export interface OcrWord {
  text: string;
  /** Engine confidence 0–100. */
  conf: number;
  box: Box;
  /** Ink colour of the glyphs (from the original pixels), `undefined` when no pixels were available. */
  ink?: InkColor;
  /** 0–255 how strongly the ink stands out from the background – the active tab is stronger than the inactive ones. */
  lum?: number;
}

/** The recognised words of one picture. */
export interface OcrPage {
  /** 0-based index of the picture in the import. */
  index: number;
  width: number;
  height: number;
  words: OcrWord[];
}

/** What the preprocessing did (shown in `ocrCheck` and the tests; never needed by the parser). */
export interface PrepInfo {
  /** The picture was a dark theme (the text is lighter than the background). */
  dark: boolean;
  /** Scale factor applied before recognition. */
  scale: number;
  /** Background colour the ink was measured against. */
  background: [number, number, number];
  /** Horizontal strips (original y ranges) the picture was cut into. */
  strips: { y0: number; y1: number }[];
}
