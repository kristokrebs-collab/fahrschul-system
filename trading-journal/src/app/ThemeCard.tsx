import { AnimatePresence, motion } from "motion/react";
import { useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { ACCENTS, THEME_PREFS, THEME_STRINGS, useTheme, type Accent, type ThemeOrigin, type ThemePref } from "@/store/themeStore";

/**
 * "Darstellung" (P13, mounted by the settings page – see `src/app/README.md`): Dunkel / Hell / System as three live
 * miniature pages, plus the one accent. A pick starts the circular reveal from the tapped tile (`themeTransition.ts`).
 * Both groups are radio groups (arrow keys move and select, like native radios).
 */

/** Fixed preview palettes: the miniatures always show the scheme they stand for, whatever the page currently shows. */
const PREVIEW = {
  dark: { page: "#0a0a0a", card: "#111", line: "#2c2c2c", ink: "#f2f2f2", soft: "#5f5f5f" },
  light: { page: "#ebebe9", card: "#fdfdfc", line: "#cfcfcb", ink: "#121212", soft: "#9a9a9a" },
} as const;

/** Swatch per accent in its dark / light shade (mirrors `themes.css`). */
export const ACCENT_SWATCH: Record<Accent, { dark: string; light: string }> = {
  signal: { dark: "#e5202e", light: "#e5202e" },
  kobalt: { dark: "#3d6bff", light: "#2a55e6" },
  violett: { dark: "#9466ff", light: "#7444e0" },
};

function originOf(el: HTMLElement): ThemeOrigin {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

/** Roving radio keys: ←/↑ previous, →/↓ next (wrapping), Home / End. */
export function nextRadio(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function Miniature({ scheme, accent }: { scheme: "dark" | "light"; accent: string }) {
  const p = PREVIEW[scheme];
  return (
    <span className="absolute inset-0 grid grid-rows-[auto_1fr] gap-[7%] p-[9%]" style={{ background: p.page }}>
      <span className="flex items-center gap-[6%]">
        <span className="size-[9px] rounded-full" style={{ background: accent }} />
        <span className="h-[5px] w-[42%] rounded-full" style={{ background: p.ink, opacity: 0.85 }} />
      </span>
      <span className="grid grid-cols-[1.4fr_1fr] gap-[7%]">
        <span className="grid content-start gap-[12%] rounded-[7px] border p-[9%]" style={{ background: p.card, borderColor: p.line }}>
          <span className="h-[4px] w-[60%] rounded-full" style={{ background: p.soft }} />
          <span className="h-[9px] w-[80%] rounded-full" style={{ background: p.ink }} />
          <span className="h-[4px] w-[45%] rounded-full" style={{ background: p.soft }} />
        </span>
        <span className="grid content-start gap-[12%] rounded-[7px] border p-[9%]" style={{ background: p.card, borderColor: p.line }}>
          <span className="h-[4px] w-[70%] rounded-full" style={{ background: p.soft }} />
          <span className="h-[4px] w-[50%] rounded-full" style={{ background: p.soft }} />
        </span>
      </span>
    </span>
  );
}

const CHECK = (
  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

interface ModeTileProps {
  pref: ThemePref;
  active: boolean;
  accent: Accent;
  tabIndex: number;
  onPick: (e: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

function ModeTile({ pref, active, onPick, tabIndex, onKeyDown, accent, ref }: ModeTileProps) {
  const reduced = useReducedFx();
  const sw = ACCENT_SWATCH[accent];
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={tabIndex}
      onClick={onPick}
      onKeyDown={onKeyDown}
      data-theme-pref-option={pref}
      className={cn(
        "group/tile relative grid min-w-0 gap-2 rounded-2xl border p-2 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-steel/60",
        active ? "border-fg/70 bg-white/[0.04]" : "border-line-2 hover:border-white/30",
      )}
    >
      <span className="relative block aspect-[16/10] overflow-hidden rounded-[10px] border border-line transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/tile:scale-[1.02]">
        {pref === "system" ? (
          <>
            <Miniature scheme="dark" accent={sw.dark} />
            <span className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
              <Miniature scheme="light" accent={sw.light} />
            </span>
          </>
        ) : (
          <Miniature scheme={pref} accent={pref === "light" ? sw.light : sw.dark} />
        )}
      </span>
      <span className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <span className={cn("text-[13px] font-medium", active ? "text-fg" : "text-mute")}>{THEME_STRINGS.prefs[pref]}</span>
        <span className="relative grid size-5 place-items-center">
          <AnimatePresence initial={false}>
            {active && (
              <motion.span
                key="check"
                className="absolute inset-0 grid place-items-center rounded-full bg-fg text-ink-950"
                initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.6, transition: tween.exit }}
                transition={spring.pop}
              >
                {CHECK}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </span>
    </button>
  );
}

export interface ThemeCardProps {
  className?: string;
}

/** The settings card. */
export function ThemeCard({ className }: ThemeCardProps) {
  const pref = useTheme((s) => s.pref);
  const accent = useTheme((s) => s.accent);
  const resolved = useTheme((s) => s.resolved);
  const setPref = useTheme((s) => s.setPref);
  const setAccent = useTheme((s) => s.setAccent);
  const reduced = useReducedFx();
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const accentRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onModeKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = nextRadio(e.key, i, THEME_PREFS.length);
    if (n === null) return;
    e.preventDefault();
    const el = modeRefs.current[n];
    el?.focus();
    if (el) setPref(THEME_PREFS[n]!, originOf(el));
  };
  const onAccentKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = nextRadio(e.key, i, ACCENTS.length);
    if (n === null) return;
    e.preventDefault();
    const el = accentRefs.current[n];
    el?.focus();
    if (el) setAccent(ACCENTS[n]!, originOf(el));
  };

  return (
    <Card title={THEME_STRINGS.title} note={THEME_STRINGS.note} className={className}>
      <div className="grid gap-5">
        <div className="grid gap-2.5">
          <span id="theme-mode-label" className="label">
            {THEME_STRINGS.mode}
          </span>
          <div role="radiogroup" aria-labelledby="theme-mode-label" className="grid grid-cols-3 gap-2.5">
            {THEME_PREFS.map((p, i) => (
              <ModeTile
                key={p}
                ref={(el) => void (modeRefs.current[i] = el)}
                pref={p}
                active={pref === p}
                accent={accent}
                tabIndex={pref === p ? 0 : -1}
                onKeyDown={onModeKey(i)}
                onPick={(e) => setPref(p, originOf(e.currentTarget))}
              />
            ))}
          </div>
          <p className="text-[12px] text-faint">
            {pref === "system" ? `${THEME_STRINGS.systemHelp} Gerade: ${THEME_STRINGS.prefs[resolved]}.` : THEME_STRINGS.toggleHint}
          </p>
        </div>

        <div className="grid gap-2.5 border-t border-line pt-4">
          <span id="theme-accent-label" className="label">
            {THEME_STRINGS.accent}
          </span>
          <div role="radiogroup" aria-labelledby="theme-accent-label" className="flex flex-wrap gap-2">
            {ACCENTS.map((a, i) => {
              const on = accent === a;
              const swatch = resolved === "light" ? ACCENT_SWATCH[a].light : ACCENT_SWATCH[a].dark;
              return (
                <button
                  key={a}
                  ref={(el) => void (accentRefs.current[i] = el)}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-accent-option={a}
                  onKeyDown={onAccentKey(i)}
                  onClick={(e) => setAccent(a, originOf(e.currentTarget))}
                  className={cn(
                    "touch-hit inline-flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3.5 text-[12.5px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-steel/60",
                    on ? "border-fg/70 bg-white/[0.05] text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
                  )}
                >
                  <span className="relative grid size-6 place-items-center">
                    <span className="size-6 rounded-full" style={{ background: swatch } as CSSProperties} />
                    {on && (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-[-3px] rounded-full border-2"
                        style={{ borderColor: swatch }}
                        initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={spring.pop}
                      />
                    )}
                  </span>
                  {THEME_STRINGS.accents[a]}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-faint">{THEME_STRINGS.accentHelp}</p>
        </div>
      </div>
    </Card>
  );
}
