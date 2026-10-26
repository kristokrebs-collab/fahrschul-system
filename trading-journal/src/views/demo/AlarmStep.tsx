/**
 * Step 5 – Alarm: set a mark (price, direction, trigger rule) and replay the example candles up to the candle you pick with the
 * real functions of the key levels (`replayAlarm`). What comes out is what the mark WOULD have said – no mark is created, nothing
 * is stored, no server is asked, no notification is requested.
 */
import { useMemo } from "react";
import { ALARM_BARS, ALARM_RULES, ALARM_START, alarmRange, replayAlarm, STATUS_TEXT, type AlarmRule, type AlarmSetup } from "@/domain/demo/alarm";
import { demoHourly } from "@/domain/demo/candles";
import type { LevelDirection } from "@/domain/keylevels/types";
import { price as fmtPrice } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Field } from "@/primitives/Field";
import { Segmented } from "@/primitives/Segmented";
import { DemoCard } from "./DemoCard";
import { DemoChart, type ChartMark } from "./DemoChart";
import { patch, useSession } from "./session";
import { ALARM } from "./strings";

const TONE = { waiting: "mute", provisional: "warn", confirmed: "win", invalidated: "loss", unknown: "mute" } as const;

export function AlarmStep() {
  const setup = useSession((s) => s.alarm);
  const at = useSession((s) => s.alarmAt);
  const range = useMemo(() => alarmRange(), []);
  const set = (p: Partial<AlarmSetup>): void => patch({ alarm: { ...setup, ...p } });
  const upTo = at === 0 ? ALARM_BARS - 1 : at - 1;
  const replay = useMemo(() => replayAlarm(setup, upTo), [setup, upTo]);
  const bars = useMemo(() => demoHourly().slice(ALARM_START, ALARM_START + upTo + 1), [upTo]);
  const marks: ChartMark[] = replay.events.map((e, i) => ({ index: e.at, n: i + 1, price: demoHourly()[ALARM_START + e.at]!.c }));
  const step = 0.1;
  const rule = ALARM_RULES.find((r) => r.v === setup.rule)!;
  return (
    <DemoCard step="alarm" title={ALARM.title} lead={ALARM.lead} candles>
      <div className="grid gap-3.5 sm:grid-cols-2" data-testid="demo-alarm-form">
        <Field label={ALARM.price} htmlFor="demo-alarm-price" help={`Die Beispiel-Kerzen laufen von ${fmtPrice(range.lo)} bis ${fmtPrice(range.hi)}.`}>
          <div className="flex items-center gap-3">
            <input
              id="demo-alarm-price"
              type="range"
              min={Math.floor(range.lo)}
              max={Math.ceil(range.hi)}
              step={step}
              value={setup.price}
              onChange={(e) => set({ price: Math.round(Number(e.target.value) * 10) / 10 })}
              className="h-11 min-w-0 flex-1 accent-[var(--color-signal)]"
              data-testid="demo-alarm-price"
              aria-valuetext={fmtPrice(setup.price)}
            />
            <span className="num w-16 shrink-0 text-right font-mono text-[14px] text-fg" data-testid="demo-alarm-price-text">
              {fmtPrice(setup.price)}
            </span>
          </div>
        </Field>
        <Field label={ALARM.direction}>
          <Segmented<LevelDirection> size="sm" aria-label={ALARM.direction} value={setup.direction} onChange={(v) => set({ direction: v })} options={[{ v: "above", label: ALARM.above }, { v: "below", label: ALARM.below }]} />
        </Field>
        <Field label={ALARM.rule} className="sm:col-span-2" help={rule.help}>
          <Segmented<AlarmRule> size="sm" aria-label={ALARM.rule} value={setup.rule} onChange={(v) => set({ rule: v })} options={ALARM_RULES.map((r) => ({ v: r.v, label: r.label }))} className="max-w-full flex-wrap" />
        </Field>
        <Field label={ALARM.scrub} htmlFor="demo-alarm-at" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            <input
              id="demo-alarm-at"
              type="range"
              min={1}
              max={ALARM_BARS}
              step={1}
              value={upTo + 1}
              onChange={(e) => patch({ alarmAt: Number(e.target.value) })}
              className="h-11 min-w-0 flex-1 accent-[var(--color-signal)]"
              data-testid="demo-alarm-at"
              aria-valuetext={ALARM.scrubOf(upTo + 1, ALARM_BARS)}
            />
            <span className="num w-28 shrink-0 text-right font-mono text-[12px] text-mute" data-testid="demo-alarm-at-text">
              {ALARM.scrubOf(upTo + 1, ALARM_BARS)}
            </span>
          </div>
        </Field>
      </div>

      <DemoChart bars={bars} lines={[{ price: setup.price, label: "Marke", tone: "level" }]} marks={marks} label={ALARM.chartLabel} testId="demo-alarm-chart" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="label">{ALARM.status}</span>
        <Badge tone={TONE[replay.status]} dot>
          {STATUS_TEXT[replay.status]}
        </Badge>
        <span className="min-w-0 text-[12.5px] text-mute" data-testid="demo-alarm-reason">
          {replay.reason}
        </span>
      </div>

      <section className="grid gap-2" aria-label={ALARM.events} data-testid="demo-alarm-events" data-n={replay.events.length}>
        <h3 className="label">{ALARM.events}</h3>
        {replay.events.length === 0 ? (
          <p className="text-[12.5px] text-mute">{ALARM.noEvents}</p>
        ) : (
          <ol className="grid gap-1.5">
            {replay.events.map((e, i) => (
              <li key={`${e.at}-${e.stage}`} className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="demo-alarm-event" data-stage={e.stage}>
                <span className="num font-mono text-[11.5px] text-mute">
                  {ALARM.mark} {i + 1} · {ALARM.eventLine(e.at, e.stageLabel)}
                </span>
                <span className="text-[12.5px] font-medium text-fg">{e.title}</span>
                <span className="text-[12px] leading-relaxed text-mute">{e.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute">{ALARM.channel}</p>
      <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute">{ALARM.real}</p>
    </DemoCard>
  );
}
