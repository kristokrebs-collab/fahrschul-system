import { AnimatePresence } from "motion/react";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import type { CaseInfo, GroupDetail } from "@/social/contract";
import { CASES } from "@/social/caseStrings";
import { openSheet } from "@/social/store";
import { Glyph } from "@/social/ui/glyphs";
import { CaseCard } from "./CaseCard";

/**
 * "Chartfälle" of a group (F47): the same stretch of public candles for everyone, a hypothesis written down first, the
 * future shown after. In mentor groups only owners and mentors pose the cases; students answer them.
 */
export function CaseFeed({ group, cases }: { group: GroupDetail; cases: readonly CaseInfo[] }) {
  const manager = group.role === "owner" || group.role === "mentor";
  const mayPost = group.kind !== "mentor" || manager;
  return (
    <section className="grid content-start gap-3" data-testid="case-feed">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="label">{CASES.title}</h3>
          <p className="max-w-[60ch] text-[12px] leading-snug text-faint">{CASES.lead}</p>
        </div>
        {mayPost ? (
          <Button size="sm" variant="primary" onClick={() => openSheet({ kind: "case", groupId: group.id })} data-testid="case-new">
            <Glyph name="plus" className="size-3.5" />
            {CASES.new}
          </Button>
        ) : (
          <span className="text-[12px] text-faint">{CASES.mentorOnly}</span>
        )}
      </div>
      {cases.length === 0 ? (
        <div data-testid="case-empty">
          <EmptyState title={CASES.emptyTitle} text={CASES.empty} line={false} />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {cases.map((c, i) => (
            <CaseCard key={c.id} c={c} group={group} index={i} />
          ))}
        </AnimatePresence>
      )}
    </section>
  );
}
