/**
 * Strategy block of a setup card (P07, additive below the playbook): conformity with the setup's own plan, exit
 * fidelity, examples and the strategy tags in one tappable strip – a morph source (`setup-strategy-{id}`) that opens
 * the strategy profile: entry / exit criteria, risk model, markets, recognition rules, the conformity per part (bars grow
 * `scaleX`) and the best-practice gallery (`ReelWindow`: hard cuts through the examples, then the tableau). Examples
 * open the trade detail.
 */
import { motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { BOX_KIND_TEXT, CONFORMITY_LABEL, examplesOf, hasStrategyData, SESSION_TEXT, STOP_RULE_LABEL, strategyConformity, strategyOf, type ConformityPart, type SetupX } from "@/domain/strategy";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, pct0, r as fmtR } from "@/lib/format";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { MorphCard } from "@/motion/MorphCard";
import { useMorphDialog } from "@/motion/MorphDialog";
import { ReelWindow } from "@/motion/pulse/ReelWindow";
import { StaggerItem } from "@/motion/Stagger";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ShotImage } from "@/journal/screenshots/ShotThumb";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import type { PlaybookStats } from "./playbook";

export const STRATEGY_BLOCK_STRINGS = {
  title: "Strategie",
  open: (name: string) => `Strategie-Profil: ${name}`,
  conformity: "Konformität",
  exit: "Exit-Treue",
  examples: "Beispiele",
  entry: "Entry-Kriterien",
  exitCriteria: "Exit-Kriterien",
  noEntry: "Noch keine Entry-Kriterien. Im Editor unter „Strategie“ ergänzen.",
  noExit: "Noch keine Exit-Kriterien. Daraus misst das Playbook die Exit-Treue.",
  risk: "Risiko-Modell",
  markets: "Märkte & Timeframes",
  auto: "Auto-Erkennung",
  parts: "Konformität je Teil",
  gallery: "Best Practice",
  suggested: "Vorschlag",
  noExamples: "Noch keine Beispiele. Im Editor deine besten Trades als Vorbild markieren.",
} as const;

/**
 * Whether a card shows the block: once the setup describes its strategy (criteria, tags, risk model, markets,
 * recognition rules or examples) – a classic setup keeps exactly its old card (its playbook gains the exit fidelity).
 */
export function showsStrategy(setup: Setup): boolean {
  return hasStrategyData(strategyOf(setup));
}

export function StrategyBlock({ setup, playbook }: { setup: Setup; playbook?: PlaybookStats }) {
  const x = useMemo(() => strategyOf(setup), [setup]);
  const st = playbook?.strategy;
  return (
    <MorphCard
      id={`setup-strategy-${setup.id}`}
      title={`${STRATEGY_BLOCK_STRINGS.title} · ${setup.name}`}
      as="div"
      body={() => <StrategyProfile setupId={setup.id} />}
      motionProps={{ "aria-label": STRATEGY_BLOCK_STRINGS.open(setup.name) } as Record<string, string>}
      className="@container rounded-xl border border-line bg-ink-950/50 px-3 py-2.5 transition-colors duration-200 hover:border-white/25 focus-visible:border-white/40"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{STRATEGY_BLOCK_STRINGS.title}</span>
        <span aria-hidden="true" className="grid size-4 place-items-center rounded-full border border-line-2 text-[10px] leading-none text-mute">
          +
        </span>
      </span>
      <span className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-mute" data-testid="setup-strategy">
        <span className="whitespace-nowrap">
          {STRATEGY_BLOCK_STRINGS.conformity}: <span className={cn("num font-mono", st?.score == null ? "text-faint" : st.score >= 80 ? "text-win" : st.score < 50 ? "text-[#ff8a90]" : "text-fg/90")}>{st?.score ?? "–"}</span>
        </span>
        <span className="whitespace-nowrap">
          {STRATEGY_BLOCK_STRINGS.examples}: <span className="num font-mono text-fg/90">{st?.examples ?? x.examples.length}</span>
        </span>
      </span>
      {x.tags.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {x.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-fg/80">
              {t}
            </span>
          ))}
          {x.tags.length > 4 && <span className="px-1 text-[10.5px] text-faint">+{x.tags.length - 4}</span>}
        </span>
      )}
    </MorphCard>
  );
}

/** The dialog body: the full strategy profile of a setup. */
export function StrategyProfile({ setupId }: { setupId: string }) {
  const settings = useJournal((s) => s.settings);
  const view = useAccountView("all");
  const setup = settings.setups.find((s) => s.id === setupId);
  const x = useMemo(() => (setup ? strategyOf(setup) : null), [setup]);
  const conf = useMemo(() => (x ? strategyConformity(x, view.closed, settings) : null), [x, view.closed, settings]);
  const ex = useMemo(() => (x && conf ? examplesOf(x, view.closed, conf.perTrade) : null), [x, view.closed, conf]);
  if (!x || !conf || !ex) return <p className="text-[13px] text-mute">Grundlage nicht gefunden.</p>;
  return (
    <div className="grid gap-5" data-testid="strategy-profile">
      <StaggerItem className="grid gap-4 sm:grid-cols-2">
        <Criteria title={STRATEGY_BLOCK_STRINGS.entry} items={x.entryCriteria.map((c) => c.text)} empty={STRATEGY_BLOCK_STRINGS.noEntry} />
        <Criteria title={STRATEGY_BLOCK_STRINGS.exitCriteria} items={x.exitCriteria.map((c) => c.text)} empty={STRATEGY_BLOCK_STRINGS.noExit} />
      </StaggerItem>
      <StaggerItem className="grid gap-3 sm:grid-cols-3">
        <Facts title={STRATEGY_BLOCK_STRINGS.risk}>{riskText(x)}</Facts>
        <Facts title={STRATEGY_BLOCK_STRINGS.markets}>{[x.markets.join(", "), x.tf.join(" · ")].filter(Boolean).join(" · ") || "Alle"}</Facts>
        <Facts title={STRATEGY_BLOCK_STRINGS.auto}>{autoText(x)}</Facts>
      </StaggerItem>
      <StaggerItem className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="label !text-fg">{STRATEGY_BLOCK_STRINGS.parts}</span>
          {conf.score != null && <ConfidenceMeter value={conf.score} label={STRATEGY_BLOCK_STRINGS.conformity} cols={16} />}
        </div>
        <Parts parts={conf.parts} />
        <p className="text-[12px] text-mute">
          {conf.exit.n ? `Exit-Treue ${pct0(conf.exit.rate)}: ${conf.exit.plan} planmäßig, ${conf.exit.breaks} Brüche.` : "Exit-Treue noch nicht messbar (Ausstiegsgrund oder Stop / Ziel fehlen)."}
          {conf.conformWinRate != null && conf.otherWinRate != null ? ` Regelkonform gewinnst du ${pct0(conf.conformWinRate)} (${conf.conformN} Trades), sonst ${pct0(conf.otherWinRate)} (${conf.otherN}).` : ""}
        </p>
      </StaggerItem>
      <StaggerItem>
        <Gallery name={x.name} picked={ex.picked} suggested={ex.suggested} />
      </StaggerItem>
    </div>
  );
}

function riskText(x: SetupX): string {
  const r = x.riskModel;
  const parts = [r.riskPct != null ? `${String(r.riskPct).replace(".", ",")} % Risiko` : null, r.maxLeverage != null ? `≤ ${r.maxLeverage}× Hebel` : null, r.minRR != null ? `CRV ≥ ${String(r.minRR).replace(".", ",")}` : null, r.stop ? `Stop: ${STOP_RULE_LABEL[r.stop]}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Kein eigenes Modell";
}

function autoText(x: SetupX): string {
  const a = x.auto;
  const parts = [a.boxKinds.length ? `Box: ${a.boxKinds.map((k) => BOX_KIND_TEXT[k]).join(", ")}` : null, a.minGrade ? `Note ≥ ${a.minGrade}` : null, a.minStrength != null ? `Check ≥ ${a.minStrength}` : null, a.sides.length === 1 ? (a.sides[0] === "long" ? "nur Long" : "nur Short") : null, a.sessions.length ? a.sessions.map((k) => SESSION_TEXT[k]).join(", ") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Aus Texten und Historie";
}

function Criteria({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="grid content-start gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</span>
      {items.length ? (
        <ul className="grid gap-1.5">
          {items.map((t, i) => (
            <li key={`${i}-${t}`} className="flex gap-2 text-[12.5px] text-fg/85">
              <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-aqua/70" />
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-faint">{empty}</p>
      )}
    </div>
  );
}

function Facts({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</span>
      <span className="text-[12.5px] text-fg/85">{children}</span>
    </div>
  );
}

function Parts({ parts }: { parts: Partial<Record<ConformityPart, { rate: number; n: number }>> }) {
  const reduced = useReducedFx();
  const keys = (Object.keys(CONFORMITY_LABEL) as ConformityPart[]).filter((k) => parts[k]);
  if (!keys.length) return <p className="text-[12px] text-faint">Noch nichts messbar.</p>;
  return (
    <ul className="grid gap-1.5">
      {keys.map((k, i) => {
        const v = parts[k]!;
        return (
          <li key={k} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-[12px]">
            <span className="text-mute">{CONFORMITY_LABEL[k]}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
              <motion.span
                className={cn("block h-full origin-left rounded-full", v.rate >= 0.8 ? "bg-win" : v.rate < 0.5 ? "bg-loss" : "bg-fg/70")}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: v.rate }}
                transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows }}
              />
            </span>
            <span className="num text-right font-mono text-fg/90">{pct0(v.rate)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ExampleFace({ t, fill = false }: { t: EnrichedTrade; fill?: boolean }) {
  const shot = t.screenshots?.[0];
  return (
    <div className={cn("relative w-full overflow-hidden bg-ink-900", fill ? "h-full" : "aspect-[16/10]")}>
      {shot ? (
        <ShotImage shot={shot} />
      ) : (
        <span className="grid size-full place-items-center p-3 text-center">
          <span className="grid gap-1">
            <span className="font-mono text-[11px] text-faint">{t.pair}</span>
            <span className={cn("dot-num text-[26px]", (t.r ?? 0) >= 0 ? "text-win" : "text-loss")}>{t.r != null ? fmtR(t.r) : "–"}</span>
          </span>
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-[10.5px] text-fg/90">
        <span>{fmtDate(new Date(t.date))}</span>
        <span className="num font-mono">{t.r != null ? fmtR(t.r) : ""}</span>
      </span>
    </div>
  );
}

function Gallery({ name, picked, suggested }: { name: string; picked: EnrichedTrade[]; suggested: EnrichedTrade[] }) {
  const openDetail = useUi((s) => s.openDetail);
  const { close } = useMorphDialog();
  const all = [...picked, ...suggested];
  if (!all.length) return <p className="text-[12.5px] text-faint">{STRATEGY_BLOCK_STRINGS.noExamples}</p>;
  const open = (id: string) => {
    close();
    openDetail(id, "insights");
  };
  return (
    <div className="grid gap-3" data-testid="strategy-gallery">
      <span className="label !text-fg">{STRATEGY_BLOCK_STRINGS.gallery}</span>
      {all.length >= 2 && (
        <ReelWindow
          label={`${STRATEGY_BLOCK_STRINGS.gallery}: ${name}`}
          lines={[STRATEGY_BLOCK_STRINGS.gallery, name]}
          swapLines={["Trade the best.", "Vergiss den Rest."]}
          reels={all.map((t) => <ExampleFace key={t.id} t={t} fill />)}
          cards={all.slice(0, 6).map((t) => <ExampleFace key={t.id} t={t} />)}
          className="w-full"
        />
      )}
      <ul className="grid gap-1.5">
        {all.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => open(t.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left text-[12.5px] transition-colors hover:border-white/25 pointer-coarse:min-h-11">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("font-mono", t.side === "short" ? "text-loss" : "text-win")}>{t.side === "short" ? "▼" : "▲"}</span>
                <span className="truncate">
                  {t.pair} · {fmtDate(new Date(t.date))}
                </span>
                {!picked.includes(t) && <span className="shrink-0 rounded-full border border-dashed border-line-2 px-1.5 text-[10px] text-faint">{STRATEGY_BLOCK_STRINGS.suggested}</span>}
              </span>
              <span className={cn("num font-mono font-semibold", (t.r ?? t.pnl ?? 0) >= 0 ? "text-win" : "text-loss")}>{t.r != null ? fmtR(t.r) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
