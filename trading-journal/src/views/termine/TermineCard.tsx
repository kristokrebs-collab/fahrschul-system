/**
 * Karte „Termine“ (F43): the appointments that count for trading – list and month, the next ones with „gleich“, the zone of
 * the times to choose, kinds to switch, the trader's own entries. Every entry names its source (rule, public list with the fetch
 * date, or „Eigener Eintrag“); nothing is estimated. The times are computed, not fetched: the card works offline.
 */
import { useMemo, useState } from "react";
import { EXPIRY_SOURCE, FOMC_SOURCE, FUNDING_SOURCE, KIND_GROUPS, MAX_OWN_EVENTS, WEEKEND_SOURCE, eventsBetween, fundingEvents, groupByDay, isSoon, monthGrid, nextEvents, ownEventsOf, untilText, upsertOwn, withOwnEvents, type CalendarEvent, type EventKind, type EventSource, type Importance } from "@/domain/events";
import { NYSE_SOURCE } from "@/domain/events/usEvents";
import { OWN_SOURCE } from "@/domain/events/own";
import { ZONE_CHOICES, addDays, dayKeyIn, deviceTimeZone, formatClock, offsetLabel, wallToUtc, wallStringToUtc } from "@/domain/events/zone";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { useTermine, useZone, type GroupId, type TermineView } from "./prefs";
import { TERMINE as T } from "./strings";
import { useNowMinute } from "./useNow";

const DAY = 86_400_000;
const LIST_DAYS = 21;
const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;

const GROUP_DOT: Record<GroupId, string> = { expiry: "bg-warn", fomc: "bg-loss", us: "bg-steel", funding: "bg-faint", weekend: "bg-line-2", own: "bg-win" };
const GROUP_OF: Record<EventKind, GroupId> = { funding: "funding", expiry: "expiry", usOpen: "us", usClose: "us", usHoliday: "us", weekend: "weekend", fomc: "fomc", own: "own" };

/** 00:00 of the calendar day `key` in `tz`. */
const startOfDay = (key: string, tz: string): number => wallToUtc({ y: +key.slice(0, 4), m: +key.slice(5, 7), d: +key.slice(8, 10), h: 0, min: 0 }, tz);

const dayKeyOf = dayKeyIn;

const dayTitle = (key: string): string => {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[wd]}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
};

/** One row of the list: an event, or the day's Funding settlements folded into one line. */
interface Row {
  key: string;
  ev: CalendarEvent;
  title: string;
  detail?: string;
  time: string;
  /** the Funding settlements of the day, folded */
  folded?: CalendarEvent[];
}

function rowsOf(events: readonly CalendarEvent[], tz: string): Row[] {
  const out: Row[] = [];
  const funding = events.filter((e) => e.kind === "funding");
  for (const e of events) {
    if (e.kind === "funding") continue;
    out.push({ key: e.id, ev: e, title: e.title, ...(e.detail ? { detail: e.detail } : {}), time: e.allDay ? T.allDay : formatClock(e.at, tz) });
  }
  if (funding.length) out.push({ key: `funding:${funding[0]!.id}`, ev: funding[0]!, title: "Funding-Abrechnungen", detail: funding.map((e) => formatClock(e.at, tz)).join(" · ") + " Uhr", time: formatClock(funding[0]!.at, tz), folded: funding });
  return out.sort((a, b) => a.ev.at - b.ev.at);
}

function SourceInfo({ source }: { source: EventSource }) {
  return (
    <dl className="grid gap-1 text-[11.5px] leading-snug text-mute">
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-faint">{T.source}:</dt>{" "}
        <dd>{source.label}</dd>
      </div>
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-faint">{T.rule}:</dt>{" "}
        <dd className="min-w-0">{source.rule}</dd>
      </div>
      {source.checkedAt && (
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="text-faint">{T.checked}:</dt>{" "}
          <dd className="num">{source.checkedAt.split("-").reverse().join(".")}</dd>
        </div>
      )}
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="touch-hit w-fit text-steel underline decoration-line-2 underline-offset-4 hover:text-fg">
          {T.link}
        </a>
      )}
    </dl>
  );
}

async function saveOwn(update: (items: ReturnType<typeof ownEventsOf>["items"]) => ReturnType<typeof ownEventsOf>["items"]): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const cur = ownEventsOf(settings.events).items;
  const items = update(cur);
  if (items.length > MAX_OWN_EVENTS) return false;
  const events = withOwnEvents(settings.events, items);
  if (events === settings.events) return true;
  try {
    await saveSettings({ ...settings, events });
    return true;
  } catch {
    return false;
  }
}

function EventRow({ row, now, open, onToggle }: { row: Row; now: number; open: boolean; onToggle: () => void }) {
  const e = row.ev;
  const soon = isSoon(e, now);
  const past = !e.allDay && !row.folded && e.at < now;
  return (
    <li className={cn("rounded-xl border border-line bg-ink-950/40", past && "opacity-60")} data-testid="event-row" data-kind={e.kind} data-id={e.id} data-soon={soon ? "true" : undefined}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="touch-hit grid w-full min-w-0 grid-cols-[4.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-3 py-2 text-left pointer-coarse:min-h-11">
        <span className="num font-mono text-[12.5px] text-fg">{row.time}</span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[13px] leading-snug text-fg">{row.title}</span>
          {row.detail && <span className="text-[11.5px] leading-snug text-mute">{row.detail}</span>}
          <span className="sr-only">{T.importance[e.importance as Importance]}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {soon && (
            <Badge tone="warn" dot>
              <span data-testid="event-soon">{T.soon}</span>
            </Badge>
          )}
          {!soon && e.importance === "hoch" && <Badge tone="loss">hoch</Badge>}
          {!e.allDay && !row.folded && e.at >= now && !soon && <span className="num text-[11px] text-faint">{untilText(e.at, now)}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2.5" data-testid="event-source">
          <SourceInfo source={e.source} />
          {e.kind === "own" && (
            <Button
              size="sm"
              variant="danger"
              className="mt-2 pointer-coarse:min-h-11"
              aria-label={T.own.removeOf(e.title)}
              onClick={() => {
                const id = e.id.slice(4);
                void saveOwn((items) => items.filter((x) => x.id !== id)).then((ok) => pushToast(ok ? { kind: "success", title: T.own.removed } : { kind: "error", title: T.own.errSave }));
              }}
            >
              {T.own.remove}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function OwnForm({ tz, onDone }: { tz: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [importance, setImportance] = useState<Importance>("mittel");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<{ title?: string; at?: string; save?: string }>({});
  const submit = async (): Promise<void> => {
    const e: typeof err = {};
    if (!title.trim()) e.title = T.own.errTitle;
    const ms = wallStringToUtc(at, tz);
    if (!Number.isFinite(ms)) e.at = T.own.errAt;
    setErr(e);
    if (e.title || e.at) return;
    const ok = await saveOwn((items) => upsertOwn(items, { id: newId("ev_"), title: title.trim(), at: ms, importance, note: note.trim() }));
    if (!ok) return setErr({ save: T.own.limit });
    pushToast({ kind: "success", title: T.own.saved });
    onDone();
  };
  return (
    <form
      className="grid gap-3 rounded-xl border border-line-2 bg-white/[0.02] p-3"
      data-testid="own-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <p className="text-[12px] leading-snug text-mute">{T.own.honest}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={T.own.title} htmlFor="own-title" error={err.title}>
          <Input id="own-title" value={title} maxLength={80} placeholder={T.own.titlePh} onChange={(e) => setTitle(e.target.value)} autoComplete="off" invalid={!!err.title} aria-describedby={err.title ? "own-title-error" : undefined} />
        </Field>
        <Field label={T.own.at} htmlFor="own-at" help={T.own.atHint} error={err.at}>
          <Input id="own-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} invalid={!!err.at} aria-describedby={err.at ? "own-at-error" : undefined} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <span id="own-imp-l" className="label">
            {T.own.importance}
          </span>
          <Segmented<Importance> aria-labelledby="own-imp-l" size="md" className="justify-self-start" value={importance} onChange={setImportance} options={[{ v: "hoch", label: "hoch" }, { v: "mittel", label: "mittel" }, { v: "niedrig", label: "niedrig" }]} />
        </div>
        <Field label={T.own.note} htmlFor="own-note">
          <Input id="own-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      {err.save && (
        <p className="text-[12px] text-loss" role="alert">
          {err.save}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" className="pointer-coarse:min-h-11" data-testid="own-save">
          {T.own.save}
        </Button>
        <Button type="button" size="sm" className="pointer-coarse:min-h-11" onClick={onDone}>
          {T.own.close}
        </Button>
      </div>
    </form>
  );
}

function MonthGrid({ year, month, byDay, selected, onSelect, today }: { year: number; month: number; byDay: Map<string, CalendarEvent[]>; selected: string; onSelect: (k: string) => void; today: string }) {
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  return (
    <div role="grid" aria-label={`${MONTHS[month - 1]} ${year}`} className="grid gap-1" data-testid="month-grid">
      <div role="row" className="grid grid-cols-7 gap-1 text-center text-[10.5px] uppercase tracking-[0.1em] text-faint">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <span key={d} role="columnheader">
            {d}
          </span>
        ))}
      </div>
      {weeks.map((w) => (
        <div role="row" key={w[0]!.key} className="grid grid-cols-7 gap-1">
          {w.map((c) => {
            const list = byDay.get(c.key) ?? [];
            const groups = [...new Set(list.map((e) => GROUP_OF[e.kind]))];
            const sel = c.key === selected;
            return (
              <div role="gridcell" key={c.key} aria-selected={sel} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(c.key)}
                  data-day={c.key}
                  data-count={list.length}
                  aria-label={`${dayTitle(c.key)}, ${list.length ? `${list.length} ${list.length === 1 ? "Termin" : "Termine"}` : "kein Termin"}`}
                  className={cn(
                    "relative grid h-12 w-full min-w-0 content-between justify-items-center rounded-lg border px-0.5 py-1 text-[12px] transition-colors pointer-coarse:h-12",
                    sel ? "border-line-2 bg-ink-750 text-fg" : "border-line text-mute hover:border-steel/40 hover:text-fg",
                    !c.inMonth && "opacity-40",
                    c.key === today && "ring-1 ring-steel/60",
                  )}
                >
                  <span className="num">{c.d}</span>
                  <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                    {groups.slice(0, 4).map((g) => (
                      <span key={g} className={cn("size-1.5 rounded-full", GROUP_DOT[g])} />
                    ))}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TermineCard() {
  const tz = useZone();
  const device = deviceTimeZone();
  const groups = useTermine((s) => s.groups);
  const view = useTermine((s) => s.view);
  const setTz = useTermine((s) => s.setTz);
  const toggleGroup = useTermine((s) => s.toggleGroup);
  const setView = useTermine((s) => s.setView);
  const eventsRaw = useJournal((s) => s.settings.events);
  const now = useNowMinute();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [monthShift, setMonthShift] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const own = useMemo(() => ownEventsOf(eventsRaw).items, [eventsRaw]);
  const kinds = useMemo(() => KIND_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => [...g.kinds]), [groups]);
  const today = dayKeyOf(now, tz);

  // list: from the start of today, three weeks
  const listEvents = useMemo(() => {
    const from = startOfDay(today, tz);
    return eventsBetween({ from, to: from + LIST_DAYS * DAY, kinds, own });
  }, [today, tz, kinds, own]);
  const listDays = useMemo(() => groupByDay(listEvents, tz), [listEvents, tz]);

  // month
  const base = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + monthShift, 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const monthEvents = useMemo(() => {
    if (view !== "monat") return [];
    const grid = monthGrid(year, month);
    return eventsBetween({ from: startOfDay(grid[0]![0]!.key, tz), to: startOfDay(addDays(grid[grid.length - 1]![6]!.key, 1), tz), kinds, own });
  }, [view, year, month, tz, kinds, own]);
  const byDay = useMemo(() => new Map(groupByDay(monthEvents, tz).map((g) => [g.day, g.events])), [monthEvents, tz]);
  const selected = picked ?? today;
  const selectedEvents = byDay.get(selected) ?? [];

  const next = useMemo(
    () =>
      nextEvents(now, 3, {
        kinds: kinds.filter((k) => k !== "funding" && k !== "weekend"),
        own,
      }),
    [now, kinds, own],
  );
  const nextFunding = useMemo(() => fundingEvents(now, now + 9 * 3_600_000)[0], [now]);

  const zoneOptions = useMemo(() => {
    const ids = new Set<string>([device, ...ZONE_CHOICES.map((z) => z.id)]);
    return [...ids].map((id) => ({ value: id, label: id === device ? `${T.zoneDevice} (${id})` : (ZONE_CHOICES.find((z) => z.id === id)?.label ?? id) }));
  }, [device]);

  return (
    <Card title={T.title} note={T.note} data-testid="termine-card" data-view={view}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="grid min-w-0 gap-1.5">
            <span id="termine-zone-l" className="label">
              {T.zone}
            </span>
            <MorphSelect aria-labelledby="termine-zone-l" value={tz} onChange={(v) => setTz(v === device ? null : v)} options={zoneOptions} size="md" className="min-w-[13rem]" data-testid="termine-zone" />
          </div>
          <div className="grid gap-1.5">
            <span id="termine-view-l" className="label">
              {T.view}
            </span>
            <Segmented<TermineView> aria-labelledby="termine-view-l" size="md" value={view} onChange={setView} options={[{ v: "liste", label: T.list }, { v: "monat", label: T.month }]} />
          </div>
          <span className="num text-[11.5px] text-faint" data-testid="termine-offset">
            {offsetLabel(now, tz)}
          </span>
        </div>

        <div role="group" aria-label={T.chips} className="flex flex-wrap gap-1.5">
          {KIND_GROUPS.map((g) => {
            const on = groups.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleGroup(g.id)}
                data-testid={`termine-chip-${g.id}`}
                className={cn("touch-hit inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors pointer-coarse:min-h-11", on ? "border-line-2 bg-ink-750 text-fg" : "border-line-2 text-mute hover:border-white/30 hover:text-fg")}
              >
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", GROUP_DOT[g.id])} />
                {g.label}
              </button>
            );
          })}
        </div>

        <section aria-label={T.next} className="grid gap-2" data-testid="termine-next">
          <h3 className="label">{T.next}</h3>
          {nextFunding && (
            <p className="rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px] leading-snug text-fg" data-testid="next-funding">
              {T.nextFunding}: <span className="num font-mono">{formatClock(nextFunding.at, tz)}</span> Uhr · <span className="num">{untilText(nextFunding.at, now)}</span>
              {isSoon(nextFunding, now) && (
                <>
                  {" "}
                  <Badge tone="warn" dot>
                    {T.soon}
                  </Badge>
                </>
              )}
              <span className="mt-0.5 block text-[11.5px] text-mute">{T.fundingNote}</span>
            </p>
          )}
          {next.length > 0 && (
            <ul className="grid gap-1.5">
              {next.map((e) => {
                const d = dayKeyOf(e.at, tz);
                return (
                  <li key={e.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12.5px]" data-testid="next-event" data-kind={e.kind}>
                    <span className="num font-mono text-fg">{e.allDay ? T.allDay : formatClock(e.at, tz)}</span>
                    <span className="text-faint">{d === today ? T.today : dayTitle(d)}</span>
                    <span className="min-w-0 text-fg">{e.title}</span>
                    {isSoon(e, now) && <Badge tone="warn">{T.soon}</Badge>}
                    {!e.allDay && e.at >= now && <span className="num ml-auto text-[11px] text-faint">{untilText(e.at, now)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {view === "liste" ? (
          <div className="grid gap-4" data-testid="termine-list">
            {listDays.length === 0 && <p className="text-[12.5px] text-mute">{T.empty}</p>}
            {listDays.map((g) => (
              <section key={g.day} aria-label={dayTitle(g.day)} className="grid gap-1.5" data-day={g.day}>
                <h3 className="label">
                  {g.day === today ? `${T.today} · ` : ""}
                  {dayTitle(g.day)}
                </h3>
                <ul className="grid gap-1.5">
                  {rowsOf(g.events, tz).map((r) => (
                    <EventRow key={r.key} row={r} now={now} open={openId === r.key} onToggle={() => setOpenId(openId === r.key ? null : r.key)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid gap-3" data-testid="termine-month">
            <div className="flex items-center gap-2">
              <Button size="sm" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={T.prev} onClick={() => setMonthShift(monthShift - 1)} data-testid="month-prev">
                ‹
              </Button>
              <span className="num min-w-[9rem] text-center text-[13px] text-fg" data-testid="month-label">
                {MONTHS[month - 1]} {year}
              </span>
              <Button size="sm" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={T.following} onClick={() => setMonthShift(monthShift + 1)} data-testid="month-next">
                ›
              </Button>
              {monthShift !== 0 && (
                <Button size="sm" className="pointer-coarse:min-h-11" onClick={() => setMonthShift(0)}>
                  {T.thisMonth}
                </Button>
              )}
            </div>
            <MonthGrid year={year} month={month} byDay={byDay} selected={selected} onSelect={setPicked} today={today} />
            <section aria-label={dayTitle(selected)} className="grid gap-1.5" data-testid="month-day">
              <h3 className="label">{dayTitle(selected)}</h3>
              {selectedEvents.length === 0 ? (
                <p className="text-[12.5px] text-mute">{T.emptyDay}</p>
              ) : (
                <ul className="grid gap-1.5">
                  {rowsOf(selectedEvents, tz).map((r) => (
                    <EventRow key={r.key} row={r} now={now} open={openId === r.key} onToggle={() => setOpenId(openId === r.key ? null : r.key)} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <div className="grid gap-3">
          {form ? (
            <OwnForm tz={tz} onDone={() => setForm(false)} />
          ) : (
            <Button size="sm" className="w-fit pointer-coarse:min-h-11" onClick={() => setForm(true)} data-testid="own-open">
              {T.own.open}
            </Button>
          )}
        </div>

        <details className="text-[12px] text-mute" data-testid="termine-sources">
          <summary className="cursor-pointer select-none py-1 text-faint hover:text-mute pointer-coarse:py-2.5">{T.sources.title}</summary>
          <ul className="grid gap-3 pt-2">
            {[FUNDING_SOURCE, EXPIRY_SOURCE, NYSE_SOURCE, FOMC_SOURCE, WEEKEND_SOURCE, OWN_SOURCE].map((s) => (
              <li key={s.label} className="rounded-xl border border-line bg-ink-950/40 p-3">
                <SourceInfo source={s} />
              </li>
            ))}
          </ul>
          <p className="pt-2 leading-snug">{T.sources.fomcNote}</p>
          <p className="leading-snug">{T.sources.special}</p>
        </details>
      </div>
    </Card>
  );
}
