import { motion } from "motion/react";
import { openAuthSheet } from "@/cloud/session";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { Reveal } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { COMMUNITY } from "@/social/strings";
import { useSocial } from "@/social/store";
import { CommunityMarquee } from "./CommunityMarquee";
import { Constellation, FeatureTiles, Principles } from "./parts";

/** Cloud yes, signed out (or 2FA pending): the pitch, the promises and the way in – nothing that looks like data. */
export function SignedOutState({ mfa = false }: { mfa?: boolean }) {
  const reduced = useReducedFx();
  const invite = useSocial((s) => s.invite);
  return (
    <>
      <Reveal index={0} className="min-w-0 lg:col-span-12">
        <Card bare className="relative overflow-hidden" data-testid="community-signed-out">
          <SpotlightSweep tone="fg" />
          <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-10">
            <div className="grid gap-3">
              <h2 className="text-[clamp(20px,5.6vw,26px)] font-semibold tracking-tight [text-wrap:balance]">{mfa ? COMMUNITY.mfaTitle : COMMUNITY.signedOutTitle}</h2>
              <p className="max-w-[58ch] text-[14px] leading-relaxed text-mute">{mfa ? COMMUNITY.mfaText : COMMUNITY.signedOutText}</p>
              {invite && !mfa && (
                <motion.p
                  className="rounded-xl border border-signal/30 bg-signal/[0.06] px-3 py-2 text-[13px] text-fg"
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                  transition={{ y: spring.enter, opacity: tween.fade }}
                  data-testid="community-invite-waiting"
                >
                  {COMMUNITY.inviteWaiting}
                </motion.p>
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                {mfa ? (
                  <Button variant="primary" onClick={() => openAuthSheet("mfa", "card")}>
                    {COMMUNITY.mfaAction}
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={() => openAuthSheet("signin", "card")} data-testid="community-signin">
                      {COMMUNITY.signIn}
                    </Button>
                    <Button onClick={() => openAuthSheet("signup", "card")}>{COMMUNITY.signUp}</Button>
                  </>
                )}
              </div>
              <Principles className="mt-2" delay={0.3} />
            </div>
            <div className="hidden place-items-center rounded-2xl border border-line-2 bg-[radial-gradient(100%_100%_at_50%_0%,#1c1c1c_0%,#0a0a0a_70%)] px-6 py-7 md:grid">
              <Constellation size={6} gap={2} />
            </div>
          </div>
        </Card>
      </Reveal>
      <Reveal index={1} className="min-w-0 lg:col-span-12">
        <FeatureTiles />
      </Reveal>
      <Reveal index={2} className="min-w-0 lg:col-span-12">
        <CommunityMarquee />
      </Reveal>
    </>
  );
}
