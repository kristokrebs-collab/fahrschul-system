import { motion } from "motion/react";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { Reveal } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { hasClaudeRuntime } from "@/store/capability";
import { COMMUNITY } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { CommunityMarquee } from "./CommunityMarquee";
import { Constellation, FeatureTiles, Principles } from "./parts";

/**
 * Honest state without a cloud (file build, claude.ai, missing Supabase env): no fake leaderboard, no invented members.
 * The community glyph builds up once, the promises rise in, one red sweep crosses the card; below what the community
 * WOULD offer (tiles without numbers) and what works anyway (the trade picture). The operator hint names the variables.
 */
export function NoCloudState() {
  const reduced = useReducedFx();
  const file = IS_FILE_BUILD || isFileProtocol();
  const claude = hasClaudeRuntime();
  return (
    <>
      <Reveal index={0} className="min-w-0 lg:col-span-12">
        <Card bare className="relative overflow-hidden" data-testid="community-no-cloud">
          <SpotlightSweep tone="signal" />
          <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
            <motion.div
              className="relative grid place-items-center justify-self-start rounded-2xl border border-line-2 bg-[radial-gradient(100%_100%_at_50%_0%,var(--color-ink-750)_0%,var(--color-ink-900)_70%)] px-5 py-6 md:justify-self-auto"
              initial={reduced ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }}
              transition={{ default: spring.enter, opacity: tween.fade }}
            >
              <Constellation size={5} gap={2} className="max-[380px]:scale-90" />
              <span className="mt-4 flex items-center gap-2">
                <DotMatrixText text="CLOUD AUS" tone="mute" size={2} gap={1} glow={false} decorative />
              </span>
            </motion.div>
            <div className="grid gap-3">
              <h2 className="text-[clamp(20px,5.6vw,26px)] font-semibold tracking-tight [text-wrap:balance]">{COMMUNITY.noCloudTitle}</h2>
              <p className="max-w-[60ch] text-[14px] leading-relaxed text-mute">{file ? COMMUNITY.noCloudFile : claude ? COMMUNITY.noCloudClaude : COMMUNITY.noCloudText}</p>
              <Principles className="mt-1" />
              {!file && !claude && <p className="mt-1 font-mono text-[11px] leading-relaxed text-faint">{COMMUNITY.noCloudOwner}</p>}
            </div>
          </div>
        </Card>
      </Reveal>
      <Reveal index={1} className="min-w-0 lg:col-span-12">
        <FeatureTiles />
      </Reveal>
      <Reveal index={2} className="min-w-0 lg:col-span-12">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line-2 bg-ink-900/40 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-950 text-fg">
            <Glyph name="image" className="size-5" />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="label">{COMMUNITY.noCloudStill}</span>
            <span className="text-[13.5px] text-fg">{COMMUNITY.noCloudStillText}</span>
          </span>
        </div>
      </Reveal>
      <Reveal index={3} className="min-w-0 lg:col-span-12">
        <CommunityMarquee />
      </Reveal>
    </>
  );
}
