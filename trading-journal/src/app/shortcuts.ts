/**
 * Keyboard shortcuts (P13): one registry, a pure matcher and the guard rules – the host (`ShortcutHost.tsx`) only wires
 * them to `keydown`.
 *
 *   g + Buchstabe   page (`PAGE_KEYS`: o Übersicht, t Trades, s Entscheidungsgrundlagen, e Einstellungen, m Markt, h Handelsplan,
 *                   i Aktien, r Risiko, a Analyse, b Berichte, c Coach, w Wachstum, l Labor, u Strategie-Studio, g Community,
 *                   d Cockpit, k Konto, p Preise, f Funktionen – one letter each, the sheet lists them in the order of `PAGES`)
 *   n               new trade                     /  or ⌘⇧F / Ctrl+⇧F   global search
 *   a               assistant
 *   ?               this sheet                    [  ]                  previous / next page
 *   t               light / dark                  ⌘K / Ctrl+K           navigation (CommandNav, unchanged)
 *
 * Never in the way: nothing fires while focus is in a text field, select or editable element, while a modal dialog is
 * open, during IME composition, or with Ctrl / ⌘ / Alt held (⌘K stays CommandNav's; AltGr – Ctrl+Alt on Windows,
 * which German keyboards need for `[` `]` – counts as no modifier). A `g` waits `CHORD_MS` for its letter.
 */
import { create } from "zustand";
import { PAGE_LABELS } from "@/app/Dock";
import { navigate } from "@/store/router";
import { toggleTheme } from "@/store/themeStore";
import { NAV_ORDER, PAGE_KEYS, PAGES, useUi, type Page } from "@/store/uiStore";
import { openAssistant } from "@/assistant/open";
import { openSearch } from "@/search/searchStore";

export const CHORD_MS = 1200;

export type ShortcutGroup = "Navigation" | "Aktionen" | "Suche & Hilfe";
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Navigation", "Aktionen", "Suche & Hilfe"];

export interface ShortcutDef {
  id: string;
  /** key caps as shown (`["g", "t"]`, `["⌘", "K"]`) */
  keys: string[];
  label: string;
  group: ShortcutGroup;
  /** absent = handled elsewhere (listed for the sheet only) */
  run?: () => void;
}

/* ------------------------------------------------------------------------------------------------- the sheet store */

interface SheetState {
  open: boolean;
  /** the sheet chunk was requested once (it stays mounted afterwards, so its close animation can run) */
  loaded: boolean;
}
export const useShortcutSheet = create<SheetState>(() => ({ open: false, loaded: false }));
export function openShortcutSheet(): void {
  useShortcutSheet.setState({ open: true, loaded: true });
}
export function closeShortcutSheet(): void {
  useShortcutSheet.setState({ open: false });
}
export function toggleShortcutSheet(): void {
  if (useShortcutSheet.getState().open) closeShortcutSheet();
  else openShortcutSheet();
}

/* --------------------------------------------------------------------------------------------------- the registry */

const label = (p: Page): string => (PAGE_LABELS as Partial<Record<string, string>>)[p] ?? p;

/** `[` / `]`: the previous / next page in navigation order (dock tabs first, then the rest – like the slide direction). */
function stepPage(dir: 1 | -1): void {
  const i = NAV_ORDER.indexOf(useUi.getState().page);
  const next = NAV_ORDER[(i + dir + NAV_ORDER.length) % NAV_ORDER.length]!;
  navigate(next);
}

/** The whole list (pages derived from `PAGES` / `PAGE_KEYS` at call time). */
export function shortcutList(): ShortcutDef[] {
  const pages: ShortcutDef[] = PAGES.map((p) => ({
    id: `go-${p}`,
    keys: ["g", (PAGE_KEYS as Record<string, string>)[p] ?? "?"],
    label: `Zu ${label(p)}`,
    group: "Navigation",
    run: () => navigate(p),
  }));
  return [
    ...pages,
    { id: "page-prev", keys: ["["], label: "Vorherige Seite", group: "Navigation", run: () => stepPage(-1) },
    { id: "page-next", keys: ["]"], label: "Nächste Seite", group: "Navigation", run: () => stepPage(1) },
    { id: "nav", keys: ["⌘", "K"], label: "Navigation öffnen (Ctrl+K)", group: "Navigation" },
    { id: "new-trade", keys: ["n"], label: "Neuen Trade eintragen", group: "Aktionen", run: () => useUi.getState().openEditor() },
    { id: "assistant", keys: ["a"], label: "Assistent öffnen", group: "Aktionen", run: () => openAssistant() },
    { id: "theme", keys: ["t"], label: "Hell / Dunkel umschalten", group: "Aktionen", run: () => toggleTheme() },
    { id: "search", keys: ["/"], label: "Suche öffnen", group: "Suche & Hilfe", run: () => openSearch() },
    { id: "search-mod", keys: ["⌘", "⇧", "F"], label: "Suche öffnen (Ctrl+⇧+F)", group: "Suche & Hilfe", run: () => openSearch() },
    { id: "help", keys: ["?"], label: "Diese Übersicht", group: "Suche & Hilfe", run: () => toggleShortcutSheet() },
    { id: "close", keys: ["Esc"], label: "Dialog schließen", group: "Suche & Hilfe" },
  ];
}

/* ---------------------------------------------------------------------------------------------- matcher + guards */

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  repeat?: boolean;
  /** AltGr state (`getModifierState("AltGraph")`) */
  altGraph?: boolean;
}

/** ⌘⇧F / Ctrl+Shift+F – the one modified shortcut of this registry. */
export function isSearchCombo(e: KeyLike): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
}

/** Editable targets swallow every single-key shortcut. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== "function") return false;
  const el = t as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(type);
  }
  return !!el.closest('[contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]');
}

/** A modal dialog other than the one named is open (CommandNav, sheets, detail, search, intro stage). */
export function modalOpen(doc: Document = document): boolean {
  return !!doc.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
}

/** Plain key = no Ctrl / ⌘ / Alt (AltGr allowed: German `[` `]` `/`). */
const plain = (e: KeyLike): boolean => !e.metaKey && (e.altGraph || (e.ctrlKey && e.altKey) ? true : !e.ctrlKey && !e.altKey);

export interface ChordState {
  /** `g` pressed at this time (ms), else null */
  g: number | null;
}

export type MatchResult = { kind: "run"; def: ShortcutDef } | { kind: "chord" } | { kind: "none" };

/**
 * Pure: what a key press means given the chord state. `now` in ms. The caller has already applied the guards
 * (editable target, open modal, composition) – except for the search combo, which works from anywhere.
 */
export function matchKey(e: KeyLike, chord: ChordState, now: number, list: readonly ShortcutDef[] = shortcutList()): { result: MatchResult; chord: ChordState } {
  if (isSearchCombo(e)) {
    const def = list.find((d) => d.id === "search-mod");
    return { result: def ? { kind: "run", def } : { kind: "none" }, chord: { g: null } };
  }
  if (!plain(e) || e.repeat) return { result: { kind: "none" }, chord: { g: null } };
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (chord.g !== null && now - chord.g <= CHORD_MS) {
    const def = list.find((d) => d.keys.length === 2 && d.keys[0] === "g" && d.keys[1] === key && d.run);
    return { result: def ? { kind: "run", def } : { kind: "none" }, chord: { g: null } };
  }
  if (key === "g") return { result: { kind: "chord" }, chord: { g: now } };
  const single = e.key === "?" ? "?" : key;
  const def = list.find((d) => d.keys.length === 1 && d.keys[0] === single && d.run);
  return { result: def ? { kind: "run", def } : { kind: "none" }, chord: { g: null } };
}
