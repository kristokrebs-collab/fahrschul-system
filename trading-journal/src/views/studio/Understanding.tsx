/**
 * What the studio made of the text, in five plain-language cards – nothing is guessed silently:
 *   Das habe ich verstanden   the trader's own words marked, each with the rule the lab makes of it
 *   Unklar                    the places that did not become a rule, with the reason
 *   Fragen an dich            answer chips; an answer completes the rules and re-reads the text
 *   Meine Annahmen            the defaults taken where the text was silent – changeable by chip or by writing the value
 *   So rechnet das Labor      the rules as sentences, and whether they can run
 */
import { summarizeCustom } from "@/domain/lab";
import type { Ask, AssumptionItem, StrategyParse } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { MarkedText, Mini } from "./ui";
import { whyNotReady } from "./resolve";

const R = STUDIO.result;

function Chips({
  options,
  value,
  onPick,
  disabled,
  label,
  testPrefix,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onPick: (id: string) => void;
  disabled: boolean;
  label: string;
  testPrefix: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(o.id)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50",
              on ? "border-white/40 bg-white/[0.1] text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg",
            )}
            data-testid={`${testPrefix}-${o.id}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AskRow({ ask, stale, source }: { ask: Ask; stale: boolean; source: StrategyParse["source"] }) {
  const choose = useStudio.getState().choose;
  const canAnswer = ask.options.length > 0 && source === "local";
  const state = ask.chosen != null ? R.questions.answered : ask.blocking ? R.questions.needed : R.questions.provisional;
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid={`studio-ask-${ask.id}`} data-state={ask.chosen != null ? "answered" : ask.blocking ? "needed" : "open"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-fg/90">{ask.text}</p>
        <Badge tone={ask.chosen != null ? "win" : ask.blocking ? "warn" : "mute"}>{state}</Badge>
      </div>
      {canAnswer ? (
        <Chips options={ask.options} value={ask.chosen} onPick={(id) => choose(ask.id, id)} disabled={stale} label={ask.text} testPrefix={`studio-answer-${ask.id}`} />
      ) : (
        <p className="text-[12px] text-faint">{R.questions.textOnly}</p>
      )}
    </li>
  );
}

function AssumptionRow({ item, stale, source }: { item: AssumptionItem; stale: boolean; source: StrategyParse["source"] }) {
  const choose = useStudio.getState().choose;
  return (
    <li className="grid gap-2 text-[12.5px] leading-snug text-fg/85" data-testid={`studio-assume-${item.id}`}>
      <span>{item.text}</span>
      {item.options.length > 0 && source === "local" && (
        <Chips options={item.options} value={item.value} onPick={(id) => choose(item.id, id)} disabled={stale} label={item.text} testPrefix={`studio-assume-${item.id}`} />
      )}
    </li>
  );
}

export function Understanding({ className }: { className?: string }) {
  const parsed = useStudio((s) => s.parsed);
  const editorText = useStudio((s) => s.editor.text);
  if (!parsed) return null;
  const stale = parsed.text !== editorText;
  const why = whyNotReady(parsed.rules, parsed);
  const lines = summarizeCustom(parsed.rules);
  const src = parsed.source;
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className, stale && "opacity-60")} data-testid="studio-understanding" data-stale={stale || undefined}>
      <div className="flex min-w-0 flex-col lg:col-span-7 [&>*]:flex-1">
        <Card title={R.understood.title} note={R.understood.note} data-testid="studio-understood">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Mini>{R.yourText}</Mini>
              <MarkedText text={parsed.text} understood={parsed.understood} unclear={parsed.unclear} />
              <p className="flex flex-wrap gap-3 text-[11px] text-faint">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-sm bg-win/60" />
                  {R.legendOk}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-sm bg-warn/60" />
                  {R.legendNo}
                </span>
              </p>
            </div>
            {parsed.understood.length === 0 ? (
              <p className="text-[13px] text-mute" data-testid="studio-understood-empty">
                {R.understood.empty}
              </p>
            ) : (
              <ol className="grid gap-2" aria-label={R.understood.title}>
                {parsed.understood.map((u, i) => (
                  <li
                    key={u.id}
                    className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-3"
                    data-testid="studio-understood-item"
                    data-kind={u.kind}
                  >
                    <span className="min-w-0 text-[13px] text-fg">
                      <span className="mr-1.5 font-mono text-[10px] text-faint">{i + 1}</span>
                      <mark className="rounded-md bg-win/15 px-1 py-0.5 text-fg shadow-[inset_0_-2px_0_var(--color-win)]">{u.phrase}</mark>
                    </span>
                    <span className="min-w-0 text-[12.5px] text-mute">
                      <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{R.kind[u.kind] ?? u.kind}</span>
                      {u.meaning}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 content-start gap-5 lg:col-span-5">
        <Card title={R.unclear.title} note={R.unclear.note} data-testid="studio-unclear">
          {parsed.unclear.length === 0 ? (
            <p className="text-[13px] text-mute">{R.unclear.none}</p>
          ) : (
            <ul className="grid gap-2" aria-label={R.unclear.title}>
              {parsed.unclear.map((u) => (
                <li key={u.id} className="grid gap-0.5 rounded-xl border border-warn/25 bg-warn/[0.05] px-3 py-2" data-testid="studio-unclear-item">
                  {u.phrase && <mark className="justify-self-start rounded-md bg-warn/15 px-1 py-0.5 text-[13px] text-fg shadow-[inset_0_-2px_0_var(--color-warn)]">{u.phrase}</mark>}
                  <span className="text-[12.5px] text-fg/85">{u.why}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={R.questions.title} note={R.questions.note} data-testid="studio-questions">
          {parsed.asks.length === 0 && parsed.questions.length === 0 ? (
            <p className="text-[13px] text-mute">{R.questions.none}</p>
          ) : parsed.asks.length > 0 ? (
            <ul className="grid gap-2" aria-label={R.questions.title}>
              {parsed.asks.map((a) => (
                <AskRow key={a.id} ask={a} stale={stale} source={src} />
              ))}
            </ul>
          ) : (
            <ul className="grid gap-2">
              {parsed.questions.map((q) => (
                <li key={q} className="text-[13px] text-fg/90">
                  {q}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col lg:col-span-5 [&>*]:flex-1">
        <Card title={R.assumptions.title} note={R.assumptions.note} data-testid="studio-assumptions">
          {parsed.assumptionItems.length === 0 && parsed.assumptions.length === 0 ? (
            <p className="text-[13px] text-mute">{R.assumptions.none}</p>
          ) : (
            <ul className="grid gap-3" aria-label={R.assumptions.title}>
              {parsed.assumptionItems.map((a) => (
                <AssumptionRow key={a.id} item={a} stale={stale} source={src} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col lg:col-span-7 [&>*]:flex-1">
        <Card title={R.rules.title} note={R.rules.note} data-testid="studio-rules" action={<Badge tone={why ? "warn" : "win"}>{why ? R.notReady : R.ready}</Badge>}>
          <div className="grid gap-3">
            <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/85" aria-label={R.rules.title}>
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {why && (
              <p className="text-[12.5px] text-warn" data-testid="studio-not-ready">
                {R.notReadyWhy} <span className="text-fg/80">{why}</span>
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
