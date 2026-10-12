import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { openPortal } from "@/billing/store";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Switch } from "@/motion/Switch";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import type { GroupDetail, InviteInfo, MemberInfo } from "@/social/contract";
import { fmtPct, fmtR } from "@/social/format";
import { inviteUrl } from "@/social/links";
import { createInvite, deleteGroup, leaveGroup, removeMember, revokeInvite, setRole, setShareLevel, useSocial } from "@/social/store";
import { GROUPS, ROLE_LABEL, S } from "@/social/strings";
import { copyText } from "@/social/ui/copy";
import { Glyph } from "@/social/ui/glyphs";
import { Monogram } from "@/social/ui/Monogram";
import { pushToast } from "@/store/uiStore";
import { ConfirmAction } from "./ConfirmAction";
import { Caption, Progress } from "./parts";

const ROLE_TONE = { owner: "steel", mentor: "teal", member: "mute", student: "mute" } as const;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

function MemberRow({ m, group, index }: { m: MemberInfo; group: GroupDetail; index: number }) {
  const reduced = useReducedFx();
  const owner = group.role === "owner";
  const canRemove = !m.me && m.role !== "owner" && (owner || (group.role === "mentor" && m.role === "student"));
  const f = m.figures;
  return (
    <motion.li
      className="grid gap-2 border-t border-line py-2.5 first:border-t-0"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ ...tween.reveal, delay: Math.min(index, 12) * 0.03 }}
      data-testid="member-row"
    >
      <div className="flex items-center gap-3">
        <Monogram pseudonym={m.pseudonym} tone={m.me ? "signal" : "fg"} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-[13px] font-medium">
            {m.pseudonym}
            {m.me && <span className="text-faint"> · du</span>}
          </span>
          <span className="font-mono text-[10.5px] text-faint">
            {f ? `${fmtR(f.expectancyR)} · ${fmtPct(f.discipline)} Disziplin · ${f.trades} Trades` : GROUPS.noFigures}
          </span>
        </span>
        {m.seat && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mute" title={GROUPS.seat}>
            <Glyph name="seat" className="size-3.5" />
            {GROUPS.seat}
          </span>
        )}
        <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
      </div>
      {(canRemove || (owner && group.kind === "mentor" && !m.me)) && (
        <div className="flex flex-wrap items-center justify-end gap-2 pl-11">
          {owner && group.kind === "mentor" && !m.me && m.role !== "owner" && (
            <Button size="sm" onClick={() => void setRole(group.id, m.id, m.role === "mentor" ? "student" : "mentor")}>
              {m.role === "mentor" ? GROUPS.makeStudent : GROUPS.makeMentor}
            </Button>
          )}
          {canRemove && <ConfirmAction label={GROUPS.remove} question="Entfernen?" onConfirm={() => void removeMember(group.id, m.id)} />}
        </div>
      )}
    </motion.li>
  );
}

function InviteRow({ inv, groupId }: { inv: InviteInfo; groupId: string }) {
  const copy = async () => pushToast((await copyText(inviteUrl(inv.code))) ? { kind: "success", title: S.linkCopied } : { kind: "error", title: S.copyFailed });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-testid="invite-row">
      <span className="grid">
        <span className="font-mono text-[13px] tracking-[0.16em]">{inv.code}</span>
        <span className="font-mono text-[10.5px] text-faint">
          {ROLE_LABEL[inv.role]} · {GROUPS.inviteUses(inv.uses, inv.maxUses)} · {GROUPS.inviteUntil(dateLabel(inv.expiresAt))}
        </span>
      </span>
      <span className="flex gap-1.5">
        <Button size="sm" onClick={copy} aria-label={`${GROUPS.inviteCopy} ${inv.code}`}>
          <Glyph name="copy" className="size-3.5" />
        </Button>
        <Button size="sm" onClick={() => void revokeInvite(groupId, inv.code)}>
          {GROUPS.revoke}
        </Button>
      </span>
    </li>
  );
}

/**
 * The side column of a group (P12): my share switch (opt-in per group), members with roles and – only when shared –
 * their R figures, the group average (k ≥ 10), invitations (owners / mentors), the Team seats (owner of a team) and
 * leave / delete as hold-to-confirm.
 */
export function GroupPanel({ group }: { group: GroupDetail }) {
  const reduced = useReducedFx();
  const busy = useSocial((s) => s.busy);
  const shareId = useId();
  const me = group.memberList.find((m) => m.me);
  const manager = group.role === "owner" || group.role === "mentor";
  const roles: InviteInfo["role"][] = group.kind === "mentor" ? (group.role === "owner" ? ["student", "mentor"] : ["student"]) : ["member"];
  const invite = async (role: InviteInfo["role"]) => {
    const inv = await createInvite(group.id, role);
    if (inv) pushToast((await copyText(inviteUrl(inv.code))) ? { kind: "success", title: S.linkCopied, detail: inv.code } : { kind: "success", title: inv.code, detail: S.copyFailed });
  };
  const sharing = group.memberList.filter((m) => m.figures).length;
  return (
    <div className="grid content-start gap-4" data-testid="group-panel">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3">
        <span className="grid gap-0.5">
          <label htmlFor={shareId} className="text-[13.5px] font-medium">
            {GROUPS.shareStats}
          </label>
          <span className="text-[12px] leading-snug text-mute">{GROUPS.shareStatsHint}</span>
        </span>
        <Switch id={shareId} tone="win" checked={group.shareLevel === "stats"} disabled={!me || busy === "shareLevel"} onCheckedChange={(v) => me && void setShareLevel(group.id, me.id, v ? "stats" : "none")} data-testid="group-share-stats" />
      </div>

      {group.seats && (
        <div className="grid gap-2 rounded-xl border border-line-2 bg-ink-900 px-3.5 py-3" data-testid="team-seats">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[13.5px] font-medium">
              <Glyph name="seat" className="size-4" />
              {GROUPS.seats(group.seats.used, group.seats.seats)}
            </span>
            <Button size="sm" onClick={() => void openPortal("manage")}>
              {GROUPS.seatsManage}
            </Button>
          </div>
          <Progress value={group.seats.seats ? group.seats.used / group.seats.seats : 0} tone={group.seats.used >= group.seats.seats ? "signal" : "win"} />
          <span className="text-[11.5px] text-faint">{GROUPS.seatsHint}</span>
        </div>
      )}

      <section className="grid gap-1">
        <div className="flex items-baseline justify-between">
          <Caption>{GROUPS.members}</Caption>
          <span className="font-mono text-[10.5px] text-faint">{group.members}</span>
        </div>
        <ul>
          {group.memberList.map((m, i) => (
            <MemberRow key={m.id} m={m} group={group} index={i} />
          ))}
        </ul>
        <p className="text-[11.5px] text-faint">
          {group.averages ? `${GROUPS.averages}: ${fmtR(group.averages.expectancyR)} · ${fmtPct(group.averages.discipline)} Disziplin (n = ${group.averages.n})` : GROUPS.averagesNone(sharing)}
        </p>
      </section>

      {manager && (
        <section className="grid gap-2" data-testid="group-invites">
          <Caption>{GROUPS.invites}</Caption>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <Button key={r} size="sm" onClick={() => void invite(r)} disabled={busy === "invite"} data-testid={`invite-${r}`}>
                <Glyph name="link" className="size-3.5" />
                {GROUPS.inviteCreate(ROLE_LABEL[r])}
              </Button>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {group.invites.length > 0 && (
              <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} exit={{ opacity: 0, transition: tween.exit }} transition={{ y: spring.enter, opacity: tween.fade }}>
                <RevealGroup as="ul" className="grid gap-1.5">
                  {group.invites.map((inv) => (
                    <RevealItem key={inv.code} as="li" className="list-none">
                      <InviteRow inv={inv} groupId={group.id} />
                    </RevealItem>
                  ))}
                </RevealGroup>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3")}>
        <span className="max-w-[30ch] text-[11.5px] leading-snug text-faint">{group.role === "owner" ? GROUPS.deleteHint : GROUPS.leaveHint}</span>
        {group.role === "owner" ? (
          <ConfirmAction label={GROUPS.delete} question="Für alle löschen?" onConfirm={() => void deleteGroup(group.id)} disabled={busy === "deleteGroup"} testId="group-delete" />
        ) : (
          <ConfirmAction label={GROUPS.leave} question="Wirklich austreten?" onConfirm={() => me && void leaveGroup(group.id, me.id)} disabled={busy === "leave"} testId="group-leave" />
        )}
      </div>
    </div>
  );
}
