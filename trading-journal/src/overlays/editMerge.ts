import { jsonEqual } from "@/store/merge3";

type Obj = Record<string, unknown>;

/**
 * Two windows, one trade (Funktionsprüfung Runde 18). The editor fills its form ONCE, when it opens. If the same trade is saved
 * somewhere else meanwhile – a second tab, another device through the sync – the form still holds the old values, and its save wrote
 * every field back: the other window's note was gone, without a word.
 *
 * Returns the fields of the form's record that must come from the trade as it is stored NOW: those this form did not touch since it
 * opened (`formAtOpen[k]` ≡ `formNow[k]`) while the stored trade changed underneath (`opened[k]` ≢ `current[k]`). A field the trader
 * changed here always wins – it is their explicit save. Stored values are compared with stored values and form values with form
 * values, so a field the form merely spells differently (`""` for a missing note) is never mistaken for an edit. `null`: nothing
 * changed underneath, or nothing of it is left to keep. Pure.
 */
export function foreignEdits(opened: Obj, current: Obj, formAtOpen: Obj, formNow: Obj): Obj | null {
  if (opened === current) return null;
  const out: Obj = {};
  let any = false;
  for (const k of Object.keys(formNow)) {
    if (!jsonEqual(formAtOpen[k], formNow[k])) continue; // changed in this form: this save wins
    if (jsonEqual(opened[k], current[k])) continue; // not changed underneath
    out[k] = current[k];
    any = true;
  }
  return any ? out : null;
}
