import { useMemo } from "react";
import { KeyCombo } from "@/app/Kbd";
import { closeShortcutSheet, SHORTCUT_GROUPS, shortcutList, useShortcutSheet, type ShortcutDef } from "@/app/shortcuts";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { MagnifyRow, type MagnifyItem } from "@/motion/pulse";
import { startOnboarding } from "@/onboarding/onboardingStore";

/**
 * "Tastenkürzel" (P13): the cheat sheet. On top the main keys as a `MagnifyRow` (dock-style magnification on hover;
 * each cap runs its shortcut), below the full list per group. Opened with `?`, from the search or the command
 * navigation; a `Sheet` (bottom sheet on phones), no input → never guarded.
 */
export const SHEET_STRINGS = {
  title: "Tastenkürzel",
  lead: "Alles ohne Maus. In Eingabefeldern bleiben die Tasten beim Text.",
  row: "Wichtigste Tasten",
  tour: "Einführung noch einmal ansehen",
  touch: "Auf dem Handy erreichst du alles über das Dock und das Menü oben rechts.",
} as const;

const CAPS: readonly { id: string; cap: string }[] = [
  { id: "search", cap: "/" },
  { id: "new-trade", cap: "N" },
  { id: "theme", cap: "T" },
  { id: "page-prev", cap: "[" },
  { id: "page-next", cap: "]" },
  { id: "help", cap: "?" },
];

function Cap({ text }: { text: string }) {
  return <span className="font-mono text-[17px] font-semibold leading-none text-fg">{text}</span>;
}

function Row({ def }: { def: ShortcutDef }) {
  return (
    <li className="flex min-h-10 items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="min-w-0 text-[13.5px] text-fg">{def.label}</span>
      <span className="shrink-0">
        <KeyCombo keys={def.keys} then={def.keys[0] === "g" && def.keys.length === 2} />
      </span>
    </li>
  );
}

export function ShortcutSheet() {
  const open = useShortcutSheet((s) => s.open);
  const list = useMemo(() => (open ? shortcutList() : []), [open]);
  const caps: MagnifyItem[] = useMemo(
    () =>
      CAPS.flatMap(({ id, cap }) => {
        const def = list.find((d) => d.id === id);
        if (!def) return [];
        return [
          {
            id,
            label: def.label,
            icon: <Cap text={cap} />,
            onSelect: () => {
              closeShortcutSheet();
              // the sheet's own toggle would just re-open it
              if (id !== "help") def.run?.();
            },
          },
        ];
      }),
    [list],
  );

  return (
    <Sheet open={open} onClose={closeShortcutSheet} title={SHEET_STRINGS.title} dismissGuard={false}>
      <div className="grid gap-5" data-testid="shortcut-sheet">
        <StaggerItem>
          <p className="text-[13px] text-mute">{SHEET_STRINGS.lead}</p>
        </StaggerItem>
        <StaggerItem className="grid justify-items-center gap-2 overflow-visible px-10 py-2">
          <MagnifyRow items={caps} label={SHEET_STRINGS.row} size={44} gap={8} />
        </StaggerItem>
        {SHORTCUT_GROUPS.map((g) => {
          const rows = list.filter((d) => d.group === g);
          if (!rows.length) return null;
          return (
            <StaggerItem key={g} as="section" aria-labelledby={`sc-${g}`}>
              <h3 id={`sc-${g}`} className="label mb-1 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                {g}
              </h3>
              <ul className="grid">
                {rows.map((d) => (
                  <Row key={d.id} def={d} />
                ))}
              </ul>
            </StaggerItem>
          );
        })}
        <StaggerItem className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-[12px] text-mute">{SHEET_STRINGS.touch}</span>
          <button
            type="button"
            onClick={() => {
              closeShortcutSheet();
              startOnboarding();
            }}
            className="touch-hit rounded-xl border border-line-2 bg-white/[0.03] px-3 py-1.5 text-[12.5px] font-semibold text-fg transition-colors hover:border-white/30"
          >
            {SHEET_STRINGS.tour}
          </button>
        </StaggerItem>
      </div>
    </Sheet>
  );
}

export default ShortcutSheet;
