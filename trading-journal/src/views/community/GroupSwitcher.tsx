import { useMemo } from "react";
import { DotMatrix } from "@/motion/DotMatrix";
import { MagnifyRow, type MagnifyItem } from "@/motion/pulse/MagnifyRow";
import type { GroupSummary } from "@/social/contract";
import { matrixSafe } from "@/social/pseudonym";
import { selectGroup } from "@/social/store";
import { GROUP_KIND_LABEL, GROUPS } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";

/** Two letters of a group name for its dot-matrix tile ("Morgenrunde" → "MO", "Desk Berlin" → "DB"). */
export function groupMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "?").slice(0, 2);
  return matrixSafe(raw).replace(/[^A-Z0-9]/g, "").slice(0, 2) || "?";
}

/**
 * Group switcher (P12): the dock's magnification remix (`MagnifyRow`) with a dot-matrix monogram per group plus "neu"
 * and "beitreten" – hover devices get the bell, touch a plain row; arrows / Home / End move the roving focus.
 * The row scrolls sideways on narrow screens (labels keep their headroom above).
 */
export function GroupSwitcher({ groups, active, onCreate, onJoin }: { groups: readonly GroupSummary[]; active: string | null; onCreate: () => void; onJoin: () => void }) {
  const items = useMemo<MagnifyItem[]>(
    () => [
      ...groups.map((g) => ({
        id: g.id,
        label: `${g.name} · ${GROUP_KIND_LABEL[g.kind]}${g.openReviews ? ` · ${g.openReviews} offen` : ""}`,
        active: g.id === active,
        onSelect: () => selectGroup(g.id),
        icon: (
          <span className="relative grid place-items-center">
            <DotMatrix text={groupMonogram(g.name)} size={2} gap={1} tone={g.id === active ? "fg" : "mute"} glow={g.id === active} />
            {g.openReviews > 0 && <span aria-hidden="true" className="absolute -right-2.5 -top-2.5 size-2 rounded-full bg-signal" />}
          </span>
        ),
      })),
      { id: "__create", label: GROUPS.create, onSelect: onCreate, icon: <span className="grid size-5 place-items-center"><Glyph name="plus" className="size-5" /></span> },
      { id: "__join", label: GROUPS.join, onSelect: onJoin, icon: <span className="grid size-5 place-items-center"><Glyph name="users" className="size-5" /></span> },
    ],
    [groups, active, onCreate, onJoin],
  );
  return (
    <div className="-mx-1 -mt-3 max-w-full overflow-x-auto px-1 pb-1 pt-7 [scrollbar-width:none]" data-testid="group-switcher">
      <MagnifyRow items={items} label={GROUPS.switcher} size={44} gap={6} />
    </div>
  );
}
