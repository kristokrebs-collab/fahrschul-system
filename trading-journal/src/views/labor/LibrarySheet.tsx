/**
 * Strategie-Bibliothek (F06 / F15): a searchable grid of well-known strategy ideas as starting points for "Eigene Idee". Every
 * card names the idea, where it is known from, the market phase it is meant for, its typical weaknesses, the usual
 * timeframes and TYPICAL VALUES in three settings with an explanation per number. A click loads the idea as a DRAFT into the
 * builder – nothing is started, nothing is claimed about how it performs: the numbers come from the trader's own run.
 *
 * Own lazy chunk (the cards carry a lot of text); opened from the builder's template row.
 */
import { useId, useMemo, useState } from "react";
import { KIND_LABEL, KIND_ORDER, LEVELS, LEVEL_LABEL, LEVEL_NOTE, STRATEGY_CARDS, buildCard, searchCards, valueText, type LibLevel, type StrategyCard, type StrategyKind } from "@/domain/lab/library";
import { TF_LABEL } from "@/domain/lab/rules/types";
import { cn } from "@/lib/cn";
import { Sheet } from "@/motion/Sheet";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Collapse, Expander } from "@/primitives/Expander";
import { Input } from "@/primitives/Input";
import { useUi } from "@/store/uiStore";
import { useLabor } from "./laborStore";
import { ChipPick } from "./ui";

export const LIB = {
  title: "Strategie-Bibliothek",
  lead: "Bekannte Strategien als Startpunkt für „Eigene Idee“ – mit den Werten, die man dafür üblicherweise nimmt.",
  honest: "Bekannt heißt nicht wirksam. Hier stehen keine Ergebnisse und keine Erfolgsaussagen: Was eine Idee auf echter Historie getan hätte, zeigt nur dein Lauf im Labor. Ein Klick lädt die Idee als Entwurf; nichts startet von selbst.",
  levels: "Konservativ, Standard, aggressiv",
  search: "Strategie oder Indikator suchen",
  searchPh: "z. B. RSI, Turtle, Squeeze, London …",
  kind: "Typ",
  all: "Alle",
  count: (n: number, all: number) => (n === all ? `${all} Strategien` : `${n} von ${all} Strategien`),
  empty: (q: string) => `Keine Strategie passt zu „${q}“. Suche nach einem Indikator (RSI, MACD, VWAP …) oder wähle „Alle“.`,
  emptyKind: "In diesem Typ passt keine Strategie zur Suche. Wähle „Alle“.",
  known: "Bekannt aus",
  phase: "Gedacht für",
  weak: "Typische Schwächen",
  tfs: "Übliche Zeiteinheiten",
  values: "Typische Werte",
  valuesNote: "Konservativ = " + LEVEL_NOTE.conservative + ". Aggressiv = " + LEVEL_NOTE.aggressive + ".",
  load: "Als Entwurf laden",
  loaded: (title: string, level: string) => `Entwurf geladen: ${title} (${level}). Nichts wurde gestartet.`,
  needsVolume: "braucht Volumen",
  needsFunding: "braucht Funding-Historie",
  fundingOff: "Die Kosten stehen nicht auf „Funding: Historie“ – der Baustein bleibt gesperrt, bis du das änderst.",
  approx: "Näherung",
  close: "Schließen",
} as const;

const KIND_TONE: Record<StrategyKind, BadgeTone> = { trend: "steel", reversion: "teal", breakout: "warn", volatility: "mute", momentum: "win" };

function ValueTable({ card }: { card: StrategyCard }) {
  return (
    <div className="grid gap-3" data-testid="labor-lib-values">
      {card.params.map((p) => (
        <div key={p.key} className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5" data-param={p.key}>
          <div className="grid gap-0.5">
            <span className="text-[12.5px] font-semibold">{p.name}</span>
            <span className="text-[11.5px] leading-snug text-mute">{p.what}</span>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            {LEVELS.map((lv, i) => (
              <div key={lv} className="min-w-0" data-level={lv}>
                <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{LEVEL_LABEL[lv]}</dt>
                <dd className={cn("num font-mono text-[13px]", lv === "standard" ? "font-medium text-fg" : "text-mute")}>{valueText(p, i)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Details({ card }: { card: StrategyCard }) {
  return (
    <div className="grid gap-4 pt-2" data-testid="labor-lib-details">
      <dl className="grid gap-3 text-[12.5px] leading-relaxed">
        <div>
          <dt className="label">{LIB.known}</dt>
          <dd className="text-fg/90">{card.knownFrom}</dd>
        </div>
        <div>
          <dt className="label">{LIB.phase}</dt>
          <dd className="text-fg/90">{card.phase}</dd>
        </div>
        <div>
          <dt className="label">{LIB.weak}</dt>
          <dd>
            <ul className="grid list-disc gap-1 pl-4 text-fg/90 marker:text-faint">
              {card.weaknesses.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="label">{LIB.tfs}</dt>
          <dd className="num font-mono text-fg/90">{card.tfs.map((t) => TF_LABEL[t]).join(" · ")}</dd>
        </div>
      </dl>
      <section className="grid gap-2" aria-label={LIB.values}>
        <h4 className="label">{LIB.values}</h4>
        <ValueTable card={card} />
      </section>
    </div>
  );
}

function Card({ card, onLoad, fundingOk, busy }: { card: StrategyCard; onLoad: (c: StrategyCard, lv: LibLevel) => void; fundingOk: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  return (
    <article className="grid content-start gap-3 rounded-2xl border border-line bg-ink-950/50 p-4" data-testid="labor-lib-card" data-card={card.id} data-kind={card.kind}>
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className="min-w-0 text-[14px] font-semibold leading-snug">{card.title}</h3>
          <Badge tone={KIND_TONE[card.kind]}>{KIND_LABEL[card.kind]}</Badge>
          {card.needs === "volume" && <Badge tone="mute">{LIB.needsVolume}</Badge>}
          {card.needs === "funding" && <Badge tone={fundingOk ? "mute" : "warn"}>{LIB.needsFunding}</Badge>}
          {card.approx && (
            <Badge tone="warn" title={card.approx}>
              {LIB.approx}
            </Badge>
          )}
        </div>
        <p className="text-[12.5px] leading-relaxed text-mute">{card.sub}</p>
        <p className="num font-mono text-[11px] text-faint">{card.tfs.map((t) => TF_LABEL[t]).join(" · ")}</p>
        {card.needs === "funding" && !fundingOk && <p className="text-[11.5px] leading-snug text-warn">{LIB.fundingOff}</p>}
        {card.approx && <p className="text-[11.5px] leading-snug text-faint">{card.approx}</p>}
      </header>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-mute">{open ? "Details schließen" : "Herkunft, Schwächen, typische Werte"}</span>
        <Expander open={open} onToggle={() => setOpen((o) => !o)} label={card.title} controls={region} />
      </div>
      <Collapse open={open} id={region}>
        <Details card={card} />
      </Collapse>
      <div className="grid gap-1.5 border-t border-line pt-3" role="group" aria-label={`${card.title}: ${LIB.load}`}>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{LIB.load}</span>
        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((lv) => (
            <Button key={lv} size="sm" variant={lv === "standard" ? "primary" : "secondary"} disabled={busy} title={LEVEL_NOTE[lv]} onClick={() => onLoad(card, lv)} data-testid={`labor-lib-load-${card.id}-${lv}`}>
              {LEVEL_LABEL[lv]}
            </Button>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function LibrarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<StrategyKind | "all">("all");
  const setCustom = useLabor((s) => s.setCustom);
  const busy = useLabor((s) => s.status === "loading" || s.status === "running");
  const fundingOk = useLabor((s) => s.cfg.funding === "history");
  const pushToast = useUi((s) => s.pushToast);
  const shown = useMemo(() => searchCards(query, kind), [query, kind]);
  const load = (card: StrategyCard, lv: LibLevel): void => {
    setCustom(buildCard(card, lv));
    pushToast({ kind: "success", title: LIB.loaded(card.title, LEVEL_LABEL[lv]) });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={LIB.title} size="lg" dismissGuard={false}>
      <div className="grid gap-4" data-testid="labor-lib">
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-mute">{LIB.lead}</p>
        <p className="max-w-[72ch] rounded-xl border border-line-2 bg-white/[0.02] px-3.5 py-3 text-[12.5px] leading-relaxed" data-testid="labor-lib-honest">
          {LIB.honest}
        </p>
        <div className="grid gap-3">
          <Input type="search" aria-label={LIB.search} placeholder={LIB.searchPh} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} data-testid="labor-lib-search" />
          <ChipPick<StrategyKind | "all"> id="lib-kind" label={LIB.kind} value={kind} onChange={setKind} options={[{ v: "all", label: LIB.all }, ...KIND_ORDER.map((k) => ({ v: k, label: KIND_LABEL[k] }))]} />
          <p className="text-[11.5px] text-faint" role="status" data-testid="labor-lib-count">
            {LIB.count(shown.length, STRATEGY_CARDS.length)} · {LIB.valuesNote}
          </p>
        </div>
        {shown.length ? (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="labor-lib-grid">
            {shown.map((c) => (
              <Card key={c.id} card={c} onLoad={load} fundingOk={fundingOk} busy={busy} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-line px-4 py-6 text-center text-[13px] text-mute" data-testid="labor-lib-empty">
            {query.trim() ? LIB.empty(query.trim()) : LIB.emptyKind}
          </p>
        )}
      </div>
    </Sheet>
  );
}
