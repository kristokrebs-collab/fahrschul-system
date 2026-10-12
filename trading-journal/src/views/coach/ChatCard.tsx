/**
 * "Frag deinen Coach" (P04): German questions about the own journal, answered on the device by the intent parser and
 * the answer engine (`@/domain/coach/nlq`) – numbers, evidence trades, a chart and an honest confidence. The newest
 * answer sits right under the input: "Coach denkt …" shimmers for a beat, then the answer types itself out
 * (`CoachStream`, 65 ms / character, capped), the facts land with a `ValueFlash`, the chart grows and the evidence
 * trades cascade in (`StaggerItem`). Optional: "Mit KI formulieren" (only when the server has a key and the user is
 * signed in with the plan – see `ask.ts`); the computed answer always stays visible.
 */
import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { withAiNotes } from "@/domain/coach";
import { askJournal, suggestQuestions, type Answer, type AnswerData } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { CoachStream } from "@/motion/fx/CoachStream";
import { spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Switch } from "@/motion/Switch";
import { useJournal } from "@/store/journalStore";
import { useAiAvailable, errorText, keptReason, rephraseAnswer } from "./ask";
import { useCoachUi, type ChatEntry } from "./coachStore";
import { AnswerChart, EvidenceTrades, LandingValue, TONE_TEXT } from "./ui";

export const CHAT_PLACEHOLDER = "z. B. Was ist mein bestes Setup?";
/** Beat of "Coach denkt …" before a (computed) answer starts typing – one reveal. */
const THINK_MS = tween.reveal.duration * 1000;

function Chip({ children, onClick, testId }: { children: string; onClick: () => void; testId?: string }) {
  const press = usePressable({ scale: 0.96 });
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={press.whileTap}
      transition={press.transition}
      data-testid={testId}
      className="touch-hit min-h-8 rounded-full border border-line-2 bg-white/[0.03] px-3 py-1 text-left text-[12px] text-mute transition-colors hover:border-steel/40 hover:text-fg"
    >
      {children}
    </motion.button>
  );
}

/** Note excerpts of the evidence trades (only with the opt-in): ≤ 3, newest first, ≤ 280 characters each. */
function noteExcerpts(evidence: readonly EnrichedTrade[]): string[] {
  return evidence
    .map((t) => (t.notes || t.psych?.postNote || "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((n) => n.slice(0, 280));
}

function AiBlock({ entry, evidence, aiNotes }: { entry: ChatEntry; evidence: readonly EnrichedTrade[]; aiNotes: boolean }) {
  const available = useAiAvailable();
  const setAi = useCoachUi((s) => s.setAi);
  if (!available || entry.answer.kind === "unknown" || entry.answer.kind === "empty") return null;
  const notes = aiNotes ? noteExcerpts(evidence) : undefined;
  const run = async () => {
    setAi(entry.id, { status: "loading" });
    try {
      const r = await rephraseAnswer(entry.question, entry.answer, notes);
      setAi(entry.id, r.text ? { status: "done", text: r.text, model: r.model } : { status: "kept", reason: keptReason(r.reason) });
    } catch (e) {
      setAi(entry.id, { status: "error", message: errorText(e) });
    }
  };
  const ai = entry.ai;
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5" data-testid="coach-ai">
      {ai.status === "idle" && (
        <Button size="sm" onClick={() => void run()} className="justify-self-start">
          Mit KI formulieren
        </Button>
      )}
      {ai.status === "loading" && <CoachStream text="" thinking thinkingLabel="KI formuliert …" />}
      {ai.status === "done" && (
        <>
          <span className="label">KI-Fassung · nur deine Zahlen</span>
          <CoachStream text={ai.text} className="text-[13.5px] leading-relaxed text-fg" />
        </>
      )}
      {(ai.status === "kept" || ai.status === "error") && <p className="text-[12px] text-mute">{ai.status === "kept" ? ai.reason : ai.message}</p>}
    </div>
  );
}

function AnswerView({ entry, trades, cur, aiNotes }: { entry: ChatEntry; trades: ReadonlyMap<string, EnrichedTrade>; cur: string; aiNotes: boolean }) {
  const reduced = useReducedFx();
  const settle = useCoachUi((s) => s.settle);
  const a: Answer = entry.answer;
  const live = entry.fresh && !reduced;
  const [thinking, setThinking] = useState(live);
  const [landed, setLanded] = useState(!live);
  const articleRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  // a new answer comes into view (it types only while visible)
  useEffect(() => {
    if (scrolled.current || !entry.fresh) return;
    scrolled.current = true;
    articleRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [entry.fresh, reduced]);
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => setThinking(false), THINK_MS);
    return () => clearTimeout(t);
  }, [thinking]);
  const evidence = a.trades.map((id) => trades.get(id)).filter((t): t is EnrichedTrade => !!t);
  const verdictTone = a.confidence.label === "klar" ? "win" : a.confidence.label === "Tendenz" ? "fg" : "mute";
  return (
    <article ref={articleRef} className="grid scroll-mt-24 gap-3" aria-label={`Antwort auf: ${entry.question}`} data-testid="coach-answer" data-kind={a.kind}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md border border-line-2 bg-white/[0.06] px-3.5 py-2 text-[13px] text-fg">{entry.question}</p>
      </div>
      <div className="grid gap-3 rounded-2xl rounded-tl-md border border-line bg-ink-950/50 p-3.5 sm:p-4">
        {a.intent.understood.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="So habe ich die Frage verstanden">
            {a.intent.understood.map((u) => (
              <li key={u} className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-mute">
                {u}
              </li>
            ))}
          </ul>
        )}
        <CoachStream
          text={thinking ? "" : a.text}
          thinking={thinking}
          instant={!live}
          onCaughtUp={() => {
            setLanded(true);
            settle(entry.id);
          }}
          className="text-[14px] leading-relaxed text-fg"
        />
        {a.facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {a.facts.slice(0, 4).map((f) => (
              <motion.div
                key={f.label}
                className="grid min-w-0 gap-0.5 rounded-xl border border-line bg-ink-900/60 px-2.5 py-2"
                initial={live ? { opacity: 0, y: 6 } : false}
                animate={landed ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                transition={{ default: tween.reveal, y: spring.enter }}
              >
                <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{f.label}</dt>
                <dd className={cn("num truncate font-mono text-[14px]", TONE_TEXT[f.tone])}>
                  <LandingValue raw={f.raw} landed={landed}>
                    {f.value}
                  </LandingValue>
                </dd>
              </motion.div>
            ))}
          </dl>
        )}
        {landed && a.chart && <AnswerChart spec={a.chart} cur={cur} label={a.title} />}
        {landed && a.kind !== "unknown" && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ConfidenceMeter value={a.confidence.score} label="Konfidenz" cols={14} size={3} gap={2} tone={verdictTone} />
            <p className="max-w-[46ch] text-[11.5px] leading-snug text-faint">
              <span className="font-semibold text-mute">{a.confidence.label}</span> · {a.confidence.note}
            </p>
          </div>
        )}
        {landed && evidence.length > 0 && (
          <div className="grid gap-1">
            <span className="label">Belege</span>
            <EvidenceTrades trades={evidence} group={`coach-ev-${entry.id}`} play={landed} />
          </div>
        )}
        {landed && <AiBlock entry={entry} evidence={evidence} aiNotes={aiNotes} />}
      </div>
    </article>
  );
}

export interface ChatCardProps {
  data: AnswerData;
  /** every enriched trade (evidence lookup) */
  enriched: readonly EnrichedTrade[];
  /** opt-in (`settings.coach.ai.notes`): note excerpts of the evidence trades go to the optional AI wording */
  aiNotes?: boolean;
  className?: string;
}

/** The opt-in for note excerpts – only shown where the AI wording exists. */
function AiNotesSwitch({ on }: { on: boolean }) {
  const available = useAiAvailable();
  const settings = useJournal((s) => s.settings);
  const saveSettings = useJournal((s) => s.saveSettings);
  if (!available) return null;
  return (
    <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-[12px] text-mute">
      <span>Notizen der Beleg-Trades an die KI senden (sonst nur Zahlen)</span>
      <Switch size="sm" checked={on} onCheckedChange={(v) => void saveSettings(withAiNotes(settings, v))} aria-label="Notizen an die KI senden" />
    </label>
  );
}

export function ChatCard({ data, enriched, aiNotes = false, className }: ChatCardProps) {
  const chat = useCoachUi((s) => s.chat);
  const push = useCoachUi((s) => s.ask);
  const clear = useCoachUi((s) => s.clearChat);
  const [q, setQ] = useState("");
  const id = useId();
  const byId = useMemo(() => new Map(enriched.map((t) => [t.id, t])), [enriched]);
  const chips = useMemo(() => suggestQuestions(data), [data]);
  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    push(text, askJournal(text, { ...data, now: Date.now() }));
    setQ("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(q);
  };
  const newest = [...chat].reverse();
  const follow = newest[0]?.answer.followUps ?? [];
  return (
    <Card
      title="Frag deinen Coach"
      note="Rechnet auf deinem Gerät aus deinem Journal – mit Belegen und ehrlicher Konfidenz."
      className={className}
      data-testid="coach-chat"
      action={
        chat.length ? (
          <button type="button" onClick={clear} className="touch-hit text-[11.5px] text-faint hover:text-fg">
            Verlauf leeren
          </button>
        ) : undefined
      }
    >
      <form onSubmit={onSubmit} className="flex min-w-0 gap-2" role="search" aria-label="Frage an den Coach">
        <label htmlFor={id} className="sr-only">
          Deine Frage
        </label>
        <input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={CHAT_PLACEHOLDER}
          autoComplete="off"
          maxLength={300}
          enterKeyHint="send"
          data-testid="coach-input"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-2 bg-ink-950/60 px-3.5 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-steel/50"
        />
        <Button type="submit" variant="primary" disabled={!q.trim()} data-testid="coach-ask">
          Fragen
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Vorschläge">
        {(follow.length ? [...follow, ...chips].filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 6) : chips).map((c) => (
          <Chip key={c} onClick={() => ask(c)} testId="coach-chip">
            {c}
          </Chip>
        ))}
      </div>
      <AiNotesSwitch on={aiNotes} />
      <div className="mt-4 grid gap-6">
        {newest.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-mute">
            {data.closed.length
              ? "Frag in deinen Worten – etwa nach Win-Rate am Montag, deinem besten Setup, letzter Woche oder was dich Revenge-Trades kosten."
              : "Noch keine abgeschlossenen Trades. Sobald du welche einträgst, beantworte ich Fragen dazu – nichts wird geraten."}
          </p>
        ) : (
          newest.map((e) => <AnswerView key={e.id} entry={e} trades={byId} cur={data.currency} aiNotes={aiNotes} />)
        )}
      </div>
    </Card>
  );
}
