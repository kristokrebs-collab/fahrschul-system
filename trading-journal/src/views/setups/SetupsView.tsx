import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { DEFAULT_RANK_KEY, RANK_KEYS, rankSetupStats, setupVisibleFor, type RankKey } from "@/domain/rank";
import type { AccountId } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring } from "@/motion/tokens";
import { Card } from "@/primitives/Card";
import { Icon } from "@/primitives/icons";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { PageHeader } from "./PageHeader";
import { SetupCard } from "./SetupCard";

export type SetupAccFilter = "all" | AccountId;

export interface SetupsViewProps {
  /** Override the default (`uiStore.openSetupEditor({ setupId })`). */
  onEdit?: (id: string) => void;
  /** Override the default (`uiStore.openSetupEditor()`). */
  onNew?: () => void;
  /** Override the default (`navigate("trades", { setup: id })`). */
  onTrades?: (id: string) => void;
  className?: string;
}

export const SETUPS_TITLE = "Entscheidungsgrundlagen";
export const SETUPS_LEAD = "Deine Setups aus der MegaWhale-Methodik und deinen eigenen Regeln. Jede Karte zeigt, wie oft die Grundlage funktioniert hat.";
export const NEW_SETUP_LABEL = "Neue Entscheidungsgrundlage";
export const RULES_TITLE = "Grundregeln";
export const RULES_NOTE = "Gelten für jeden Trade und stehen in jeder Checkliste. Bearbeiten unter Einstellungen.";

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

/**
 * `Entscheidungsgrundlagen` page (Bundle `G$`, Plan 6.3). Stats always come from `accountView(…, "all")`;
 * the account filter only hides cards (`setupVisibleFor`). Grid `motion.div layout` with
 * `AnimatePresence mode="popLayout"`; the last item is the dashed `Neue Entscheidungsgrundlage` tile.
 */
export function SetupsView({ onEdit, onNew, onTrades, className }: SetupsViewProps) {
  const settings = useJournal((s) => s.settings);
  const view = useAccountView("all");
  const setupEditor = useUi((s) => s.setupEditor);
  const openSetupEditor = useUi((s) => s.openSetupEditor);
  const [sort, setSort] = useState<RankKey>(DEFAULT_RANK_KEY);
  const [acc, setAcc] = useState<SetupAccFilter>("all");

  const ranked = useMemo(() => rankSetupStats(view.setups, sort).filter((c) => setupVisibleFor(c.setup, acc)), [view.setups, sort, acc]);
  const layoutDependency = `${acc}:${sort}:${ranked.map((c) => c.id).join(",")}`;

  const edit = onEdit ?? ((id: string) => openSetupEditor({ setupId: id }));
  const create = onNew ?? (() => openSetupEditor());
  const trades = onTrades ?? ((id: string) => navigate("trades", { setup: id }));
  const morphOpenId = setupEditor.open && !setupEditor.fromTrade ? setupEditor.setupId : undefined;

  return (
    <div className={cn("grid gap-5", className)}>
      <PageHeader
        title={SETUPS_TITLE}
        lead={SETUPS_LEAD}
        action={
          <div className="flex flex-wrap gap-2">
            <Segmented aria-label="Konto" size="sm" value={acc} onChange={setAcc} options={ACC_OPTIONS} />
            <Segmented aria-label="Sortierung" size="sm" value={sort} onChange={setSort} options={RANK_KEYS} />
          </div>
        }
      />

      <motion.div layout layoutDependency={layoutDependency} transition={{ layout: spring.layout }} className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
        <AnimatePresence mode="popLayout" initial={false}>
          {ranked.map((c, i) => (
            <SetupCard key={c.id} stats={c} index={i} onEdit={edit} onTrades={trades} hidden={morphOpenId === c.id} layoutDependency={layoutDependency} />
          ))}
          <motion.button
            key="__new"
            layout
            layoutDependency={layoutDependency}
            transition={{ layout: spring.layout }}
            style={{ borderRadius: radius.card }}
            type="button"
            onClick={create}
            className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-line-2 text-mute transition-colors hover:border-white/40 hover:bg-white/[0.03] hover:text-fg"
          >
            <span className="grid justify-items-center gap-2 text-[13.5px] font-semibold">
              <span className="grid size-10 place-items-center rounded-full border border-line-2 [&>svg]:size-4">
                <Icon name="plus" />
              </span>
              {NEW_SETUP_LABEL}
            </span>
          </motion.button>
        </AnimatePresence>
      </motion.div>

      <Card title={RULES_TITLE} note={RULES_NOTE}>
        <ol className="grid gap-2" aria-label={RULES_TITLE}>
          {settings.rules.map((rule, i) => (
            <li key={rule.id} className="flex items-start gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-[13px]">
              <span className="mt-px font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-fg/90">{rule.text}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
