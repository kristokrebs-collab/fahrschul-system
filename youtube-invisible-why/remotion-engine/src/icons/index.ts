// Shared icon library referenced by storyboard `drawing_elements`. Every
// icon is authored on a 0-100 viewBox as a list of path `d` strings, drawn
// in order — this both drives the stroke-reveal animation (one segment at a
// time) and gives the hand a natural point to travel through.
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

export const ICONS: Record<string, IconDef> = {
  clock: {
    viewBox: "0 0 100 100",
    paths: [
      "M10,50 A40,40 0 1,1 90,50 A40,40 0 1,1 10,50",
      "M50,50 L50,26",
      "M50,50 L67,58",
    ],
  },
  "recurring-icon": {
    viewBox: "0 0 100 100",
    paths: [
      "M75,28 A34,34 0 1,0 84,55",
      "M84,38 L84,55 L67,55",
    ],
  },
  "credit-card": {
    viewBox: "0 0 100 100",
    paths: [
      "M10,28 Q10,22 16,22 L84,22 Q90,22 90,28 L90,72 Q90,78 84,78 L16,78 Q10,78 10,72 Z",
      "M10,40 L90,40",
      "M20,60 L45,60",
    ],
  },
  calendar: {
    viewBox: "0 0 100 100",
    paths: [
      "M15,20 L85,20 Q90,20 90,25 L90,85 Q90,90 85,90 L15,90 Q10,90 10,85 L10,25 Q10,20 15,20 Z",
      "M10,38 L90,38",
      "M30,10 L30,25",
      "M70,10 L70,25",
    ],
  },
  brain: {
    viewBox: "0 0 100 100",
    paths: [
      "M20,60 C8,45 15,22 38,20 C45,8 65,8 72,20 C92,20 96,45 82,55 C94,64 84,86 62,80 C52,92 30,90 26,76 C10,76 8,62 20,60 Z",
      "M50,25 C48,40 55,45 48,58 C58,60 55,72 50,78",
    ],
  },
  bed: {
    viewBox: "0 0 100 100",
    paths: [
      "M10,45 L10,35 Q10,30 15,30 L35,30 Q40,30 40,35 L40,45",
      "M10,45 L90,45 Q95,45 95,50 L95,80",
      "M10,45 L10,80",
      "M10,62 L95,62",
    ],
  },
  "coffee-cup": {
    viewBox: "0 0 100 100",
    paths: [
      "M20,32 L76,32 L70,78 Q69,86 60,86 L36,86 Q27,86 26,78 Z",
      "M76,38 Q96,38 96,55 Q96,72 75,68",
      "M35,24 Q39,15 33,8",
      "M55,24 Q59,15 53,8",
    ],
  },
  cart: {
    viewBox: "0 0 100 100",
    paths: [
      "M8,20 L20,20 L34,62 L82,62 L92,28 L26,28",
      "M38,80 A6,6 0 1,0 38,80.1",
      "M74,80 A6,6 0 1,0 74,80.1",
    ],
  },
  shelf: {
    viewBox: "0 0 100 100",
    paths: [
      "M10,18 L90,18",
      "M10,45 L90,45",
      "M10,72 L90,72",
      "M15,18 L15,90",
      "M85,18 L85,90",
    ],
  },
  phone: {
    viewBox: "0 0 100 100",
    paths: [
      "M35,8 L65,8 Q72,8 72,15 L72,85 Q72,92 65,92 L35,92 Q28,92 28,85 L28,15 Q28,8 35,8 Z",
      "M45,84 L55,84",
    ],
  },
  coin: {
    viewBox: "0 0 100 100",
    paths: [
      "M10,50 A40,40 0 1,1 90,50 A40,40 0 1,1 10,50",
      "M55,28 C40,28 40,42 55,46 C70,50 70,64 55,64 C48,64 43,60 42,55",
      "M50,20 L50,72",
    ],
  },
  "arrow-up": {
    viewBox: "0 0 100 100",
    paths: ["M50,85 L50,18", "M28,40 L50,18 L72,40"],
  },
  "arrow-down": {
    viewBox: "0 0 100 100",
    paths: ["M50,15 L50,82", "M28,60 L50,82 L72,60"],
  },
  checkmark: {
    viewBox: "0 0 100 100",
    paths: ["M15,52 L40,77 L88,20"],
  },
  "x-mark": {
    viewBox: "0 0 100 100",
    paths: ["M22,22 L78,78", "M78,22 L22,78"],
  },
  person: {
    viewBox: "0 0 100 100",
    paths: [
      "M50,10 A11,11 0 1,0 50.1,10",
      "M50,22 L50,58",
      "M50,32 L25,48",
      "M50,32 L75,48",
      "M50,58 L30,92",
      "M50,58 L70,92",
    ],
  },
  "question-mark": {
    viewBox: "0 0 100 100",
    paths: [
      "M32,32 Q32,15 50,15 Q68,15 68,32 Q68,44 50,50 L50,62",
      "M50,74 A4,4 0 1,0 50.1,74",
    ],
  },
  lightbulb: {
    viewBox: "0 0 100 100",
    paths: [
      "M50,12 A26,26 0 1,0 50.1,12",
      "M40,62 L60,62",
      "M43,74 L57,74",
      "M50,62 L50,38",
    ],
  },
  eye: {
    viewBox: "0 0 100 100",
    paths: [
      "M8,50 Q50,15 92,50 Q50,85 8,50 Z",
      "M50,50 A12,12 0 1,0 50.1,50",
    ],
  },
  battery: {
    viewBox: "0 0 100 100",
    paths: [
      "M15,32 L78,32 Q84,32 84,38 L84,62 Q84,68 78,68 L15,68 Q9,68 9,62 L9,38 Q9,32 15,32 Z",
      "M84,42 L92,42 L92,58 L84,58",
      "M22,42 L22,58",
      "M35,42 L35,58",
    ],
  },
  wall: {
    viewBox: "0 0 100 100",
    paths: [
      "M8,15 L92,15 L92,90 L8,90 Z",
      "M45,32 L55,32",
      "M50,32 L50,42",
    ],
  },
};

export type IconName = keyof typeof ICONS;
