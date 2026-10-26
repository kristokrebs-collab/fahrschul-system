/**
 * Step 2 – Regelentwurf: an idea in words (the real local translator of the Strategie-Studio) or from the kit (the real rule tree
 * of the lab), ending in the same plain-language rules the test runs. The translator never guesses silently: what it understood
 * (with the trader's own words), what it did not (with the reason), the questions and the assumptions are all shown.
 */
import { useMemo } from "react";
import { DEMO_IDEAS, kitConfig, KIT_OPTIONS, plainText, readIdea, type Kit } from "@/domain/demo/ideas";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { DemoCard } from "./DemoCard";
import { patch, useSession } from "./session";
import { RULES } from "./strings";
import type { StrategyParse } from "@/domain/strategytext";

/** The rules the test runs: the words when they are readable, else the kit (the card says so). */
export function useDemoRules() {
  const mode = useSession((s) => s.ideaMode);
  const text = useSession((s) => s.text);
  const answers = useSession((s) => s.answers);
  const kit = useSession((s) => s.kit);
  const parse = useMemo(() => (text.trim() ? readIdea(text, answers) : null), [text, answers]);
  const kitRules = useMemo(() => kitConfig(kit), [kit]);
  const fromWords = mode === "words" && parse?.ready === true;
  return { mode, parse, rules: fromWords ? parse!.rules : kitRules, fromWords, kitRules };
}

const seg = <T extends string>(options: readonly { v: string; label: string }[]) => options as unknown as readonly { v: T; label: string }[];

function KitForm() {
  const kit = useSession((s) => s.kit);
  const set = (p: Partial<Kit>) => patch({ kit: { ...kit, ...p } });
  const K = RULES.kit;
  return (
    <div className="grid gap-3.5 sm:grid-cols-2" data-testid="demo-kit">
      <Field label={K.side}>
        <Segmented<Kit["side"]> size="sm" aria-label={K.side} value={kit.side} onChange={(v) => set({ side: v })} options={seg(KIT_OPTIONS.side)} />
      </Field>
      <Field label={K.interval}>
        <Segmented<Kit["interval"]> size="sm" aria-label={K.interval} value={kit.interval} onChange={(v) => set({ interval: v })} options={seg(KIT_OPTIONS.interval)} />
      </Field>
      <Field label={K.entry} className="sm:col-span-2">
        <Segmented<Kit["entry"]> size="sm" aria-label={K.entry} value={kit.entry} onChange={(v) => set({ entry: v })} options={seg(KIT_OPTIONS.entry)} className="max-w-full flex-wrap" />
      </Field>
      <Field label={K.filter}>
        <Segmented<Kit["filter"]> size="sm" aria-label={K.filter} value={kit.filter} onChange={(v) => set({ filter: v })} options={seg(KIT_OPTIONS.filter)} className="max-w-full flex-wrap" />
      </Field>
      <Field label={K.stop}>
        <Segmented<Kit["stop"]> size="sm" aria-label={K.stop} value={kit.stop} onChange={(v) => set({ stop: v })} options={seg(KIT_OPTIONS.stop)} />
      </Field>
      <Field label={K.target}>
        <Segmented<"1.5" | "2" | "3"> size="sm" aria-label={K.target} value={String(kit.target) as "1.5" | "2" | "3"} onChange={(v) => set({ target: Number(v) as Kit["target"] })} options={seg(KIT_OPTIONS.target)} />
      </Field>
      <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute sm:col-span-2">{RULES.kitNote}</p>
    </div>
  );
}

function Words({ parse }: { parse: StrategyParse | null }) {
  const text = useSession((s) => s.text);
  const answers = useSession((s) => s.answers);
  return (
    <div className="grid gap-3.5" data-testid="demo-words">
      <Field label={RULES.textLabel} htmlFor="demo-idea" help={RULES.textHelp}>
        <Textarea id="demo-idea" value={text} onChange={(e) => patch({ text: e.target.value.slice(0, 600), answers: {} })} rows={3} maxLength={600} data-testid="demo-idea" spellCheck={false} />
      </Field>
      <div className="grid gap-1.5">
        <span className="label">{RULES.examples}</span>
        <div className="flex flex-wrap gap-2">
          {DEMO_IDEAS.map((i) => (
            <Button key={i.id} size="sm" onClick={() => patch({ text: i.text, answers: {} })} data-testid={`demo-example-${i.id}`}>
              {i.title}
            </Button>
          ))}
        </div>
      </div>
      {!parse ? (
        <p className="text-[12.5px] text-mute">{RULES.empty}</p>
      ) : (
        <div className="grid gap-3.5" data-testid="demo-parse" data-ready={parse.ready ? "1" : "0"}>
          {parse.understood.length > 0 && (
            <section className="grid gap-1.5" aria-label={RULES.understood}>
              <h3 className="label">{RULES.understood}</h3>
              <ul className="grid gap-1.5">
                {parse.understood.map((u) => (
                  <li key={u.id} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="demo-understood">
                    <span className="text-[12px] text-mute">„{u.phrase}“</span>
                    <span className="text-[12.5px] text-fg">{u.meaning}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {parse.unclear.length > 0 && (
            <section className="grid gap-1.5" aria-label={RULES.unclear}>
              <h3 className="label">{RULES.unclear}</h3>
              <ul className="grid gap-1.5">
                {parse.unclear.map((u) => (
                  <li key={u.id} className="grid gap-0.5 rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2" data-testid="demo-unclear">
                    {u.phrase && <span className="text-[12px] text-mute">„{u.phrase}“</span>}
                    <span className="text-[12.5px] text-fg">{u.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {parse.asks.length > 0 && (
            <section className="grid gap-2" aria-label={RULES.questions}>
              <h3 className="label">{RULES.questions}</h3>
              {parse.asks.map((a) => (
                <div key={a.id} className="grid gap-1.5" data-testid="demo-ask">
                  <p className="text-[12.5px] text-fg">{a.text}</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={a.text}>
                    {a.options.map((o) => (
                      <Button key={o.id} size="sm" variant={a.chosen === o.id ? "primary" : "ghost"} aria-pressed={a.chosen === o.id} onClick={() => patch({ answers: { ...answers, [a.id]: o.id } })}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          {parse.assumptions.length > 0 && (
            <section className="grid gap-1.5" aria-label={RULES.assumptions}>
              <h3 className="label">{RULES.assumptions}</h3>
              <ul className="grid gap-1 text-[12.5px] leading-relaxed text-mute">
                {parse.assumptions.map((a, i) => (
                  <li key={i} className="list-inside list-disc">
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function RulesStep() {
  const { mode, parse, rules, fromWords } = useDemoRules();
  const plain = plainText(rules);
  const waiting = mode === "words" && !fromWords;
  return (
    <DemoCard step="regeln" title={RULES.title} lead={RULES.lead}>
      <Segmented<"words" | "kit"> size="sm" aria-label={RULES.modeLabel} value={mode} onChange={(v) => patch({ ideaMode: v, testKey: null })} options={[{ v: "words", label: RULES.mode.words }, { v: "kit", label: RULES.mode.kit }]} />
      {mode === "words" ? <Words parse={parse} /> : <KitForm />}
      <section className="grid gap-2" aria-label={RULES.plain} data-testid="demo-plain-box">
        <h3 className="label">{RULES.plain}</h3>
        <p className="text-[12px] leading-relaxed text-mute">{RULES.plainLead}</p>
        <ul className={cn("grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3 text-[13px] leading-relaxed text-fg")} data-testid="demo-plain">
          {plain.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p className="text-[12px] text-mute" data-testid="demo-rules-state" data-ready={waiting ? "0" : "1"}>
          {waiting ? (parse ? RULES.notReady : RULES.empty) : RULES.ready}
        </p>
      </section>
    </DemoCard>
  );
}
