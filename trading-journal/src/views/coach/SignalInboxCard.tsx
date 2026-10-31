/**
 * „Signal-Posteingang“ (F28): the signals and alerts the app raised, as a calm list – time, market, kind, direction, level and a
 * status (neu · angesehen · gehandelt · bewusst ausgelassen · abgelaufen) – ordered by relevance for this trader
 * (`@/domain/missed/inbox`: the order is written out on the card). Actions per entry: ansehen (with the outcome, once evaluated), „Ausgelassen – Grund“ (a short
 * list, so the reason is on record), im Labor testen („Diese Idee testen“), im Journal verknüpfen.
 *
 * Honest about its source: only what the app raised while it was open is here (the archive starts empty and cannot be filled
 * afterwards, this device only). The marks (seen, left out with a reason, linked trade) are stored on the archive event; the
 * journal itself is only read. The card collapses (the choice is remembered in this browser).
 */
import { useMemo, useState } from "react";
import { buildInbox, DEFAULT_INBOX_FILTER, filterInbox, INBOX_ORDER_NOTE, INBOX_STATUSES, linkCandidates, signalKindLabel, signalLevelLabel, SIGNAL_ARCHIVE_CAP, SIGNAL_ARCHIVE_DAYS, SKIP_LABEL, SKIP_REASONS, STATUS_LABEL, type InboxFilter, type InboxRow, type InboxStatus } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { r as fmtR } from "@/lib/format";
import { tradeTime } from "@/lib/dates";
import { linkTrade, markSeen, skipSignal, useSignalArchive } from "@/market/signalArchive";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { ArchiveBasis } from "./BasisLine";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { TestIdeaButton } from "@/views/labor/TestIdeaButton";
import { SignalDetail } from "./SignalDetail";
import { useOutcomeState } from "./signalOutcomes";
import { Chip, ideaInputOf, OutcomeBadge, stamp, useOutcomes } from "./signalUi";
import { SampleLine } from "./ui";

export const INBOX_STRINGS = {
  title: "Signal-Posteingang",
  note: "Was die App gemeldet hat – ruhig sortiert, mit deinem Vermerk dazu.",
  emptyTitle: "Noch nichts eingegangen",
  emptyText: `Hier landet jedes Signal, das die App auslöst: gültiger Einstieg, Box-Setup, bestätigte Schlüsselmarke, Ausbruch. Gespeichert werden Zeit, Markt und Richtung, nur auf diesem Gerät (die letzten ${SIGNAL_ARCHIVE_CAP}, höchstens ${SIGNAL_ARCHIVE_DAYS} Tage).`,
  nothingMatches: "Kein Eintrag passt zu diesem Filter.",
  skipTitle: "Warum ausgelassen?",
  skipHint: "Eine kurze Auswahl genügt – sie bleibt als dein Vermerk am Signal stehen und fließt in die Auswertung ein.",
  linkTitle: "Welcher Trade gehört dazu?",
  linkNone: "Kein Trade in der Nähe (±24 Stunden, gleicher Markt) – lege ihn erst im Journal an.",
  limits: "Ob du ein Signal bewusst ausgelassen oder nur übersehen hast, weiß die App nicht – der Vermerk „Ausgelassen“ ist deiner. Signale entstehen nur bei offener App.",
} as const;

const OPEN_KEY = storageKey("signal-inbox-open");
const SHOWN = 8;

const STATUS_TONE: Readonly<Record<InboxStatus, BadgeTone>> = { neu: "steel", angesehen: "mute", gehandelt: "win", ausgelassen: "warn", abgelaufen: "mute" };

function readOpen(): boolean {
  try {
    return readJson<boolean>(OPEN_KEY, true) !== false;
  } catch {
    return true;
  }
}

const tradeLine = (t: EnrichedTrade): string => `${stamp(+tradeTime(t))} · ${t.pair || "–"} · ${t.side === "short" ? "Short" : "Long"}${t.r != null && t.result !== "open" ? ` · ${fmtR(t.r)}` : t.result === "open" ? " · offen" : ""}`;

type Panel = "detail" | "skip" | "link" | null;

function InboxRowView({ row, list, now }: { row: InboxRow; list: readonly EnrichedTrade[]; now: number }) {
  const e = row.event;
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (p: Exclude<Panel, null>) => {
    const next = panel === p ? null : p;
    setPanel(next);
    if (p === "detail" && next) markSeen(e.id);
  };
  const idea = useMemo(() => ideaInputOf(e), [e]);
  const outcome = useOutcomeState().outcomes.get(e.id);
  const events = useSignalArchive();
  const level = signalLevelLabel(e);
  const canAct = row.entry && row.status !== "gehandelt";
  const candidates = panel === "link" ? linkCandidates(e, list) : [];
  const marks = [e.price != null ? `Einstieg ${e.price}` : null, e.stop != null ? `Stopp ${e.stop}` : null, e.target != null ? `Ziel ${e.target}` : null].filter(Boolean).join(" · ");
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="inbox-row" data-status={row.status} data-source={e.source} data-kind={e.kind}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="num font-mono text-[11.5px] text-faint">{stamp(e.at)}</span>
        <Badge tone={STATUS_TONE[row.status]} dot={row.status === "neu"}>
          {STATUS_LABEL[row.status]}
        </Badge>
        {e.side && <span className={cn("text-[11px] font-semibold uppercase tracking-wide", e.side === "short" ? "text-loss" : "text-win")}>{e.side === "short" ? "▼ Short" : "▲ Long"}</span>}
        {(e.symbol || e.tf) && <span className="num font-mono text-[11.5px] text-mute">{[e.symbol, e.tf].filter(Boolean).join(" · ")}</span>}
        <span className="text-[11.5px] text-mute">{signalKindLabel(e)}</span>
        {level && <Badge tone="mute">{level}</Badge>}
        {row.myMarket && <span className="text-[11px] text-faint">dein Markt</span>}
      </div>
      <p className="text-[12.5px] leading-snug text-fg">{e.label}</p>
      {row.skipText && (
        <p className="text-[11.5px] leading-snug text-warn" data-testid="inbox-skip-text">
          Ausgelassen: {row.skipText}
        </p>
      )}
      {row.trades.length > 0 && (
        <p className="text-[11.5px] leading-snug text-mute" data-testid="inbox-trades">
          Gehandelt: {row.trades.map(tradeLine).join(" · ")}
          {e.tradeId && row.trades[0]?.id === e.tradeId ? " (von dir verknüpft)" : ""}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-expanded={panel === "detail"} onClick={() => toggle("detail")} data-testid="inbox-view">
          {panel === "detail" ? "Zuklappen" : "Ansehen"}
        </Button>
        {canAct && (
          <Button size="sm" variant="secondary" aria-expanded={panel === "skip"} onClick={() => toggle("skip")} data-testid="inbox-skip">
            {e.skip ? "Grund ändern" : "Ausgelassen – Grund"}
          </Button>
        )}
        {idea ? (
          <TestIdeaButton input={idea} size="sm" label="Im Labor testen" testId="inbox-test" />
        ) : null}
        {row.entry && (
          <Button size="sm" variant="secondary" aria-expanded={panel === "link"} onClick={() => toggle("link")} data-testid="inbox-link">
            {e.tradeId ? "Verknüpfung ändern" : "Im Journal verknüpfen"}
          </Button>
        )}
      </div>
      {panel === "detail" && (
        <div className="grid gap-1.5 border-t border-line pt-2 text-[11.5px] leading-snug text-mute" data-testid="inbox-detail">
          {e.detail && <p>{e.detail}</p>}
          {marks && <p className="num font-mono text-faint">{marks}</p>}
          {row.entry && (
            <div className="grid gap-1">
              <OutcomeBadge o={outcome} event={e} now={now} />
            </div>
          )}
          {e.seenAt != null && <p className="text-faint">Zuerst angesehen {stamp(e.seenAt)}</p>}
          <SignalDetail row={row} events={events} trades={list} outcome={outcome} />
        </div>
      )}
      {panel === "skip" && (
        <div className="grid gap-1.5 border-t border-line pt-2" role="group" aria-label={INBOX_STRINGS.skipTitle} data-testid="inbox-skip-panel">
          <p className="text-[11.5px] text-mute">
            {INBOX_STRINGS.skipTitle} <span className="text-faint">{INBOX_STRINGS.skipHint}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SKIP_REASONS.map((r) => (
              <Chip
                key={r}
                on={e.skip === r}
                testId={`inbox-skip-${r}`}
                onClick={() => {
                  skipSignal(e.id, r);
                  setPanel(null);
                }}
              >
                {SKIP_LABEL[r]}
              </Chip>
            ))}
            {e.skip && (
              <Chip
                on={false}
                testId="inbox-skip-undo"
                onClick={() => {
                  skipSignal(e.id, null);
                  setPanel(null);
                }}
              >
                Zurücknehmen
              </Chip>
            )}
          </div>
        </div>
      )}
      {panel === "link" && (
        <div className="grid gap-1.5 border-t border-line pt-2" role="group" aria-label={INBOX_STRINGS.linkTitle} data-testid="inbox-link-panel">
          <p className="text-[11.5px] text-mute">{INBOX_STRINGS.linkTitle}</p>
          {candidates.length === 0 && !e.tradeId ? (
            <p className="text-[11.5px] text-faint">{INBOX_STRINGS.linkNone}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((t) => (
                <Chip
                  key={t.id}
                  on={false}
                  testId="inbox-link-pick"
                  onClick={() => {
                    linkTrade(e.id, t.id);
                    setPanel(null);
                  }}
                >
                  {tradeLine(t)}
                </Chip>
              ))}
              {e.tradeId && (
                <Chip
                  on={false}
                  testId="inbox-link-undo"
                  onClick={() => {
                    linkTrade(e.id, null);
                    setPanel(null);
                  }}
                >
                  Verknüpfung lösen
                </Chip>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function SignalInboxCard({ list, now, className }: { list: readonly EnrichedTrade[]; now: number; className?: string }) {
  const events = useSignalArchive();
  useOutcomes(events); // the outcome in the detail of an entry: primed from the cache, evaluated automatically (signalAuto.ts)
  const [open, setOpen] = useState(readOpen);
  const [filter, setFilter] = useState<InboxFilter>(DEFAULT_INBOX_FILTER);
  const [all, setAll] = useState(false);
  const rep = useMemo(() => buildInbox(events, list, now), [events, list, now]);
  const rows = useMemo(() => filterInbox(rep.rows, filter), [rep.rows, filter]);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try {
      writeJson(OPEN_KEY, next);
    } catch {
      /* the choice is a convenience */
    }
  };
  const summary = INBOX_STATUSES.filter((s) => rep.counts[s] > 0)
    .map((s) => `${rep.counts[s]} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
  return (
    <Card
      title={INBOX_STRINGS.title}
      note={INBOX_STRINGS.note}
      className={className}
      data-testid="inbox-card"
      data-total={rep.total}
      data-new={rep.counts.neu}
      data-open={open}
      innerClassName="grid content-start gap-4"
      action={
        <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={open && rep.total > 0 ? "inbox-body" : undefined} onClick={toggleOpen} data-testid="inbox-toggle">
          {open ? "Einklappen" : "Aufklappen"}
        </Button>
      }
    >
      {!open ? (
        <p className="text-[12.5px] leading-relaxed text-mute" data-testid="inbox-summary">
          {rep.total === 0 ? "Noch nichts eingegangen." : summary}
        </p>
      ) : rep.total === 0 ? (
        <EmptyState title={INBOX_STRINGS.emptyTitle} text={INBOX_STRINGS.emptyText} line={false} />
      ) : (
        <div id="inbox-body" className="grid gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Posteingang filtern">
            <Chip on={filter.status === "alle"} onClick={() => setFilter({ ...filter, status: "alle" })} testId="inbox-filter-alle">
              Alle <span className="num font-mono text-faint">{rep.total}</span>
            </Chip>
            {INBOX_STATUSES.map((s) => (
              <Chip key={s} on={filter.status === s} onClick={() => setFilter({ ...filter, status: s })} testId={`inbox-filter-${s}`}>
                {STATUS_LABEL[s]} <span className="num font-mono text-faint">{rep.counts[s]}</span>
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Eingrenzen">
            <Chip on={filter.entries} onClick={() => setFilter({ ...filter, entries: !filter.entries })} testId="inbox-filter-entries">
              Nur Einstiege
            </Chip>
            <Chip on={filter.mine} onClick={() => setFilter({ ...filter, mine: !filter.mine })} testId="inbox-filter-mine">
              Nur meine Märkte
            </Chip>
            <SampleLine n={rows.length} className="ml-auto" />
          </div>
          {rows.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-mute" data-testid="inbox-empty-filter">
              {INBOX_STRINGS.nothingMatches}
            </p>
          ) : (
            <ul className="grid gap-2" aria-label="Eingegangene Signale">
              {shown.map((r) => (
                <InboxRowView key={r.event.id} row={r} list={list} now={now} />
              ))}
            </ul>
          )}
          {rows.length > SHOWN && (
            <button type="button" onClick={() => setAll((v) => !v)} className="touch-hit w-fit text-[12px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg">
              {all ? "Weniger anzeigen" : `Alle ${rows.length} anzeigen`}
            </button>
          )}
          <div className="grid gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint">
            <p data-testid="inbox-order">{INBOX_ORDER_NOTE}</p>
            <p>{INBOX_STRINGS.limits}</p>
            <ArchiveBasis events={events} testId="inbox-basis" />
          </div>
        </div>
      )}
    </Card>
  );
}
