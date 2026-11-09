import { Fragment, useMemo } from "react";
import { cn } from "@/lib/cn";
import { Marquee } from "@/motion/pulse/Marquee";
import { fmtR } from "@/social/format";
import { MARQUEE } from "@/social/strings";
import { useSocial } from "@/social/store";

/**
 * Community band (P12): promises that are true by construction plus REAL numbers only – the k-anonymous community
 * distribution (from 10 traders on) and the user's own group count. Never invented member counts. Marquee drift (pauses
 * off screen and on hover; static under reduced motion), mono caps like the footer band.
 */
export function CommunityMarquee({ className }: { className?: string }) {
  const groups = useSocial((s) => s.groups.length);
  const boards = useSocial((s) => s.boards);
  const dist = useMemo(() => Object.values(boards).find((b) => b.data?.community.length)?.data?.community.find((d) => d.metric === "expectancy") ?? null, [boards]);
  const items = useMemo(() => {
    const live: string[] = [];
    if (dist) live.push(MARQUEE.traders(dist.n), MARQUEE.median(fmtR(dist.p50)));
    if (groups > 0) live.push(MARQUEE.groups(groups));
    return { live, all: [...live, ...MARQUEE.facts] };
  }, [dist, groups]);
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-ink-950/60 py-3", className)} data-testid="community-marquee">
      <Marquee aria-label={MARQUEE.label} gap={0} fade={56} className="font-mono text-[11.5px] font-medium uppercase tracking-[0.2em]">
        {items.all.map((t, i) => (
          <Fragment key={t}>
            <span className={cn("whitespace-nowrap px-6", i < items.live.length ? "text-fg" : "text-mute")}>{t}</span>
            <span aria-hidden="true" className="text-signal/70">
              ✦
            </span>
          </Fragment>
        ))}
      </Marquee>
    </div>
  );
}
