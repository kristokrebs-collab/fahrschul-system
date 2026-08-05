// Shared icon library referenced by storyboard `drawing_elements`. Every
// icon is authored on a 0-100 viewBox as a list of path `d` strings, drawn
// in order — this both drives the stroke-reveal animation (one segment at a
// time) and gives the hand a natural point to travel through.
//
// Two rules keep the set coherent:
//
// 1. Order the paths the way a person would actually draw the thing —
//    outline first, then interior detail. The reveal follows this order,
//    so a badly ordered icon animates in a way that looks wrong even
//    though the final frame is fine.
// 2. Prefer beziers with slightly asymmetric control points over perfect
//    arcs. Geometrically exact circles read as clip-art; a circle that is
//    a percent or two out of true reads as ink.
//
// To add a new icon: add an entry here with the same shape, then reference
// its key from a storyboard's `drawing_elements`. If a storyboard references
// a name that isn't here, the Storyboard Agent should have flagged it as
// `NEW_ASSET_NEEDED: <description>` (see agents/06-storyboard-agent.md) —
// SceneRenderer silently skips unknown names rather than crashing a render.

export interface IconDef {
  viewBox: string;
  paths: string[];
}

const VB = "0 0 100 100";

export const ICONS: Record<string, IconDef> = {
  clock: {
    viewBox: VB,
    paths: [
      "M50,9 C73,9 91,28 91,50 C91,73 72,91 50,91 C27,91 9,72 9,50 C9,27 28,9 50,9 Z",
      "M50,20 L50,25 M80,50 L75,50 M50,80 L50,75 M20,50 L25,50",
      "M50,51 L50,26",
      "M50,51 L69,60",
    ],
  },

  "recurring-icon": {
    viewBox: VB,
    paths: [
      "M50,13 C71,13 88,30 88,51 C88,72 71,88 50,88 C33,88 19,78 14,63",
      "M10,44 L14,64 L33,59",
    ],
  },

  "credit-card": {
    viewBox: VB,
    paths: [
      "M15,20 L85,20 C89,20 92,23 92,27 L92,73 C92,77 89,80 85,80 L15,80 C11,80 8,77 8,73 L8,27 C8,23 11,20 15,20 Z",
      "M8,37 L92,37",
      "M18,50 L34,50 L34,63 L18,63 Z",
      "M45,63 L80,63",
    ],
  },

  calendar: {
    viewBox: VB,
    paths: [
      "M13,22 L87,22 C90,22 92,25 92,28 L92,85 C92,88 90,91 87,91 L13,91 C10,91 8,88 8,85 L8,28 C8,25 10,22 13,22 Z",
      "M8,41 L92,41",
      "M29,12 L29,31",
      "M71,12 L71,31",
      "M23,55 L31,55 M46,55 L54,55 M69,55 L77,55",
      "M23,73 L31,73 M46,73 L54,73",
    ],
  },

  brain: {
    viewBox: VB,
    paths: [
      "M50,13 C63,7 77,12 81,24 C93,27 96,41 88,50 C95,59 88,73 76,74 C71,85 57,89 50,80 C43,89 29,85 24,74 C12,73 5,59 12,50 C4,41 7,27 19,24 C23,12 37,7 50,13 Z",
      "M50,14 C45,29 55,35 48,47 C59,52 54,66 47,74",
      "M27,33 C34,39 34,48 29,54",
      "M73,33 C66,39 66,48 71,54",
    ],
  },

  bed: {
    viewBox: VB,
    paths: [
      "M8,45 L8,33 C8,30 10,28 13,28 L33,28 C36,28 38,30 38,33 L38,45",
      "M8,45 L87,45 C91,45 94,48 94,52 L94,79",
      "M8,42 L8,79",
      "M8,61 L94,61",
      "M8,79 L8,88 M94,79 L94,88",
    ],
  },

  "coffee-cup": {
    viewBox: VB,
    paths: [
      "M20,33 L75,33 L69,78 C68,85 62,87 56,87 L39,87 C33,87 27,85 26,78 Z",
      "M75,39 C93,39 95,56 76,68",
      "M36,25 C40,17 33,12 36,5",
      "M55,25 C59,17 52,12 55,5",
    ],
  },

  cart: {
    viewBox: VB,
    paths: [
      "M6,15 L18,15 C20,15 22,17 23,19 L34,57 L79,57 L90,26 L27,26",
      "M38,73 C38,69 41,66 45,66 C49,66 53,69 53,73 C53,77 49,80 45,80 C41,80 38,77 38,73 Z",
      "M69,73 C69,69 72,66 76,66 C80,66 84,69 84,73 C84,77 80,80 76,80 C72,80 69,77 69,73 Z",
    ],
  },

  shelf: {
    viewBox: VB,
    paths: [
      "M14,13 L14,92 M86,13 L86,92",
      "M10,13 L90,13",
      "M10,43 L90,43",
      "M10,73 L90,73",
      "M23,25 L34,25 L34,43 L23,43 Z",
      "M42,29 L54,29 L54,43 L42,43 Z",
      "M25,57 L38,57 L38,73 L25,73 Z",
    ],
  },

  phone: {
    viewBox: VB,
    paths: [
      "M36,5 L64,5 C68,5 71,8 71,12 L71,88 C71,92 68,95 64,95 L36,95 C32,95 29,92 29,88 L29,12 C29,8 32,5 36,5 Z",
      "M29,18 L71,18",
      "M29,80 L71,80",
      "M44,88 L56,88",
    ],
  },

  coin: {
    viewBox: VB,
    paths: [
      "M50,9 C73,9 91,28 91,50 C91,73 72,91 50,91 C27,91 9,72 9,50 C9,27 28,9 50,9 Z",
      "M50,19 L50,81",
      "M62,33 C57,28 44,27 40,34 C36,42 45,46 51,49 C59,52 65,57 61,64 C57,71 44,71 39,66",
    ],
  },

  "arrow-up": {
    viewBox: VB,
    paths: ["M50,88 L50,15", "M28,37 L50,15 L72,37"],
  },

  "arrow-down": {
    viewBox: VB,
    paths: ["M50,12 L50,85", "M28,63 L50,85 L72,63"],
  },

  checkmark: {
    viewBox: VB,
    paths: ["M11,52 C20,59 31,69 39,79 C51,58 68,32 89,15"],
  },

  "x-mark": {
    viewBox: VB,
    paths: ["M19,19 C36,36 63,63 81,81", "M81,19 C64,36 37,63 19,81"],
  },

  person: {
    viewBox: VB,
    paths: [
      "M50,8 C58,8 65,15 65,23 C65,31 58,38 50,38 C42,38 35,31 35,23 C35,15 42,8 50,8 Z",
      "M50,40 L50,66",
      "M50,47 L28,58",
      "M50,47 L72,58",
      "M50,66 L36,93",
      "M50,66 L64,93",
    ],
  },

  "question-mark": {
    viewBox: VB,
    paths: [
      "M29,32 C29,17 39,9 51,9 C63,9 71,18 71,30 C71,43 56,46 52,55 L52,64",
      "M52,80 C52,77 50,75 47,75 C44,75 42,77 42,80 C42,83 44,85 47,85 C50,85 52,83 52,80 Z",
    ],
  },

  lightbulb: {
    viewBox: VB,
    paths: [
      "M50,7 C64,7 77,18 77,33 C77,45 69,51 65,60 L35,60 C31,51 23,45 23,33 C23,18 36,7 50,7 Z",
      "M37,68 L63,68",
      "M40,78 L60,78",
      "M44,88 L56,88",
      "M43,60 C43,48 57,48 57,60",
    ],
  },

  eye: {
    viewBox: VB,
    paths: [
      "M6,50 C22,26 40,18 50,18 C61,18 78,26 94,50 C78,74 61,82 50,82 C40,82 22,74 6,50 Z",
      "M50,33 C60,33 67,41 67,50 C67,60 60,67 50,67 C41,67 33,60 33,50 C33,41 41,33 50,33 Z",
      "M50,41 C55,41 59,45 59,50",
    ],
  },

  battery: {
    viewBox: VB,
    paths: [
      "M12,31 L78,31 C82,31 85,34 85,38 L85,62 C85,66 82,69 78,69 L12,69 C8,69 5,66 5,62 L5,38 C5,34 8,31 12,31 Z",
      "M85,42 L93,42 L93,58 L85,58",
      "M17,41 L17,59",
      "M30,41 L30,59",
      "M43,41 L43,59",
    ],
  },

  wall: {
    viewBox: VB,
    paths: [
      "M6,14 L94,14 L94,89 L6,89 Z",
      "M6,39 L94,39",
      "M6,64 L94,64",
      "M34,14 L34,39 M62,14 L62,39",
      "M20,39 L20,64 M48,39 L48,64 M76,39 L76,64",
      "M34,64 L34,89 M62,64 L62,89",
    ],
  },
};

export type IconName = keyof typeof ICONS;
