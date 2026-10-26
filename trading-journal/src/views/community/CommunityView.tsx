import { FeatureLinks } from "@/app/FeatureLinks";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { Reveal } from "@/motion/Reveal";
import { Button } from "@/primitives/Button";
import { SectionNav, type SectionNavItem } from "@/primitives/SectionNav";
import { useCommunityBoot } from "@/social/hooks";
import { communityEnabled, loadCommunity, useSocial } from "@/social/store";
import { COMMUNITY } from "@/social/strings";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";
import { CommunityMarquee } from "./CommunityMarquee";
import { CommunitySheets } from "./CommunitySheets";
import { FeedbackCard } from "./FeedbackCard";
import { GroupsSection } from "./GroupsSection";
import { LeaderboardCard } from "./LeaderboardCard";
import { NoCloudState } from "./NoCloudState";
import { SharesCard } from "./SharesCard";
import { SignedOutState } from "./SignedOutState";
import { YouCard } from "./YouCard";

/** The cards of the signed-in page, for its "Inhalt" strip (found by their test ids). */
const NAV: readonly SectionNavItem[] = [
  { id: "you-card", label: "Du" },
  { id: "leaderboard-card", label: "Rangliste" },
  { id: "groups-card", label: "Gruppen" },
  { id: "shares-card", label: "Links und Belege" },
  { id: "feedback-card", label: "Feedback" },
];

export const COMMUNITY_LEAD_FILL = { storageKey: storageKey("fill-community"), highlight: COMMUNITY.leadHighlight } as const;

export interface CommunityViewProps {
  className?: string;
}

/**
 * Community page (P12, `h1 Community`):
 * - no cloud (file build, claude.ai, missing env) → the honest, still animated "Community braucht die Cloud";
 * - signed out / 2FA pending → the pitch + the way in;
 * - signed in → Du (pseudonym, opt-in, figures, percentile) · Rangliste, Gruppen (switcher, mentor desk, reviews,
 *   members, invites, team seats), Deine Links · Feedback, the community band.
 * Cells reveal one after another (`Reveal`) and end at `transform: none`. The share sheet itself is mounted by
 * `SocialHost` (app level).
 */
export function CommunityView({ className }: CommunityViewProps) {
  useCommunityBoot();
  const enabled = communityEnabled();
  const phase = useCloudSession((s) => s.phase);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const load = useSocial((s) => s.load);
  const error = useSocial((s) => s.error);
  const me = useSocial((s) => s.me);
  const signedIn = phase === "signedIn" && !needsMfa;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="community-view" data-state={!enabled ? "off" : signedIn ? "in" : "out"}>
      <PageHeader className="lg:col-span-12" title={COMMUNITY.title} lead={COMMUNITY.lead} leadFill={COMMUNITY_LEAD_FILL} />
      {!enabled ? (
        <NoCloudState />
      ) : !signedIn ? (
        phase === "loading" || phase === "idle" ? (
          <Reveal index={0} className="min-w-0 lg:col-span-12">
            <div className="h-48 rounded-2xl border border-line bg-ink-900/60" aria-hidden="true" />
          </Reveal>
        ) : (
          <SignedOutState mfa={phase === "signedIn" && needsMfa} />
        )
      ) : load === "error" && !me ? (
        <Reveal index={0} className="min-w-0 lg:col-span-12">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-loss/30 bg-loss/[0.05] px-5 py-4" role="alert">
            <span className="grid gap-0.5">
              <span className="text-[14px] font-medium">{COMMUNITY.loadFailed}</span>
              <span className="text-[12.5px] text-mute">{error?.message}</span>
            </span>
            <Button onClick={() => void loadCommunity()}>{COMMUNITY.retry}</Button>
          </div>
        </Reveal>
      ) : (
        <>
          <SectionNav items={NAV} className="lg:col-span-12" />
          {/* the proof and the chart cases are found by chance otherwise: the first sits in „Meine Links“, the second in a group */}
          <FeatureLinks
            className="lg:col-span-12"
            items={[
              { id: "ergebnisbeleg", label: "Ergebnisbeleg" },
              { id: "chartfaelle", label: "Chartfälle" },
              { id: "reviews", label: "Reviews" },
            ]}
          />
          <Reveal index={0} className="min-w-0 lg:col-span-5">
            <YouCard />
          </Reveal>
          <Reveal index={1} className="min-w-0 lg:col-span-7">
            <LeaderboardCard />
          </Reveal>
          <Reveal index={2} className="min-w-0 lg:col-span-12">
            <GroupsSection />
          </Reveal>
          <Reveal index={3} className="min-w-0 lg:col-span-7">
            <SharesCard />
          </Reveal>
          <Reveal index={4} className="min-w-0 lg:col-span-5">
            <FeedbackCard />
          </Reveal>
          <Reveal index={5} className="min-w-0 lg:col-span-12">
            <CommunityMarquee />
          </Reveal>
          <CommunitySheets />
        </>
      )}
    </div>
  );
}
