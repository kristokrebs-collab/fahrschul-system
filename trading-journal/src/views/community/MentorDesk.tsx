import { motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import type { GoalInfo, GroupDetail, MemberInfo, MentorGoalDraft, ReviewInfo } from "@/social/contract";
import { fmtR } from "@/social/format";
import { adoptGoal, closeSheet, declineGoal, openSheet, proposeGoal, setReviewStatus, useSocial } from "@/social/store";
import { MENTOR } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { Monogram } from "@/social/ui/Monogram";

/** The goal presets a mentor picks from (process first – the journal never makes a trade count a target). */
const PRESETS: { id: string; label: string; draft: Omit<MentorGoalDraft, "title" | "target"> & { target: number; unit: string } }[] = [
  { id: "plan", label: "Nach Plan traden", draft: { kind: "process", metric: "planAdherence", comparator: "atLeast", period: "week", target: 90, unit: "%" } },
  { id: "journal", label: "Jeden Trade reviewen", draft: { kind: "process", metric: "journalRate", comparator: "atLeast", period: "week", target: 100, unit: "%" } },
  { id: "checklist", label: "Checkliste vollständig", draft: { kind: "process", metric: "checklistRate", comparator: "atLeast", period: "week", target: 80, unit: "%" } },
  { id: "rules", label: "Keine Regelbrüche", draft: { kind: "limit", metric: "ruleBreaks", comparator: "atMost", period: "week", target: 0, unit: "×" } },
  { id: "perday", label: "Max. Trades pro Tag", draft: { kind: "limit", metric: "tradesPerDay", comparator: "atMost", period: "day", target: 3, unit: "Trades" } },
  { id: "exp", label: "Erwartung in R", draft: { kind: "outcome", metric: "expectancyR", comparator: "atLeast", period: "month", target: 0.3, unit: "R" } },
];
const PERIODS = [
  { v: "day", label: "Tag" },
  { v: "week", label: "Woche" },
  { v: "month", label: "Monat" },
] as const;

/** Share metrics (0–1 in P08's goals) are entered in % here. */
const isShare = (m: MentorGoalDraft["metric"]) => m === "planAdherence" || m === "journalRate" || m === "checklistRate";

export function GoalSheet() {
  const ask = useSocial((s) => (s.sheet?.kind === "goal" ? s.sheet : null));
  const group = useSocial((s) => (ask ? (s.feeds[ask.groupId]?.data?.group ?? null) : null));
  const student: MemberInfo | null = (ask && group?.memberList.find((m) => m.id === ask.studentId)) || null;
  const onClose = closeSheet;
  const [preset, setPreset] = useState(PRESETS[0]!.id);
  const p = PRESETS.find((x) => x.id === preset)!;
  const [title, setTitle] = useState(p.label);
  const [target, setTarget] = useState(String(p.draft.target));
  const [period, setPeriod] = useState<MentorGoalDraft["period"]>(p.draft.period);
  const [why, setWhy] = useState("");
  const busy = useSocial((s) => s.busy);
  const tid = useId();
  const wid = useId();
  const nid = useId();
  const choose = (id: string) => {
    const n = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setTitle(n.label);
    setTarget(String(n.draft.target));
    setPeriod(n.draft.period);
  };
  const value = Number(target.replace(",", "."));
  const valid = Number.isFinite(value) && title.trim().length >= 3;
  const send = async () => {
    if (!student || !group || !valid) return;
    const draft: MentorGoalDraft = {
      title: title.trim(),
      kind: p.draft.kind,
      metric: p.draft.metric,
      comparator: p.draft.comparator,
      period,
      target: isShare(p.draft.metric) ? value / 100 : value,
      ...(why.trim() ? { why: why.trim() } : {}),
    };
    if (await proposeGoal(group.id, student.id, draft)) onClose();
  };
  return (
    <Sheet
      open={!!student}
      onClose={onClose}
      title={student ? `${MENTOR.goalTitle} ${student.pseudonym}` : MENTOR.goal}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={send} disabled={!valid || busy === "goal"} data-testid="goal-send">
            {MENTOR.goalSend}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <StaggerItem className="grid gap-2">
          <span className="label">{MENTOR.goalMetric}</span>
          <MorphSelect<string> aria-label={MENTOR.goalMetric} value={preset} onChange={choose} options={PRESETS.map((x) => ({ value: x.id, label: x.label }))} className="w-full" />
        </StaggerItem>
        <StaggerItem>
          <Field label={MENTOR.goalName} htmlFor={nid}>
            <Input id={nid} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={MENTOR.goalNamePlaceholder} />
          </Field>
        </StaggerItem>
        <StaggerItem className="grid grid-cols-2 gap-3">
          <Field label={`${MENTOR.goalTarget} (${p.draft.comparator === "atLeast" ? "mind." : "max."})`} htmlFor={tid} suffix={p.draft.unit}>
            <Input id={tid} numeric value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <div className="grid content-start gap-1.5">
            <span className="text-[12px] text-mute">{MENTOR.goalPeriod}</span>
            <Segmented<string> size="sm" aria-label={MENTOR.goalPeriod} options={PERIODS.map((x) => ({ v: x.v, label: x.label }))} value={period} onChange={(v) => setPeriod(v as MentorGoalDraft["period"])} />
          </div>
        </StaggerItem>
        <StaggerItem>
          <Field label={MENTOR.goalWhy} htmlFor={wid}>
            <Input id={wid} value={why} maxLength={240} onChange={(e) => setWhy(e.target.value)} />
          </Field>
        </StaggerItem>
      </div>
    </Sheet>
  );
}

/** One open review in the mentor's queue (dealt in by CardSpread). */
function QueueCard({ r, group, onAnswer }: { r: ReviewInfo; group: GroupDetail; onAnswer: (id: string) => void }) {
  const p = r.payload;
  return (
    <div className="grid h-full content-between gap-3 rounded-2xl border border-line-2 bg-[linear-gradient(160deg,var(--color-ink-750)_0%,var(--color-ink-850)_60%)] p-4" data-testid="queue-card">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Monogram pseudonym={r.author} size="xs" />
          <span className="min-w-0 truncate text-[12.5px] font-medium">{r.author}</span>
          <span className="flex-1" />
          <span className={cn("num font-mono text-[13px]", (p.r ?? 0) > 0 ? "text-win" : (p.r ?? 0) < 0 ? "text-loss" : "text-fg")}>{fmtR(p.r)}</span>
        </div>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
          {p.pair} · {p.side === "short" ? "Short" : "Long"}
          {p.timeframe ? ` · ${p.timeframe}` : ""}
        </span>
        {r.question ? <p className="line-clamp-3 text-[13px] leading-snug text-fg">„{r.question}“</p> : <p className="text-[12.5px] text-faint">Ohne Frage</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => onAnswer(r.id)}>
          <Glyph name="chat" className="size-3.5" />
          {MENTOR.answer}
        </Button>
        <Button size="sm" onClick={() => void setReviewStatus(group.id, r.id, "done")}>
          <Glyph name="check" className="size-3.5" />
          Erledigt
        </Button>
      </div>
    </div>
  );
}

/**
 * Mentor dashboard (P12, owners / mentors of a mentor group): the review queue – open student trades dealt onto the
 * table (`CardSpread`, the strongest signal first: oldest open question on top) – and the students with "Ziel
 * vorschlagen".
 */
export function MentorDesk({ group, reviews, onAnswer }: { group: GroupDetail; reviews: readonly ReviewInfo[]; onAnswer: (id: string) => void }) {
  const open = reviews.filter((r) => r.status === "open" && !r.me).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const students = group.memberList.filter((m) => m.role === "student");
  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-ink-950/40 p-4" data-testid="mentor-desk">
      <div className="flex items-center justify-between gap-2">
        <h3 className="label">{MENTOR.queue}</h3>
        <Badge tone={open.length ? "warn" : "win"} dot>
          {open.length} offen
        </Badge>
      </div>
      {open.length === 0 ? (
        <p className="text-[13px] text-mute">{MENTOR.queueEmpty}</p>
      ) : (
        <CardSpread key={open.map((r) => r.id).join()} className="grid gap-3 sm:grid-cols-2" label={MENTOR.queue}>
          {open.slice(0, 6).map((r) => (
            <QueueCard key={r.id} r={r} group={group} onAnswer={onAnswer} />
          ))}
        </CardSpread>
      )}
      {students.length > 0 && (
        <div className="grid gap-2 border-t border-line pt-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{MENTOR.students}</span>
          <ul className="flex flex-wrap gap-2">
            {students.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-full border border-line-2 bg-ink-900 py-1 pl-1 pr-1.5">
                <Monogram pseudonym={s.pseudonym} size="xs" />
                <span className="text-[12.5px]">{s.pseudonym}</span>
                <Button size="sm" className="h-7 px-2.5 text-[11.5px]" onClick={() => openSheet({ kind: "goal", groupId: group.id, studentId: s.id })} data-testid="goal-open">
                  {MENTOR.goal}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const STATUS_TONE = { open: "warn", accepted: "win", declined: "mute" } as const;
const STATUS_LABEL = { open: MENTOR.proposed, accepted: MENTOR.accepted, declined: MENTOR.declined } as const;

/** Goals between mentors and students: the student adopts (→ P08 goals) or declines; the mentor sees the answer. */
export function GoalList({ goals }: { goals: readonly GoalInfo[] }) {
  const reduced = useReducedFx();
  const busy = useSocial((s) => s.busy);
  if (!goals.length) return null;
  return (
    <section className="grid gap-2" data-testid="goal-list">
      <h3 className="label">{MENTOR.myGoals}</h3>
      <ul className="grid gap-2">
        {goals.map((g, i) => (
          <motion.li
            key={g.id}
            className="grid gap-2 rounded-xl border border-line bg-ink-900 px-3.5 py-3"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
            transition={{ y: { ...spring.enter, delay: i * 0.04 }, opacity: { ...tween.fade, delay: i * 0.04 } }}
            data-testid="goal-item"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium">{g.draft.title}</span>
              <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge>
              <span className="flex-1" />
              <span className="font-mono text-[10.5px] text-faint">{g.mine ? MENTOR.from(g.mentor) : MENTOR.forStudent(g.student)}</span>
            </div>
            {g.draft.why && <p className="text-[12.5px] leading-snug text-mute">{g.draft.why}</p>}
            {g.mine && g.status === "open" && (
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void adoptGoal(g)} disabled={busy === "goalAnswer"} data-testid="goal-adopt">
                  {MENTOR.adopt}
                </Button>
                <Button size="sm" onClick={() => void declineGoal(g)} disabled={busy === "goalAnswer"}>
                  {MENTOR.decline}
                </Button>
              </div>
            )}
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
