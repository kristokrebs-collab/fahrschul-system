import { motion, useIsPresent, type Transition } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PAGE_LABELS } from "@/app/Dock";
import { KeyCombo, Kbd } from "@/app/Kbd";
import { fullscreenSupported } from "@/app/pwa";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { HoverPill, isRealHover } from "@/motion/HoverPill";
import { FULLSCREEN_WIPE_CONFIG } from "@/motion/pulse";
import { STAGGER_HIDDEN, STAGGER_SHOWN, StaggerItem } from "@/motion/Stagger";
import { TextScramble } from "@/motion/TextScramble";
import { stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { useOverlayLane } from "@/primitives/toastStore";
import { canDownload } from "@/store/download";
import { useEnriched, useJournal } from "@/store/journalStore";
import { PAGE_KEYS, PAGES } from "@/store/uiStore";
import type { MatchRange } from "./fuzzy";
import { KindGlyph, SearchGlyph } from "./glyphs";
import { flatHits, searchIndex, suggestions, type SearchGroup, type SearchHit } from "./rank";
import { closeSearch, rememberRecent, useSearch } from "./searchStore";
import { buildSearchIndex, KIND_LABEL, type CommandId, type SearchTone } from "./sources";

/**
 * The global search overlay (P13): a light remix of the pulse `FullscreenWipe` – a red signal curtain leads, the ink
 * panel wipes in behind it (transform-only: shell in, content counter-translated), the result rows fade up in the
 * section stagger, the first open of a session decodes the suggestion titles once (`TextScramble`), and a `HoverPill`
 * follows the active row (pointer or arrow keys). Combobox + listbox semantics, `useDialogBehaviour` (focus trap,
 * Escape, Android back, scroll lock), toast lane on top while open, `data-layer="Suche"`.
 *
 * Mounted (lazily) by `GlobalSearchHost` inside its `AnimatePresence`; the chosen action runs after the exit.
 */

/** Light-variant timings (pack `FullscreenWipe` curves; the panel is ~⅓ of the screen, so the wipe is ⅔ as long). */
export const CONFIG = {
  wipeMs: Math.round(FULLSCREEN_WIPE_CONFIG.wipeMs * 0.65),
  wipeEase: FULLSCREEN_WIPE_CONFIG.wipeEase,
  curtainLead: FULLSCREEN_WIPE_CONFIG.curtainLead,
  /** rows start once the panel is mostly in */
  listDelay: 0.24,
  /** suggestions decoded on the first open of the session */
  scrambleRows: 6,
} as const;

export const SEARCH_STRINGS = {
  label: "Suche",
  placeholder: "Trades, Setups, Seiten, Einstellungen …",
  close: "Suche schließen",
  empty: "Nichts gefunden",
  emptyHint: "Anders schreiben oder weniger Wörter – die Suche verzeiht Tippfehler.",
  hints: { move: "wählen", open: "öffnen", close: "schließen", keys: "Tastenkürzel" },
  results: (n: number) => (n === 1 ? "1 Treffer" : `${n} Treffer`),
} as const;

const WIPE: Transition = { duration: CONFIG.wipeMs / 1000, ease: CONFIG.wipeEase };

/** Session flag: the suggestion titles decode only on the first open. */
let decodedOnce = false;

const TONE: Record<SearchTone, string> = { win: "text-win", loss: "text-loss", signal: "text-signal", mute: "text-faint" };

function Highlighted({ text, ranges }: { text: string; ranges: readonly MatchRange[] }) {
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(
      <mark key={i} className="rounded-[3px] bg-signal/15 px-px text-fg">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    at = r.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function useIndex() {
  const trades = useEnriched();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  const recent = useSearch((s) => s.recent);
  // the index is built once per open (the overlay mounts per open) – `now` is taken with it
  const [now] = useState(() => Date.now());
  const items = useMemo(() => {
    const fs = fullscreenSupported();
    const dl = canDownload();
    const available = (id: CommandId) => (id === "fullscreen" ? fs : id === "export-json" || id === "export-csv" ? dl : true);
    return buildSearchIndex({ trades, settings, days, pages: PAGES, labels: PAGE_LABELS, pageKeys: PAGE_KEYS, now, commandAvailable: available });
  }, [trades, settings, days, now]);
  return { items, trades, settings, recent };
}

export function GlobalSearch() {
  const reduced = useReducedFx();
  const present = useIsPresent();
  const seed = useSearch((s) => s.seed);
  const [query, setQuery] = useState(seed);
  const [active, setActive] = useState(0);
  const [opened, setOpened] = useState(reduced);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const { items, trades, settings, recent } = useIndex();
  const [decode] = useState(() => !decodedOnce && !reduced);
  useEffect(() => {
    decodedOnce = true;
  }, []);

  useDialogBehaviour(ref, present, () => closeSearch(), { settled: present ? opened : false, fallbackFocus: () => null });
  useOverlayLane(present);

  const groups: SearchGroup[] = useMemo(() => (query.trim() ? searchIndex(items, query) : suggestions({ items, trades, settings, recent })), [items, query, trades, settings, recent]);
  const flat = useMemo(() => flatHits(groups), [groups]);
  /** flat index of each group's first row */
  const offsets = useMemo(() => groups.map((_, k) => groups.slice(0, k).reduce((n, g) => n + g.hits.length, 0)), [groups]);
  const at = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeHit = at >= 0 ? flat[at] : undefined;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  // focus the field as soon as the panel exists (the dialog hook keeps focus inside afterwards)
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // keep the active row in view while arrowing
  useEffect(() => {
    if (at < 0) return;
    document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable `uid`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    rememberRecent(hit.item.id);
    closeSearch(hit.item.action);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (Math.min(a, flat.length - 1) + d + flat.length) % flat.length);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeHit);
    }
  };

  const delay = reduced ? 0 : CONFIG.curtainLead / 1000;

  return (
    <div className="fixed inset-0 z-[76]" data-layer="Suche">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-ink-950/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: tween.fade }}
        exit={{ opacity: 0, transition: tween.exit }}
        onClick={() => closeSearch()}
      />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(9vh,64px)]">
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={SEARCH_STRINGS.label}
          tabIndex={-1}
          className="pointer-events-auto relative w-full max-w-[720px] overflow-hidden rounded-[24px] outline-none shadow-dialog"
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: tween.exit }}
        >
          {/* signal curtain: leads the ink panel by `curtainLead` (decorative), gone once the panel has landed */}
          {!reduced && !opened && (
            <motion.div
              aria-hidden="true"
              className="absolute inset-[1px] rounded-[inherit] bg-signal"
              initial={{ transform: "translateX(-101%)" }}
              animate={{ transform: "translateX(0%)" }}
              transition={WIPE}
            />
          )}
          <motion.div
            className="relative border border-line-2 bg-ink-850 [border-radius:inherit]"
            initial={reduced ? { opacity: 0 } : { transform: "translateX(-101%)" }}
            animate={reduced ? { opacity: 1 } : { transform: "translateX(0%)" }}
            transition={reduced ? { duration: 0 } : { ...WIPE, delay }}
            onAnimationComplete={() => setOpened(true)}
          >
            <motion.div
              initial={reduced ? false : { transform: "translateX(101%)" }}
              animate={{ transform: "translateX(0%)" }}
              transition={{ ...WIPE, delay }}
              className="relative"
            >
              {/* field */}
              <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
                <SearchGlyph className="size-[18px] shrink-0 text-mute" />
                <input
                  ref={input}
                  role="combobox"
                  aria-expanded={flat.length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={at >= 0 ? optionId(at) : undefined}
                  aria-label={SEARCH_STRINGS.label}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  value={query}
                  placeholder={SEARCH_STRINGS.placeholder}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  // the panel is the focus frame (the field is its only text input) – no second ring inside it
                  style={{ outline: "none" }}
                  className="min-w-0 flex-1 bg-transparent text-[16px] text-fg placeholder:text-faint sm:text-[17px]"
                />
                <button
                  type="button"
                  onClick={() => closeSearch()}
                  aria-label={SEARCH_STRINGS.close}
                  className="touch-hit shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-steel/60"
                >
                  <Kbd>Esc</Kbd>
                </button>
              </div>

              {/* results */}
              <div className="max-h-[min(62dvh,560px)] overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
                {flat.length === 0 ? (
                  <div className="grid justify-items-center gap-3 px-6 py-10 text-center">
                    <DotMatrixText text="0" tone="mute" size={5} decorative />
                    <p className="text-[14px] font-medium text-fg">{SEARCH_STRINGS.empty}</p>
                    <p className="max-w-[34ch] text-[12.5px] text-faint">{SEARCH_STRINGS.emptyHint}</p>
                  </div>
                ) : (
                  <motion.div
                    id={listId}
                    role="listbox"
                    aria-label={query.trim() ? SEARCH_STRINGS.results(flat.length) : KIND_LABEL.best}
                    key={query.trim() ? "q" : "s"}
                    initial={reduced ? false : STAGGER_HIDDEN}
                    animate={STAGGER_SHOWN}
                    transition={{ delayChildren: (i: number) => (opened ? 0 : CONFIG.listDelay) + Math.min(i, stagger.max) * stagger.rows }}
                    className="grid gap-1"
                  >
                    {groups.map((g, gIndex) => (
                      <div key={g.kind} role="group" aria-labelledby={`${uid}-g-${g.kind}`} className="grid gap-0.5 pb-1">
                        <StaggerItem>
                          <span id={`${uid}-g-${g.kind}`} className={cn("label flex items-center gap-2 px-3 pb-1 pt-2", g.kind === "best" && "text-fg")}>
                            {g.kind === "best" && <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />}
                            {KIND_LABEL[g.kind]}
                          </span>
                        </StaggerItem>
                        {g.hits.map((hit, hIndex) => {
                          const i = offsets[gIndex]! + hIndex;
                          const on = i === at;
                          const it = hit.item;
                          const kind = g.kind === "best" || g.kind === "recent" ? it.kind : g.kind;
                          const scramble = decode && !query.trim() && i < CONFIG.scrambleRows;
                          return (
                            <StaggerItem key={it.id}>
                              <div
                                id={optionId(i)}
                                role="option"
                                aria-selected={on}
                                data-search-kind={it.kind}
                                onPointerMove={() => {
                                  if (!on && isRealHover()) setActive(i);
                                }}
                                onClick={() => choose(hit)}
                                className={cn(
                                  "relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 outline-none",
                                  g.kind === "best" && "py-2.5",
                                )}
                              >
                                <HoverPill show={on} group="search" />
                                <span
                                  className={cn(
                                    "relative grid size-8 shrink-0 place-items-center rounded-lg border",
                                    g.kind === "best" ? "border-signal/40 bg-signal/10 text-signal" : "border-line-2 bg-white/[0.03] text-mute",
                                  )}
                                >
                                  <KindGlyph kind={kind} className="size-4" />
                                </span>
                                <span className="relative grid min-w-0 flex-1 gap-0.5">
                                  <span className={cn("truncate text-[14px] font-medium", on ? "text-fg" : "text-fg/90")}>
                                    {scramble ? <TextScramble text={it.title} /> : <Highlighted text={it.title} ranges={hit.ranges} />}
                                  </span>
                                  {it.subtitle && <span className="truncate text-[12px] text-faint">{it.subtitle}</span>}
                                </span>
                                {it.meta && <span className={cn("relative shrink-0 font-mono text-[12.5px] tabular-nums", TONE[it.metaTone ?? "mute"])}>{it.meta}</span>}
                                {!it.meta && it.keys && (
                                  <span className="relative hidden shrink-0 sm:inline-flex">
                                    <KeyCombo keys={it.keys.split(" ")} then={it.keys.startsWith("g ")} size="sm" />
                                  </span>
                                )}
                              </div>
                            </StaggerItem>
                          );
                        })}
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>

              {/* hints */}
              <div className="hidden items-center gap-4 border-t border-line px-5 py-2.5 text-[11.5px] text-faint sm:flex">
                <span className="inline-flex items-center gap-1.5">
                  <KeyCombo keys={["↑", "↓"]} size="sm" /> {SEARCH_STRINGS.hints.move}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd size="sm">↵</Kbd> {SEARCH_STRINGS.hints.open}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd size="sm">Esc</Kbd> {SEARCH_STRINGS.hints.close}
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <Kbd size="sm">?</Kbd> {SEARCH_STRINGS.hints.keys}
                </span>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
