import { AnimatePresence, motion, type Variants } from "motion/react";
import { useMemo, useState, type CSSProperties } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { ED } from "@/domain/edition";
import { DEFAULT_RANK_KEY, RANK_KEYS, rankSetupStats, setupVisibleFor, type RankKey } from "@/domain/rank";
import type { AccountId } from "@/domain/types";
import { cn } from "@/lib/cn";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { radius, spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { Icon } from "@/primitives/icons";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { storageKey } from "@/store/storage";
import { useUi } from "@/store/uiStore";
import { PageHeader } from "./PageHeader";
import { playbookBySetup } from "./playbook";
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
export const SETUPS_LEAD: string = ED.COPY.setupsLead;
/** Subtitle recipe: pixel fill once per session, then the marker on the key word (key namespaced per edition). */
export const SETUPS_LEAD_FILL = { storageKey: storageKey("fill-setups"), highlight: "funktioniert" } as const;
export const NEW_SETUP_LABEL = "Neue Entscheidungsgrundlage";
export const RULES_TITLE = "Grundregeln";
export const RULES_NOTE = "Gelten für jeden Trade und stehen in jeder Checkliste. Bearbeiten unter Einstellungen.";
/** Accessible name of a rule row (it opens the settings page, where the rules are edited). */
export const RULE_EDIT_LABEL = (n: number, text: string): string => `Regel ${n} in den Einstellungen bearbeiten: ${text}`;

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));

const setupUnit = (n: number) => (n === 1 ? "Grundlage" : "Grundlagen");

/** New-setup tile: the tile dips on press, the plus turns a quarter on hover and press (`spring.plus`). */
const TILE: Variants = { press: { scale: 0.98 } };
const PLUS: Variants = { hover: { rotate: 90 }, press: { rotate: 90 } };

/**
 * `Entscheidungsgrundlagen` page (Bundle `G$`, Plan 6.3). Stats always come from `accountView(…, "all")`;
 * the account filter only hides cards (`setupVisibleFor`). Grid `motion.div layout` with
 * `AnimatePresence mode="popLayout"`; the last item is the dashed `Neue Entscheidungsgrundlage` tile.
 *
 * Motion: the header counts the visible setups (rolling digits); the new tile turns its plus, swaps its dashed
 * border for marching ants (`.fx-ants`, compositor-only, running only while hovered/focused) and dips on press;
 * the `Grundregeln` lines blur-fade in one after another when they scroll into view (`RevealGroup`).
 */
export function SetupsView({ onEdit, onNew, onTrades, className }: SetupsViewProps) {
  const settings = useJournal((s) => s.settings);
  const view = useAccountView("all");
  const setupEditor = useUi((s) => s.setupEditor);
  const openSetupEditor = useUi((s) => s.openSetupEditor);
  const [sort, setSort] = useState<RankKey>(DEFAULT_RANK_KEY);
  const [acc, setAcc] = useState<SetupAccFilter>("all");

  const ranked = useMemo(() => rankSetupStats(view.setups, sort).filter((c) => setupVisibleFor(c.setup, acc)), [view.setups, sort, acc]);
  // playbook figures (Tradezella playbook report) – same closed trades as the card stats (account "all")
  const playbooks = useMemo(() => playbookBySetup(settings.setups, view.closed), [settings.setups, view.closed]);
  const layoutDependency = `${acc}:${sort}:${ranked.map((c) => c.id).join(",")}`;

  const edit = onEdit ?? ((id: string) => openSetupEditor({ setupId: id }));
  const create = onNew ?? (() => openSetupEditor());
  const trades = onTrades ?? ((id: string) => navigate("trades", { setup: id }));
  const morphOpenId = setupEditor.open && !setupEditor.fromTrade ? setupEditor.setupId : undefined;
  const reduced = useReducedFx();

  return (
    <div className={cn("grid grid-cols-1 gap-5", className)}>
      <PageHeader
        title={SETUPS_TITLE}
        lead={SETUPS_LEAD}
        leadFill={SETUPS_LEAD_FILL}
        count={ranked.length}
        countUnit={setupUnit}
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
            <SetupCard
              key={c.id}
              stats={c}
              index={i}
              onEdit={edit}
              onTrades={trades}
              hidden={morphOpenId === c.id}
              layoutDependency={layoutDependency}
              playbook={playbooks.get(c.id)}
              currency={settings.currency}
            />
          ))}
          <motion.button
            key="__new"
            layout
            layoutDependency={layoutDependency}
            transition={{ layout: spring.layout, default: spring.press }}
            style={{ borderRadius: radius.card }}
            type="button"
            onClick={create}
            variants={TILE}
            whileHover={reduced ? undefined : "hover"}
            whileFocus={reduced ? undefined : "hover"}
            whileTap={reduced ? undefined : "press"}
            className="group relative grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-line-2 text-mute outline-none transition-colors hover:border-transparent hover:bg-white/[0.03] hover:text-fg focus-visible:border-transparent focus-visible:text-fg"
          >
            <span
              aria-hidden="true"
              className="fx-ants -inset-px opacity-0 transition-opacity duration-200 before:[animation-play-state:paused] group-hover:opacity-100 group-hover:before:[animation-play-state:running] group-focus-visible:opacity-100 group-focus-visible:before:[animation-play-state:running]"
              style={{ "--fx-ants-color": "rgb(255 255 255 / 0.38)" } as CSSProperties}
            />
            <span className="grid justify-items-center gap-2 text-[13.5px] font-semibold">
              <motion.span variants={PLUS} transition={spring.plus} className="grid size-10 place-items-center rounded-full border border-line-2 transition-colors group-hover:border-white/40 [&>svg]:size-4">
                <Icon name="plus" />
              </motion.span>
              {NEW_SETUP_LABEL}
            </span>
          </motion.button>
        </AnimatePresence>
      </motion.div>

      <Card title={RULES_TITLE} note={RULES_NOTE}>
        <RevealGroup as="ol" className="grid gap-2" aria-label={RULES_TITLE}>
          {settings.rules.map((rule, i) => (
            <RevealItem as="li" key={rule.id}>
              {/* a rule row reads like a tile: tapping it opens where it is edited (Einstellungen → Grundregeln) */}
              <button
                type="button"
                onClick={() => navigate("settings")}
                aria-label={RULE_EDIT_LABEL(i + 1, rule.text)}
                className="flex w-full items-start gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-left text-[13px] transition-colors duration-200 hover:border-white/20 focus-visible:border-white/40 pointer-coarse:min-h-11"
              >
                <span className="mt-px font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-fg/90">{rule.text}</span>
              </button>
            </RevealItem>
          ))}
        </RevealGroup>
      </Card>
    </div>
  );
}
