/**
 * The assistant (F74): one sheet reachable from every page (header button, shortcut `A`, command navigation,
 * the dashboard card). Text or microphone in, answers out – computed by the app from the user's own data
 * (`engine.ts`), optionally routed by a language model on the server when the local layer cannot place a question
 * (`route.ts`). The conversation and the memory live in `conversation.ts`, so closing the sheet or changing the page
 * loses nothing. Lazy chunk, mounted by `DeferredHosts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { analyse, useCoachBase, useMinuteClock } from "@/views/coach/hooks";
import { accountView } from "@/domain/account";
import type { AnswerData } from "@/domain/coach/nlq";
import { parseContextOf } from "@/domain/coach/nlq";
import { experimentOverview } from "@/domain/reports/experiment";
import { cn } from "@/lib/cn";
import { useSignalCheck } from "@/market/signals";
import { Switch } from "@/motion/Switch";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { openReport } from "@/views/berichte/berichteStore";
import { useDiagnosis } from "@/views/labor/DiagnosisCard";
import { Chip, EntryView } from "./AssistantAnswer";
import { useConversation } from "./conversation";
import { execute, replyText, respond, type EngineEnv, type Reply } from "./engine";
import { summarizeLab } from "./labSummary";
import { GlyphMic, GlyphSpeaker, GlyphStop } from "./icons";
import { forgetAll, learnInterest, setSpeak, type AnswerStyle } from "./memory";
import { closeAssistant, useAssistantOpen } from "./open";
import { routeViaServer, useRouterAvailable } from "./route";
import { speak, speechMessage, speechOutputSupported, stopSpeaking, useSpeechInput } from "./speech";
import { suggestFor, topicLabel } from "./tools";
import { understand } from "./understand";

export const ASSISTANT_STRINGS = {
  title: "Assistent",
  placeholder: "Frag mich etwas – oder tippe aufs Mikrofon",
  listening: "Ich höre zu …",
  micNote: "Die Sprache erkennt der Dienst deines Browsers; nichts wird von der App aufgenommen oder gespeichert.",
  empty: "Ich antworte aus deinen Trades, prüfe den Einstieg, erkläre Laborläufe, öffne Seiten und merke mir, was dir wichtig ist.",
  noTrades: "Noch keine abgeschlossenen Trades – Fragen zu deinen Zahlen beantworte ich, sobald welche da sind. Alles andere geht schon jetzt.",
} as const;

const STYLES: ReadonlyArray<{ v: AnswerStyle; label: string }> = [
  { v: "kurz", label: "Kurz" },
  { v: "normal", label: "Normal" },
  { v: "detail", label: "Ausführlich" },
];

function MicButton({ state, onClick, supported }: { state: ReturnType<typeof useSpeechInput>["state"]; onClick: () => void; supported: boolean }) {
  const on = state === "listening" || state === "starting";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      aria-pressed={on}
      aria-label={on ? "Aufnahme beenden" : "Per Sprache fragen"}
      title={supported ? (on ? "Aufnahme beenden" : "Per Sprache fragen") : "Spracheingabe wird von diesem Browser nicht unterstützt"}
      data-testid="assistant-mic"
      className={cn(
        "touch-hit relative grid size-11 shrink-0 place-items-center rounded-xl border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40",
        on ? "border-signal/60 bg-signal/15 text-fg" : "border-line-2 bg-ink-850 text-mute hover:border-white/40 hover:text-fg",
      )}
    >
      {on && <span aria-hidden="true" className="fx-ping absolute inset-0 rounded-xl border border-signal/50" />}
      {on ? <GlyphStop className="size-[18px]" /> : <GlyphMic className="size-[18px]" />}
    </button>
  );
}

function MemoryPanel() {
  const mem = useConversation((s) => s.mem);
  const setMem = useConversation((s) => s.setMem);
  const [open, setOpen] = useState(false);
  const top = Object.entries(mem.interests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  return (
    <section className="grid gap-2 border-t border-line pt-4" aria-label="Was ich über dich weiß" data-testid="assistant-memory">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="touch-hit flex items-center justify-between text-left text-[12.5px] font-semibold text-mute hover:text-fg">
        <span>Was ich über dich weiß</span>
        <span className="font-mono text-[13px]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="grid gap-3 text-[12.5px] text-mute">
          <p>Ich lerne nur aus dem, was du mir sagst oder mich fragst – nicht aus deinen Trades, und nichts davon verlässt dein Konto.</p>
          {mem.facts.length > 0 ? (
            <ul className="grid gap-1.5">
              {mem.facts.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 rounded-lg border border-line px-2.5 py-1.5">
                  <span className="text-fg">{f.text}</span>
                  <button type="button" onClick={() => setMem((m) => ({ ...m, facts: m.facts.filter((x) => x.id !== f.id) }))} aria-label={`„${f.text}“ vergessen`} className="touch-hit shrink-0 text-faint hover:text-fg">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Keine Notizen. Sag zum Beispiel: „Merk dir: ich handle nur in der London-Session.“</p>
          )}
          {top.length > 0 && (
            <p>
              Du fragst am häufigsten nach: <span className="text-fg">{top.map(([k, n]) => `${topicLabel(k)} (${n}×)`).join(", ")}</span>.
            </p>
          )}
          <div>
            <Button size="sm" variant="danger" onClick={() => setMem(forgetAll)}>
              Alles vergessen
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function AssistantBody() {
  const base = useCoachBase();
  const sig = useSignalCheck();
  const routerOk = useRouterAvailable();
  const page = useUi((s) => s.page);
  const openEditor = useUi((s) => s.openEditor);
  const prefill = useAssistantOpen((s) => s.prefill);
  const wantListen = useAssistantOpen((s) => s.listen);
  const seq = useAssistantOpen((s) => s.seq);
  const entries = useConversation((s) => s.entries);
  const mem = useConversation((s) => s.mem);
  const conv = useConversation;
  const [text, setText] = useState(prefill);
  const bottom = useRef<HTMLDivElement>(null);
  const { settings, view, events, days } = base;
  const clock = useMinuteClock();

  const diagnosis = useDiagnosis();
  const lab = useMemo(() => summarizeLab(diagnosis), [diagnosis]);

  useEffect(() => conv.getState().hydrate(settings), [conv, settings]);

  const data: AnswerData = useMemo(() => ({ closed: view.closed, settings, events, now: clock, currency: settings.currency, start: view.start }), [view, settings, events, clock]);
  const byId = useMemo(() => new Map(view.list.map((t) => [t.id, t])), [view.list]);
  const parseCtx = useMemo(() => parseContextOf(data.closed, data), [data]);

  const env = useCallback(
    (): EngineEnv => {
      const lastJournal = [...conv.getState().entries].reverse().find((e) => e.replies[0]?.kind === "journal");
      const jr = lastJournal?.replies.find((r): r is Extract<Reply, { kind: "journal" }> => r.kind === "journal");
      return {
        data: { ...data, now: Date.now() },
        prev: lastJournal && jr ? { question: lastJournal.question, answer: jr.answer } : null,
        mem: conv.getState().mem,
        signal: sig,
        recs: () => analyse(view, settings, events, days, Date.now()).recs,
        experiment: () => experimentOverview({ settings, events, now: Date.now(), list: view.list, acc: base.acc, recs: () => analyse(view, settings, events, days, Date.now()).recs, listOf: (a) => accountView(base.enriched, settings, a).list }),
        openReport: (key) => void openReport(key),
        lab,
        go: (p) => navigate(p),
        newTrade: () => openEditor(),
        setMem: (fn) => conv.getState().setMem(fn),
        now: Date.now(),
      };
    },
    [conv, data, sig, view, settings, events, days, openEditor, lab, base.acc, base.enriched],
  );

  const ask = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      setText("");
      stopSpeaking();
      const e = env();
      const turn = respond(q, e);
      const st = conv.getState();
      const id = st.push({ question: q, via: turn.via, replies: turn.replies, routing: turn.needsServer && routerOk, topic: turn.topic });
      if (turn.topic) st.setMem((m) => learnInterest(m, turn.topic!));
      else st.setMem((m) => ({ ...m, asked: m.asked + 1 }));
      const first = turn.replies[0];
      if (first?.kind === "tool" && first.reply.close) closeAssistant();
      const aloud = (rs: readonly Reply[]) => {
        if (conv.getState().mem.voice.speak) speak(rs.slice(0, 2).map(replyText).join(" "));
      };
      if (turn.needsServer && routerOk) {
        const history = conv.getState().entries.filter((x) => x.id !== id).slice(-3).map((x) => x.question);
        const uctx = { parse: parseCtx, prev: e.prev?.answer.intent ?? null, closed: data.closed.length };
        void routeViaServer(q, { history, page, setups: settings.setups.map((s) => s.name), assets: parseCtx.assets as string[] }, uctx)
          .then(({ questions, clarify }) => {
            if (!questions.length) {
              const replies: Reply[] = [{ kind: "clarify", text: clarify ?? "Das konnte ich nicht zuordnen.", suggestions: turn.replies[0]?.kind === "clarify" ? turn.replies[0].suggestions : [] }];
              conv.getState().update(id, { replies, routing: false });
              return;
            }
            const replies = questions.flatMap((cq) => execute(understand(cq, uctx), cq, env()).replies);
            conv.getState().update(id, { replies, via: ["KI-Sprachhilfe", ...questions.slice(0, 2)], routing: false });
            aloud(replies);
          })
          .catch(() => conv.getState().update(id, { routing: false }));
      } else aloud(turn.replies);
    },
    [env, conv, routerOk, parseCtx, data.closed.length, page, settings.setups],
  );

  const voice = useSpeechInput(
    useCallback(
      (t: string) => {
        if (t) ask(t);
      },
      [ask],
    ),
  );
  const startedFor = useRef(0);
  useEffect(() => {
    if (!wantListen || startedFor.current === seq) return;
    startedFor.current = seq;
    const t = setTimeout(() => voice.toggle(), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once per open request
  }, [wantListen, seq]);

  // keep the newest answer in view
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [entries.length]);
  useEffect(() => () => stopSpeaking(), []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    voice.stop();
    ask(text);
  };
  const note = speechMessage(voice.state);
  const chips = useMemo(() => suggestFor({ mem }), [mem]);
  const settle = useCallback((id: number) => conv.getState().settle(id), [conv]);
  const listening = voice.state === "listening" || voice.state === "starting";

  return (
    <div className="grid gap-4" data-testid="assistant-sheet">
      <StaggerItem>
        <div className="grid gap-3">
          {entries.length === 0 ? (
            <div className="grid gap-3">
              <p className="text-[13px] leading-relaxed text-mute">{ASSISTANT_STRINGS.empty}</p>
              {view.closed.length === 0 && <p className="text-[12.5px] leading-relaxed text-faint">{ASSISTANT_STRINGS.noTrades}</p>}
              <div className="flex flex-wrap gap-1.5" aria-label="Vorschläge">
                {chips.map((c) => (
                  <Chip key={c} onClick={() => ask(c)} testId="assistant-chip">
                    {c}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-5">
              {entries.map((e) => (
                <EntryView key={e.id} entry={e} trades={byId} cur={settings.currency} style={mem.style} onAsk={ask} onSettled={settle} />
              ))}
              <div ref={bottom} />
            </div>
          )}
        </div>
      </StaggerItem>

      <StaggerItem className="sticky bottom-0 z-10 -mx-1 grid gap-2 border-t border-line bg-ink-850 px-1 pb-1 pt-3">
        <form onSubmit={onSubmit} className="flex min-w-0 gap-2" role="search" aria-label="Frage an den Assistenten">
          <label htmlFor="assistant-input" className="sr-only">
            Deine Frage
          </label>
          <input
            id="assistant-input"
            value={listening && voice.interim ? voice.interim : text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listening ? ASSISTANT_STRINGS.listening : ASSISTANT_STRINGS.placeholder}
            readOnly={listening}
            autoComplete="off"
            maxLength={300}
            enterKeyHint="send"
            data-testid="assistant-input"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-2 bg-ink-950/60 px-3.5 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-steel/50"
          />
          <MicButton state={voice.state} onClick={voice.toggle} supported={voice.supported} />
          <Button type="submit" variant="primary" disabled={!text.trim()} data-testid="assistant-send">
            Fragen
          </Button>
        </form>
        {listening && <p className="text-[11.5px] text-faint">{ASSISTANT_STRINGS.micNote}</p>}
        {note && !listening && (
          <p role="status" className="text-[12px] text-warn" data-testid="assistant-voice-note">
            {note}
          </p>
        )}
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Vorschläge">
            {chips.slice(0, 3).map((c) => (
              <Chip key={c} onClick={() => ask(c)} testId="assistant-chip">
                {c}
              </Chip>
            ))}
          </div>
        )}
      </StaggerItem>

      <StaggerItem className="grid gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-mute" id="assistant-style">
            Antwortstil
          </span>
          <div role="group" aria-labelledby="assistant-style" className="inline-flex rounded-xl border border-line-2 p-0.5">
            {STYLES.map((s) => (
              <button
                key={s.v}
                type="button"
                aria-pressed={mem.style === s.v}
                onClick={() => conv.getState().setMem((m) => ({ ...m, style: s.v }))}
                className={cn("touch-hit rounded-lg px-3 py-1 text-[12px] font-medium transition-colors", mem.style === s.v ? "bg-white/10 text-fg" : "text-mute hover:text-fg")}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {speechOutputSupported() && (
          <label className="flex items-center justify-between gap-3 text-[12px] text-mute">
            <span className="flex items-center gap-2">
              <GlyphSpeaker className="size-4" /> Antworten vorlesen
            </span>
            <Switch size="sm" checked={mem.voice.speak} onCheckedChange={(v) => conv.getState().setMem((m) => setSpeak(m, v))} aria-label="Antworten vorlesen" />
          </label>
        )}
        {entries.length > 0 && (
          <button type="button" onClick={() => conv.getState().clear()} className="touch-hit justify-self-start text-[11.5px] text-faint hover:text-fg">
            Verlauf leeren
          </button>
        )}
        <MemoryPanel />
      </StaggerItem>
    </div>
  );
}

export default function AssistantHost() {
  const open = useAssistantOpen((s) => s.open);
  const seq = useAssistantOpen((s) => s.seq);
  return (
    <Sheet open={open} onClose={closeAssistant} title={ASSISTANT_STRINGS.title} size="md" dismissGuard={false}>
      {open ? <AssistantBody key={seq} /> : null}
    </Sheet>
  );
}
