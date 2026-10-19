/**
 * Rendering of the assistant's replies (F74): journal answers (numbers, chart, confidence, evidence – trimmed by the
 * user's answer style), tool replies (title, text, facts, actions) and the clarify fallback. The newest reply types
 * itself out (`CoachStream`); older ones render at once.
 */
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { Answer } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { CoachStream } from "@/motion/fx/CoachStream";
import { spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { AnswerChart, EvidenceTrades, LandingValue, TONE_TEXT } from "@/views/coach/ui";
import type { Entry } from "./conversation";
import type { Reply } from "./engine";
import type { AnswerStyle } from "./memory";
import type { ToolReply } from "./tools";

const THINK_MS = tween.reveal.duration * 1000;

export function Chip({ children, onClick, testId }: { children: string; onClick: () => void; testId?: string }) {
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

function Facts({ facts, landed, live, max }: { facts: Answer["facts"]; landed: boolean; live: boolean; max: number }) {
  if (!facts.length || max <= 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {facts.slice(0, max).map((f) => (
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
  );
}

/** Streamed text with the "denkt …" beat for a fresh reply. */
function Said({ text, fresh, onDone }: { text: string; fresh: boolean; onDone: () => void }) {
  const reduced = useReducedFx();
  const live = fresh && !reduced;
  const [thinking, setThinking] = useState(live);
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => setThinking(false), THINK_MS);
    return () => clearTimeout(t);
  }, [thinking]);
  return <CoachStream text={thinking ? "" : text} thinking={thinking} thinkingLabel="Denke nach …" instant={!live} onCaughtUp={onDone} className="text-[14px] leading-relaxed text-fg" />;
}

const BUBBLE = "rounded-2xl rounded-tl-md border border-line bg-ink-950/50 p-3.5";

function JournalView({ answer, fresh, trades, cur, style, id, onTyped, label }: {label?: string;  answer: Answer; fresh: boolean; trades: ReadonlyMap<string, EnrichedTrade>; cur: string; style: AnswerStyle; id: string; onTyped: () => void }) {
  const reduced = useReducedFx();
  const live = fresh && !reduced;
  const [landed, setLanded] = useState(!live);
  const evidence = answer.trades.map((t) => trades.get(t)).filter((t): t is EnrichedTrade => !!t);
  const tone = answer.confidence.label === "klar" ? "win" : answer.confidence.label === "Tendenz" ? "fg" : "mute";
  const factMax = style === "kurz" ? 2 : style === "detail" ? 6 : 3;
  return (
    <article className={cn("grid gap-3", BUBBLE)} data-testid="assistant-answer" data-kind={answer.kind} aria-label={answer.title}>
      {label && <span className="label">{label}</span>}
      <Said
        text={answer.text}
        fresh={fresh}
        onDone={() => {
          setLanded(true);
          onTyped();
        }}
      />
      <Facts facts={answer.facts} landed={landed} live={live} max={factMax} />
      {landed && style !== "kurz" && answer.chart && <AnswerChart spec={answer.chart} cur={cur} label={answer.title} />}
      {landed && answer.kind !== "unknown" && style !== "kurz" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ConfidenceMeter value={answer.confidence.score} label="Konfidenz" cols={12} size={3} gap={2} tone={tone} />
          <p className="max-w-[40ch] text-[11.5px] leading-snug text-faint">
            <span className="font-semibold text-mute">{answer.confidence.label}</span> · {answer.confidence.note}
          </p>
        </div>
      )}
      {landed && style === "detail" && evidence.length > 0 && (
        <div className="grid gap-1">
          <span className="label">Belege</span>
          <EvidenceTrades trades={evidence} group={`assistant-ev-${id}`} play={landed} />
        </div>
      )}
    </article>
  );
}

function ToolView({ reply, fresh, style, onTyped }: { reply: ToolReply; fresh: boolean; style: AnswerStyle; onTyped: () => void }) {
  const reduced = useReducedFx();
  const live = fresh && !reduced;
  const [landed, setLanded] = useState(!live);
  return (
    <article className={cn("grid gap-3", BUBBLE)} data-testid="assistant-answer" data-kind="tool" aria-label={reply.title}>
      <span className={cn("label flex items-center gap-2", reply.tone === "win" ? "!text-win" : reply.tone === "loss" ? "!text-loss" : "")}>
        <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
        {reply.title}
      </span>
      <Said
        text={reply.text}
        fresh={fresh}
        onDone={() => {
          setLanded(true);
          onTyped();
        }}
      />
      <Facts facts={reply.facts} landed={landed} live={live} max={style === "kurz" ? 2 : 4} />
      {landed && reply.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reply.actions.map((a) => (
            <Button key={a.label} size="sm" onClick={a.run}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}

function ClarifyView({ text, suggestions, onPick }: { text: string; suggestions: readonly string[]; onPick: (q: string) => void }) {
  return (
    <article className={cn("grid gap-3", BUBBLE)} data-testid="assistant-answer" data-kind="clarify">
      <p className="text-[14px] leading-relaxed text-fg">{text}</p>
      {suggestions.length > 0 && (
        <div className="grid gap-1.5">
          <span className="label">Meintest du …?</span>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <Chip key={s} onClick={() => onPick(s)} testId="assistant-suggestion">
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export interface EntryViewProps {
  entry: Entry;
  trades: ReadonlyMap<string, EnrichedTrade>;
  cur: string;
  style: AnswerStyle;
  onAsk: (q: string) => void;
  onSettled: (id: number) => void;
}

/** One turn: the question with how it was read, then every reply. */
export function EntryView({ entry, trades, cur, style, onAsk, onSettled }: EntryViewProps) {
  const replies = useMemo(() => entry.replies, [entry.replies]);
  // a chip that only repeats the question tells nothing
  const same = (a: string) => a.toLowerCase().replace(/[^a-zäöüß0-9]+/g, "");
  const via = entry.via.filter((v) => same(v) !== same(entry.question));
  return (
    <section className="grid gap-2.5" aria-label={`Frage: ${entry.question}`} data-testid="assistant-entry">
      <div className="grid justify-items-end gap-1.5">
        <p className="max-w-[88%] rounded-2xl rounded-br-md border border-line-2 bg-white/[0.06] px-3.5 py-2 text-[13px] text-fg">{entry.question}</p>
        {via.length > 0 && (
          <ul className="flex max-w-[88%] flex-wrap justify-end gap-1.5" aria-label="So habe ich dich verstanden">
            {via.map((v) => (
              <li key={v} className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-mute">
                {v}
              </li>
            ))}
          </ul>
        )}
      </div>
      {entry.routing ? (
        <div className={BUBBLE}>
          <CoachStream text="" thinking thinkingLabel="Ich suche die passende Auswertung …" className="text-[13px]" />
        </div>
      ) : (
        replies.map((r: Reply, i) => <ReplyView key={i} reply={r} entry={entry} trades={trades} cur={cur} style={style} index={i} onAsk={onAsk} onSettled={onSettled} />)
      )}
      {!entry.routing && <Follow replies={replies} onAsk={onAsk} />}
    </section>
  );
}

function ReplyView({ reply, entry, trades, cur, style, index, onAsk, onSettled }: EntryViewProps & { reply: Reply; index: number }) {
  const fresh = entry.fresh;
  const last = index === entry.replies.length - 1;
  const onTyped = () => {
    if (last) onSettled(entry.id);
  };
  switch (reply.kind) {
    case "journal":
      return <JournalView answer={reply.answer} fresh={fresh} trades={trades} cur={cur} style={style} id={`${entry.id}-${index}`} onTyped={onTyped} label={entry.replies.length > 1 ? reply.answer.title : undefined} />;
    case "tool":
      return <ToolView reply={reply.reply} fresh={fresh} style={style} onTyped={onTyped} />;
    case "clarify":
      return <ClarifyView text={reply.text} suggestions={reply.suggestions} onPick={onAsk} />;
  }
}

function Follow({ replies, onAsk }: { replies: readonly Reply[]; onAsk: (q: string) => void }) {
  const list = useMemo(() => {
    const out: string[] = [];
    for (const r of replies) {
      if (r.kind === "journal") out.push(...r.answer.followUps);
      else if (r.kind === "tool") out.push(...r.reply.followUps);
    }
    return [...new Set(out)].slice(0, 4);
  }, [replies]);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Weiterfragen">
      {list.map((q) => (
        <Chip key={q} onClick={() => onAsk(q)} testId="assistant-follow">
          {q}
        </Chip>
      ))}
    </div>
  );
}
