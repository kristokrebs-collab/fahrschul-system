import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { useState, type KeyboardEvent } from "react";
import type { Rule, Trade } from "@/domain/types";
import { newRuleId } from "@/lib/ids";
import { radius, spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";

export const RULES_STRINGS = {
  title: "Grundregeln",
  note: "Stehen in jeder Checkliste. Reihenfolge per Griff oder Pfeiltasten.",
  add: "+ Regel hinzufügen",
  remove: "Regel entfernen",
  removeHint: (n: number) => `${n} Trades verlieren den Haken`,
  rule: (n: number) => `Regel ${n}`,
  move: (n: number) => `Regel ${n} verschieben`,
  yes: "Ja",
  no: "Nein",
} as const;

/** Trades that have `checks["g:{ruleId}"] === true`. */
export function ruleUsage(trades: readonly Trade[], ruleId: string): number {
  const key = `g:${ruleId}`;
  return trades.filter((t) => t.checks?.[key] === true).length;
}

export function moveRule(list: readonly Rule[], from: number, dir: -1 | 1): Rule[] {
  const to = from + dir;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it as Rule);
  return out;
}

export interface RulesCardProps {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
  trades: readonly Trade[];
  className?: string;
}

/**
 * NEW `Grundregeln` card (Plan 6.4): editable `settings.rules` – text inputs, `Reorder` (drag handle +
 * arrow keys), `+ Regel hinzufügen` (ids `newRuleId()`), `Regel entfernen` with the hint
 * `{n} Trades verlieren den Haken` as inline confirm. Built-in ids stay stable. Rows enter/exit via
 * `AnimatePresence mode="popLayout"` (Plan 3.3). Saved with the page's `Speichern`.
 */
export function RulesCard({ rules, onChange, trades, className }: RulesCardProps) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const ids = rules.map((r) => r.id).join();

  const remove = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
    setConfirm(null);
  };

  return (
    <Card title={RULES_STRINGS.title} note={RULES_STRINGS.note} className={className}>
      <Reorder.Group axis="y" values={rules} onReorder={onChange} className="grid gap-2" aria-label={RULES_STRINGS.title}>
        <AnimatePresence mode="popLayout" initial={false}>
          {rules.map((rule, i) => {
            const used = ruleUsage(trades, rule.id);
            return (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={rules.length}
                ids={ids}
                confirming={confirm === rule.id}
                used={used}
                onText={(text) => onChange(rules.map((r) => (r.id === rule.id ? { ...r, text } : r)))}
                onMove={(dir) => onChange(moveRule(rules, i, dir))}
                onRemove={() => (used > 0 ? setConfirm(rule.id) : remove(rule.id))}
                onConfirm={() => remove(rule.id)}
                onCancel={() => setConfirm(null)}
              />
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
      <Button size="sm" className="mt-3 justify-self-start" onClick={() => onChange([...rules, { id: newRuleId(), text: "" }])}>
        {RULES_STRINGS.add}
      </Button>
    </Card>
  );
}

interface RuleRowProps {
  rule: Rule;
  index: number;
  count: number;
  ids: string;
  used: number;
  confirming: boolean;
  onText: (text: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function RuleRow({ rule, index, count, ids, used, confirming, onText, onMove, onRemove, onConfirm, onCancel }: RuleRowProps) {
  const controls = useDragControls();
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onMove(-1);
    } else if (e.key === "ArrowDown" && index < count - 1) {
      e.preventDefault();
      onMove(1);
    }
  };
  return (
    <Reorder.Item
      value={rule}
      dragListener={false}
      dragControls={controls}
      layout
      layoutDependency={ids}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
      transition={{ ...spring.layout, layout: spring.layout }}
      style={{ borderRadius: radius.input }}
      className="grid gap-2"
      data-testid={`rule-${rule.id}`}
    >
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={RULES_STRINGS.move(index + 1)}
          title="Ziehen oder Pfeiltasten"
          onPointerDown={(e) => controls.start(e)}
          onKeyDown={onHandleKey}
          className="grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-xl border border-line-2 text-faint hover:text-fg active:cursor-grabbing"
        >
          <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="2.5" r="1" />
            <circle cx="8" cy="2.5" r="1" />
            <circle cx="4" cy="6" r="1" />
            <circle cx="8" cy="6" r="1" />
            <circle cx="4" cy="9.5" r="1" />
            <circle cx="8" cy="9.5" r="1" />
          </svg>
        </button>
        <Input value={rule.text} aria-label={RULES_STRINGS.rule(index + 1)} onChange={(e) => onText(e.target.value)} autoComplete="off" />
        <button
          type="button"
          aria-label={RULES_STRINGS.remove}
          onClick={onRemove}
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute hover:text-loss [&>svg]:size-4"
        >
          <Icon name="x" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {confirming && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={tween.fade}
            className="flex flex-wrap items-center gap-2 pl-12 text-[12.5px] text-[#ff8a90]"
            role="alert"
          >
            {RULES_STRINGS.removeHint(used)}
            <Button size="sm" variant="danger" onClick={onConfirm}>
              {RULES_STRINGS.yes}
            </Button>
            <Button size="sm" onClick={onCancel}>
              {RULES_STRINGS.no}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
