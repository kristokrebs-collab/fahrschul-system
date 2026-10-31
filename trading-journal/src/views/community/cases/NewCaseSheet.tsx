import { useId, useState } from "react";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { CASES, INTERVAL_LABEL } from "@/social/caseStrings";
import { caseOutcome, latestClosedAnchor, snapToCandle, visibleBars } from "@/social/cases";
import { CASE_HORIZONS, CASE_INTERVALS, CASE_INTERVAL_MS, CASE_MIN_ANCHOR, type CaseInterval } from "@/social/contract";
import { closeSheet, postCase, useSocial } from "@/social/store";
import { CaseChart } from "./CaseChart";
import { useCaseBars } from "./useCaseBars";

type Mode = "replay" | "now";

/** `YYYY-MM-DDTHH:mm` of an instant in the local zone (the value of a `datetime-local` input). */
function localInput(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * "Neuer Chartfall": symbol, candle size, the last visible candle, how many candles ahead the question reaches, how long
 * hypotheses are taken, an optional question – and a preview that loads the real candles (what everybody will see; the
 * case is only posted when the candles are there). Mounted once at the page root by `CommunitySheets`.
 */
export function NewCaseSheet() {
  const sheet = useSocial((s) => s.sheet);
  const open = sheet?.kind === "case";
  return (
    <Sheet open={open} onClose={closeSheet} title={CASES.sheetTitle} size="md" dismissGuard={false}>
      {sheet?.kind === "case" && <Body groupId={sheet.groupId} />}
    </Sheet>
  );
}

function Body({ groupId }: { groupId: string }) {
  const busy = useSocial((s) => s.busy);
  const [now] = useState(() => Date.now());
  const [pair, setPair] = useState("BTCUSDT");
  const [interval, setIntervalSize] = useState<CaseInterval>("4h");
  const [horizon, setHorizon] = useState<number>(12);
  const [mode, setMode] = useState<Mode>("replay");
  const [at, setAt] = useState(() => localInput(now - 20 * CASE_INTERVAL_MS["4h"]));
  const [openHours, setOpenHours] = useState("24");
  const [question, setQuestion] = useState("");
  const pairId = useId();
  const atId = useId();
  const qId = useId();

  const symbol = pair.trim().toUpperCase();
  const symbolOk = /^[A-Z0-9]{4,20}$/.test(symbol);
  const latest = latestClosedAnchor(interval, now);
  const typed = Date.parse(at);
  const anchorMs = mode === "now" ? latest : Number.isFinite(typed) ? snapToCandle(interval, typed) : NaN;
  const anchorOk = Number.isFinite(anchorMs) && anchorMs >= CASE_MIN_ANCHOR && anchorMs <= latest;
  const frame = { pair: symbol, interval, anchorMs, horizon };
  const ready = symbolOk && anchorOk;
  const load = useCaseBars(frame, ready);
  const bars = load.status === "ok" ? load.bars : null;
  const outcome = bars ? caseOutcome(bars, frame, now) : null;
  const visible = bars ? visibleBars(bars, frame) : [];
  const complete = !!outcome && outcome.status !== "unavailable";
  const problem = outcome?.status === "unavailable" ? CASES.unavailable[outcome.reason] : null;

  const post = async () => {
    if (!ready || !complete) return;
    const ok = await postCase(groupId, { pair: symbol, interval, anchorMs, horizon: horizon as 12, question: question.trim(), openHours: Number(openHours) as 24 });
    if (ok) closeSheet();
  };

  return (
    <div className="grid gap-3" data-testid="case-sheet">
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{CASES.sheetLead}</p>
      </StaggerItem>

      <StaggerItem as="section" className="grid gap-3 rounded-2xl border border-line bg-ink-900/60 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={CASES.pair} htmlFor={pairId} error={pair && !symbolOk ? CASES.loadErrors.symbol : undefined}>
            <Input id={pairId} value={pair} maxLength={20} autoCapitalize="characters" spellCheck={false} onChange={(e) => setPair(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} placeholder={CASES.pairPlaceholder} className="font-mono uppercase" data-testid="case-pair" />
          </Field>
          <div className="grid content-start gap-1.5">
            <span className="label">{CASES.size}</span>
            <Segmented<CaseInterval> size="sm" aria-label={CASES.size} options={CASE_INTERVALS.map((i) => ({ v: i, label: INTERVAL_LABEL[i] }))} value={interval} onChange={setIntervalSize} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="label">{CASES.when}</span>
          <Segmented<Mode> size="sm" aria-label={CASES.when} options={[{ v: "replay", label: CASES.whenReplay }, { v: "now", label: CASES.whenNow }]} value={mode} onChange={setMode} />
          {mode === "replay" && (
            <Field label={CASES.whenAt} htmlFor={atId} className="pt-1">
              <Input id={atId} type="datetime-local" value={at} max={localInput(latest)} onChange={(e) => setAt(e.target.value)} data-testid="case-at" />
            </Field>
          )}
          <p className="text-[12px] leading-snug text-mute">{CASES.whenHint[mode]}</p>
          {anchorOk && (
            <p className="font-mono text-[11px] text-faint" data-testid="case-anchor">
              {CASES.anchor(stamp(anchorMs))} · {CASES.candleOf(INTERVAL_LABEL[interval])}
            </p>
          )}
          {!anchorOk && mode === "replay" && Number.isFinite(typed) && <p className="text-[12px] text-warn">{CASES.notClosed}</p>}
        </div>
        <div className="grid gap-1.5">
          <span className="label">{CASES.horizon}</span>
          <Segmented<string> size="sm" aria-label={CASES.horizon} options={CASE_HORIZONS.map((h) => ({ v: String(h), label: CASES.horizonUnit(h) }))} value={String(horizon)} onChange={(v) => setHorizon(Number(v))} />
        </div>
        <div className="grid gap-1.5">
          <span className="label">{CASES.openFor}</span>
          <Segmented<string> size="sm" aria-label={CASES.openFor} options={CASES.openOptions.map((o) => ({ v: o.v, label: o.label }))} value={openHours} onChange={setOpenHours} />
        </div>
        <Field label={CASES.questionLabel} htmlFor={qId}>
          <Input id={qId} value={question} maxLength={280} onChange={(e) => setQuestion(e.target.value)} placeholder={CASES.questionPlaceholder} data-testid="case-question" />
        </Field>
      </StaggerItem>

      <StaggerItem as="section" className="grid gap-3 rounded-2xl border border-line bg-ink-900/60 p-4" data-testid="case-preview">
        <h3 className="label">{CASES.preview}</h3>
        {!ready ? (
          <p className="text-[12.5px] text-mute">{CASES.previewNone}</p>
        ) : load.status === "loading" || load.status === "idle" ? (
          <Skeleton className="aspect-[640/260] w-full rounded-xl" />
        ) : load.status === "error" ? (
          <p className="text-[12.5px] text-warn" role="alert">
            {load.message}
          </p>
        ) : (
          <>
            <CaseChart visible={visible} future={[]} frame={frame} />
            {problem && (
              <p className="text-[12.5px] text-warn" role="alert" data-testid="case-problem">
                {problem}
              </p>
            )}
          </>
        )}
        <p className="text-[12px] leading-snug text-faint">{CASES.never}</p>
      </StaggerItem>

      <StaggerItem className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={closeSheet}>Abbrechen</Button>
        <Button variant="primary" onClick={post} disabled={!ready || !complete || busy === "case"} data-testid="case-post">
          {CASES.post}
        </Button>
      </StaggerItem>
    </div>
  );
}
