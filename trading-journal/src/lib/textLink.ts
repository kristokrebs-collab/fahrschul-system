/**
 * The quiet text link of the pages (a `button` that reads like a link: "Neuester", "Alle anzeigen", "Code entfernen"):
 * muted, underlined with the hairline colour, turning to full ink on hover and keyboard focus over 200 ms, a 44 × 44 tap
 * area on coarse pointers without a layout change. One recipe instead of eight hand-written ones, so hover, focus and
 * disabled look the same everywhere (the focus ring itself is the global `:focus-visible`). Same look as the
 * "Auch hier" links (`app/FeatureLinks`).
 */
export const textLink =
  "touch-hit text-mute underline decoration-line-2 underline-offset-4 transition-colors duration-200 hover:text-fg hover:decoration-fg focus-visible:text-fg focus-visible:decoration-fg disabled:opacity-40";
