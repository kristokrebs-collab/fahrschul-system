/**
 * Karte „Schlüsselmarken“ (F09) on the Markt page: the user's own levels plus the five fixed levels of the settings, each
 * with its status computed from the real candles of its timeframe (`wartet / vorläufig / bestätigt / ungültig / keine
 * Daten`), add / edit / duplicate / delete, the history (intrabar and close events apart) and the precedence rule for
 * timeframes that disagree. All writes go to `settings.keyLevels` at once (`writes.ts`).
 */
import { AnimatePresence, motion } from "motion/react";
import { memo, useState } from "react";
import { KEY_TF_MS, type KeyLevel, type LevelEvent, type LevelStatus, type Precedence } from "@/domain/keylevels";
import { cn } from "@/lib/cn";
import { dateTime, n2, price as fmtPrice } from "@/lib/format";
import { usePriceSnapshot } from "@/market";
import { useKeyLevels, type KeyLevelEntry } from "@/market/keylevels";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Switch } from "@/motion/Switch";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { KeyLevelEditor } from "./KeyLevelEditor";
import { BASIS_LABEL, DIRECTION_SHORT, KIND_LABEL, KL, PRECEDENCE_OPTIONS, STATUS_GLYPH, STATUS_LABEL } from "./strings";
import { copyLevel, removeLevel, saveLevel, savePrecedence, setLevelEnabled } from "./writes";

function statusTone(status: LevelStatus, l: KeyLevel): BadgeTone {
  switch (status) {
    case "confirmed":
      return l.direction === "above" ? "win" : "loss";
    case "provisional":
      return "warn";
    default:
      return "mute";
  }
}

/** `0,42 % bis zum Trigger` / `schon 0,42 % jenseits` – the live distance in words. */
export function distanceText(e: Pick<KeyLevelEntry, "live" | "evaluation">): string | null {
  const d = e.evaluation.distancePct;
  if (!e.live || d == null || e.evaluation.status === "unknown") return null;
  return d >= 0 ? `schon ${n2(Math.abs(d))} % jenseits des Triggers` : `noch ${n2(Math.abs(d))} % bis zum Trigger`;
}

function eventTime(ev: LevelEvent, level: KeyLevel): string {
  // the candle's open time; a close event belongs to the END of the candle
  const t = ev.basis === "close" ? ev.at + KEY_TF_MS[level.tf] : ev.at;
  return dateTime(new Date(t));
}

function History({ entry }: { entry: KeyLevelEntry }) {
  const list = [...entry.evaluation.events].reverse().slice(0, 8);
  return (
    <div className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="keylevel-history">
      <span className="label">{KL.history}</span>
      {list.length === 0 ? (
        <p className="text-[12px] text-faint">{KL.historyNone}</p>
      ) : (
        <ul className="grid gap-1">
          {list.map((ev, i) => (
            <li key={`${ev.at}-${ev.kind}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className="num font-mono text-faint">{eventTime(ev, entry.level)}</span>
              <Badge tone={ev.basis === "intrabar" ? "warn" : "mute"}>{BASIS_LABEL[ev.basis]}</Badge>
              <span className="text-mute">{ev.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  entry: KeyLevelEntry;
  onEdit: (l: KeyLevel) => void;
  onCopy: (l: KeyLevel) => void;
  onRemove: (l: KeyLevel) => void;
  onToggle: (l: KeyLevel, on: boolean) => void;
}

const LevelRow = memo(function LevelRow({ entry, onEdit, onCopy, onRemove, onToggle }: RowProps) {
  const reduced = useReducedFx();
  const { level: l, evaluation: ev } = entry;
  const fixed = !!l.legacy;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const status: LevelStatus = l.enabled ? ev.status : "unknown";
  const label = l.enabled ? STATUS_LABEL[status] : "Aus";
  const dist = l.enabled ? distanceText(entry) : null;
  return (
    <motion.li
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: tween.exit }}
      transition={tween.fade}
      className={cn("grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3", !l.enabled && "opacity-60")}
      data-testid="keylevel-row"
      data-status={status}
      data-id={l.id}
      data-fixed={fixed ? "1" : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={l.enabled ? statusTone(status, l) : "mute"} title={ev.reason} className={cn(status === "unknown" && "border-dashed")}>
          <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
          {label}
          {l.enabled && ev.basis && status !== "invalidated" && <span className="font-normal opacity-80">· {BASIS_LABEL[ev.basis]}</span>}
        </Badge>
        <span className="min-w-0 flex-1 text-[13.5px] [overflow-wrap:anywhere] font-medium text-fg" title={l.name}>
          {l.name}
        </span>
        <span className="num font-mono text-[13.5px] text-fg">{fmtPrice(l.price)}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-mute">
        <span className="num font-mono text-faint">{l.symbol}</span>
        <span aria-hidden="true">·</span>
        <span>{l.tf}</span>
        <span aria-hidden="true">·</span>
        <span>{DIRECTION_SHORT[l.direction]} dem Level</span>
        <span aria-hidden="true">·</span>
        <span>
          {KIND_LABEL[l.kind]}
          {l.kind === "closes" ? ` (${l.closes})` : ""}
        </span>
        {!fixed && (
          <>
            <span aria-hidden="true">·</span>
            <span>Priorität {l.priority}</span>
          </>
        )}
        {l.alerts.on && (
          <>
            <span aria-hidden="true">·</span>
            <span>Alarm {l.alerts.recurring ? "wiederkehrend" : "einmalig"}</span>
          </>
        )}
        {fixed && <Badge tone="mute">{KL.fixedTag}</Badge>}
      </p>
      <p className="text-[12px] leading-snug text-mute" data-testid="keylevel-reason">
        {l.enabled ? ev.reason : "Ausgeschaltet – nicht bewertet, keine Linie, kein Alarm."}
        {dist && <span className="text-faint"> · {dist}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3.5">
        {!fixed && (
          <span className="mr-1 inline-flex items-center gap-2">
            <Switch size="sm" checked={l.enabled} onCheckedChange={(v) => onToggle(l, v)} aria-label={`${l.name} ${l.enabled ? "ausschalten" : "einschalten"}`} className="touch-hit" />
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {KL.history}
        </Button>
        {fixed ? (
          <Button size="sm" variant="ghost" onClick={() => navigate("settings")} title={KL.fixedHelp}>
            {KL.toSettings}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onEdit(l)}>
            {KL.edit}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onCopy(l)}>
          {KL.duplicate}
        </Button>
        {!fixed &&
          (ask ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-mute" role="group" aria-label={KL.removeAsk}>
              {KL.removeAsk}
              <Button size="sm" variant="danger" onClick={() => onRemove(l)} data-testid="keylevel-remove-yes">
                {KL.yes}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>
                {KL.no}
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAsk(true)} aria-label={`${l.name} löschen`}>
              {KL.remove}
            </Button>
          ))}
      </div>
      {open && <History entry={entry} />}
    </motion.li>
  );
});

export const KeyLevelsCard = memo(function KeyLevelsCard() {
  const view = useKeyLevels();
  const { price } = usePriceSnapshot();
  const pushToast = useUi((s) => s.pushToast);
  const [editing, setEditing] = useState<{ level: KeyLevel | null } | null>(null);
  const own = view.entries.filter((e) => !e.level.legacy);
  const fixed = view.entries.filter((e) => e.level.legacy);
  const fail = (r: string) => {
    if (r === "failed") pushToast({ kind: "error", title: KL.failed });
    else if (r === "limit") pushToast({ kind: "error", title: KL.limit(40) });
  };
  const onSave = async (level: KeyLevel) => {
    const r = await saveLevel(level);
    if (r === "ok") setEditing(null);
    else fail(r);
  };
  const onCopy = async (l: KeyLevel) => fail(await copyLevel(l));
  const onRemove = async (l: KeyLevel) => fail(await removeLevel(l.id));
  const onToggle = async (l: KeyLevel, on: boolean) => fail(await setLevelEnabled(l.id, on));
  const onEdit = (l: KeyLevel) => setEditing({ level: l });
  const onPrecedence = async (p: Precedence) => fail(await savePrecedence(p));
  const help = PRECEDENCE_OPTIONS.find((o) => o.v === view.precedence)?.help;

  return (
    <Card
      title={KL.title}
      note={KL.note}
      data-testid="keylevels-card"
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing({ level: null })} aria-label={KL.addAria} data-testid="keylevel-add" disabled={!!editing}>
          + {KL.add}
        </Button>
      }
    >
      <div className="grid gap-4">
        {view.state === "idle" && (
          <p className="text-[12px] text-warn" role="status">
            {KL.marketIdle}
          </p>
        )}
        <AnimatePresence initial={false}>
          {editing && (
            <motion.div key={editing.level?.id ?? "new"} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tween.fade }} exit={{ opacity: 0, transition: tween.exit }}>
              <KeyLevelEditor level={editing.level} symbol={view.symbol} tf={view.tf} price={price} onSave={(l) => void onSave(l)} onCancel={() => setEditing(null)} />
            </motion.div>
          )}
        </AnimatePresence>

        {own.length === 0 && !editing ? (
          <EmptyState title={KL.empty} text={KL.emptyText} line={false} className="py-6" />
        ) : (
          <ul className="grid gap-2" aria-label="Eigene Schlüsselmarken" data-testid="keylevel-list">
            <AnimatePresence initial={false}>
              {own.map((e) => (
                <LevelRow key={e.level.id} entry={e} onEdit={onEdit} onCopy={onCopy} onRemove={onRemove} onToggle={onToggle} />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {fixed.length > 0 && (
          <div className="grid gap-2">
            <h3 className="label">{KL.fixedTag}</h3>
            <ul className="grid gap-2" aria-label="Feste Level aus den Einstellungen" data-testid="keylevel-fixed">
              {fixed.map((e) => (
                <LevelRow key={e.level.id} entry={e} onEdit={onEdit} onCopy={onCopy} onRemove={onRemove} onToggle={onToggle} />
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-1.5 border-t border-line pt-3">
          <span id="kl-prec-l" className="label">
            {KL.precedence}
          </span>
          <MorphSelect<Precedence> aria-labelledby="kl-prec-l" value={view.precedence} onChange={(v) => void onPrecedence(v)} options={PRECEDENCE_OPTIONS.map((o) => ({ value: o.v, label: o.label }))} className="justify-self-start sm:min-w-[16rem]" />
          <p className="text-[11px] text-faint">
            {help} {KL.precedenceHelp}
          </p>
        </div>
      </div>
    </Card>
  );
});
