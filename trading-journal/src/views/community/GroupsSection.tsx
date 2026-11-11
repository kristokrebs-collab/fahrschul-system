import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Skeleton } from "@/primitives/Skeleton";
import { openSheet, useActiveFeed, useSocial } from "@/social/store";
import { GROUP_KIND_LABEL, GROUPS, ROLE_LABEL } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { GroupPanel } from "./GroupPanel";
import { GroupSwitcher } from "./GroupSwitcher";
import { GoalList, MentorDesk } from "./MentorDesk";
import { CaseFeed } from "./cases/CaseFeed";
import { ReviewFeed } from "./ReviewFeed";

/**
 * Gruppen (P12): switcher (magnifying dot-matrix monograms), then the active group – header, mentor desk (for mentors),
 * the review feed and the side panel (share switch, members, invites, team seats, leave / delete). Switching groups
 * cross-fades the panel; nothing is shown that the server did not send.
 */
export function GroupsSection({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const groups = useSocial((s) => s.groups);
  const goals = useSocial((s) => s.goals);
  const active = useSocial((s) => s.activeGroup);
  const load = useSocial((s) => s.load);
  const feed = useActiveFeed();
  const [focus, setFocus] = useState<string | null>(null);
  const onCreate = useCallback(() => openSheet({ kind: "create" }), []);
  const onJoin = useCallback(() => openSheet({ kind: "join" }), []);
  const detail = feed.data?.group.id === active ? feed.data : null;
  const group = detail?.group ?? null;
  const reviews = detail?.reviews ?? [];
  const cases = detail?.cases ?? [];
  const manager = group && (group.role === "owner" || group.role === "mentor");
  const answer = (id: string) => {
    setFocus(id);
    document.getElementById(`review-${id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };
  const goalsHere = group ? goals.filter((g) => g.groupId === group.id) : [];
  return (
    <Card title={GROUPS.title} className={cn("h-full", className)} data-testid="groups-card">
      <div className="grid gap-4">
        <GroupSwitcher groups={groups} active={active} onCreate={onCreate} onJoin={onJoin} />
        {load === "loading" && !groups.length ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : !groups.length ? (
          <div className="grid justify-items-start gap-3 rounded-2xl border border-dashed border-line-2 px-4 py-6" data-testid="groups-empty">
            <p className="max-w-[52ch] text-[13.5px] leading-relaxed text-mute">{GROUPS.none}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onCreate} data-testid="group-create">
                <Glyph name="plus" className="size-4" />
                {GROUPS.create}
              </Button>
              <Button onClick={onJoin} data-testid="group-join">
                <Glyph name="users" className="size-4" />
                {GROUPS.join}
              </Button>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active ?? "none"}
              className="grid gap-4"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={{ y: spring.enter, opacity: tween.fade }}
            >
              {!group ? (
                feed.error ? (
                  <p className="text-[13px] text-loss">{feed.error.message}</p>
                ) : (
                  <div className="grid gap-3">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-64 rounded-2xl" />
                  </div>
                )
              ) : (
                <>
                  <header className="flex flex-wrap items-end justify-between gap-3" data-testid="group-header">
                    <div className="grid min-w-0 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[18px] font-semibold tracking-tight">{group.name}</h3>
                        <Badge tone="steel">{GROUP_KIND_LABEL[group.kind]}</Badge>
                        <Badge tone="mute">{ROLE_LABEL[group.role]}</Badge>
                      </span>
                      {group.description && <p className="max-w-[60ch] text-[13px] text-mute">{group.description}</p>}
                    </div>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                      {group.members} {group.members === 1 ? "Mitglied" : "Mitglieder"} · {group.openReviews} offen
                    </span>
                  </header>
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="grid min-w-0 content-start gap-4">
                      {manager && group.kind === "mentor" && <MentorDesk group={group} reviews={reviews} onAnswer={answer} />}
                      <GoalList goals={goalsHere} />
                      <CaseFeed group={group} cases={cases} />
                      <ReviewFeed group={group} reviews={reviews} focusId={focus} />
                    </div>
                    <GroupPanel group={group} />
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Card>
  );
}
