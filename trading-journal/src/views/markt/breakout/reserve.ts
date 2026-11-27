/**
 * Was die Markt-Seite vom Scanner „Wer bricht aus?“ schon braucht, bevor sein Chunk da ist – ohne den Rechenkern mitzuladen: die
 * Überschrift des Abschnitts und der Platz des Blocks (`PendingBlock` in `MarktView.tsx`): die Höhe des fertigen Blocks, gemessen bei
 * 390 / 820 / 1440 px Breite (4086 / 2413 / 1465 px). Der Block hat in jedem Zustand dieselbe Höhe (zwölf feste Plätze, feste Zeilen), darum springt nichts.
 */
import type { ReserveHeight } from "@/primitives/Reserve";

export const BREAKOUT_RESERVE: ReserveHeight = { base: 4086, sm: 2413, lg: 1465 };

export const BREAKOUT_HEAD = {
  section: "Ausbruch-Scanner",
  sub: "Zwölf Märkte, eine Regel: Wer hat die Spanne der ersten 30 Minuten einer Sitzung mit einem Schluss verlassen – und was spricht dafür?",
} as const;
