/**
 * One task of a trader's day as a large, calm tile: icon, name, one sentence, how many functions and whether they are all
 * finished (a green dot) or some are partial (an amber dot, said in words next to it). A tap opens the group's list.
 * Calm: the border on hover, a slight give under a press and the staggered fade-in the page gives each tile.
 */
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useRichFx } from "@/motion/rich";
import { pressScale } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useHoverTilt } from "@/primitives/hoverTilt";
import { Icon } from "@/primitives/icons";
import { groupStats } from "@/app/featureQuery";
import type { FeatureEntry, FeatureGroup } from "@/app/features";
import { FUNKTIONEN } from "./strings";

export interface GroupTileProps {
  group: FeatureGroup;
  items: readonly FeatureEntry[];
  onOpen: (id: FeatureGroup["id"]) => void;
  /** hover / focus of the tile – warms the pages of its functions */
  onIntent?: (id: FeatureGroup["id"]) => void;
  className?: string;
}

export function GroupTile({ group, items, onOpen, onIntent, className }: GroupTileProps) {
  const { total, partial } = groupStats(items);
  // rich page + mouse: a very light tilt toward the pointer (transform only while it is on the tile)
  const rich = useRichFx();
  const mouse = useMediaQuery("(hover: hover) and (pointer: fine)", false);
  const tilt = useHoverTilt(2.5, rich && mouse);
  // a tap answers: the tile gives a little under the finger (before, only the hover colours changed – nothing on a phone)
  const press = usePressable({ scale: pressScale.surface });
  const tile = (
    <motion.button
      {...press}
      type="button"
      onClick={() => onOpen(group.id)}
      onPointerEnter={() => onIntent?.(group.id)}
      onFocus={() => onIntent?.(group.id)}
      aria-label={FUNKTIONEN.tiles.open(group.name)}
      data-testid="funktionen-tile"
      data-group={group.id}
      data-n={total}
      data-partial={partial}
      className={cn(
        "group/tile grid h-full min-h-[104px] w-full content-between gap-4 rounded-2xl border border-line bg-ink-850 p-4 text-left outline-none transition-colors duration-200 hover:border-line-2 hover:bg-ink-800/40 focus-visible:outline-2 sm:p-5",
        className,
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-line-2 text-mute transition-[color,translate,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/tile:text-fg [[data-rich]_&]:group-hover/tile:-translate-y-[3px] [[data-rich]_&]:group-hover/tile:scale-[1.06] [&>svg]:size-5"
        >
          <Icon name={group.icon} />
        </span>
        <span className="flex items-center gap-2 pt-1 font-mono text-[11.5px] text-mute">
          <span aria-hidden="true" className={cn("size-2 rounded-full", partial ? "bg-warn" : "bg-win")} />
          <span>
            {FUNKTIONEN.tiles.count(total)}
            <span className="text-mute"> · {partial ? FUNKTIONEN.tiles.partial(partial) : FUNKTIONEN.tiles.allDone}</span>
          </span>
        </span>
      </span>
      <span className="grid gap-1">
        <span className="flex items-center justify-between gap-3">
          <span className="text-[17px] font-semibold leading-snug tracking-tight text-fg [text-wrap:balance]">{group.name}</span>
          <span aria-hidden="true" className="shrink-0 text-mute transition-transform duration-200 group-hover/tile:translate-x-0.5">
            →
          </span>
        </span>
        <span className="text-[13px] leading-snug text-mute">{group.lead}</span>
      </span>
    </motion.button>
  );
  if (!rich || !mouse) return tile;
  return (
    <motion.div className="h-full" style={tilt.style} onPointerEnter={tilt.onPointerEnter} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
      {tile}
    </motion.div>
  );
}
