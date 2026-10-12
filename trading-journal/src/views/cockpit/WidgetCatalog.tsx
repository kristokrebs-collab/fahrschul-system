import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Input } from "@/primitives/Input";
import { haystack, scoreFields, tokenize } from "@/search/fuzzy";
import { COCKPIT_STRINGS } from "./copy";
import { listWidgets, type CockpitWidget } from "./registry";

/** Catalog order of the groups. */
const GROUP_ORDER = ["Übersicht", "Auswertung", "Analyse", "Risiko", "Wachstum"];

export function filterWidgets(list: readonly CockpitWidget[], q: string): CockpitWidget[] {
  const tokens = tokenize(q);
  if (!tokens.length) return [...list];
  return list.filter((w) => scoreFields(tokens, haystack(w.title, [w.description ?? "", w.group ?? ""])) !== null);
}

export interface WidgetCatalogProps {
  open: boolean;
  onClose: () => void;
  /** ids already on the board */
  present: ReadonlySet<string>;
  onAdd: (w: CockpitWidget) => void;
  /** registry version (re-lists on change) */
  version: number;
}

/** "Widget hinzufügen": every registered widget by group, a fuzzy filter, add one or several. */
export function WidgetCatalog({ open, onClose, present, onAdd, version }: WidgetCatalogProps) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    void version;
    const list = filterWidgets(listWidgets(), q);
    const by = new Map<string, CockpitWidget[]>();
    for (const w of list) {
      const g = w.group ?? "Weitere";
      by.set(g, [...(by.get(g) ?? []), w]);
    }
    return [...by.entries()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]);
      const ib = GROUP_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [q, version]);

  return (
    <Sheet open={open} onClose={onClose} title={COCKPIT_STRINGS.catalog.title} dismissGuard={false}>
      <div className="grid gap-5" data-testid="widget-catalog">
        <StaggerItem>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={COCKPIT_STRINGS.catalog.filter} aria-label={COCKPIT_STRINGS.catalog.filter} />
        </StaggerItem>
        {groups.length === 0 && (
          <StaggerItem>
            <p className="py-6 text-center text-[13px] text-faint">{COCKPIT_STRINGS.catalog.none}</p>
          </StaggerItem>
        )}
        {groups.map(([g, list]) => (
          <StaggerItem key={g} as="section" aria-labelledby={`cat-${g}`}>
            <h3 id={`cat-${g}`} className="label mb-2 flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
              {g}
            </h3>
            <ul className="grid gap-1.5">
              {list.map((w) => {
                const on = present.has(w.id);
                return (
                  <li key={w.id} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5", on ? "border-line bg-white/[0.02]" : "border-line-2")}>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-[13.5px] font-medium text-fg">{w.title}</span>
                      {w.description && <span className="truncate text-[12px] text-faint">{w.description}</span>}
                    </span>
                    <button
                      type="button"
                      disabled={on}
                      onClick={() => onAdd(w)}
                      data-widget-add={w.id}
                      aria-label={on ? `${w.title}: ${COCKPIT_STRINGS.catalog.added}` : `${w.title} ${COCKPIT_STRINGS.catalog.add}`}
                      className={cn(
                        "touch-hit shrink-0 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                        on ? "border-transparent text-faint" : "border-line-2 bg-white/[0.04] text-fg hover:border-white/30",
                      )}
                    >
                      {on ? `✓ ${COCKPIT_STRINGS.catalog.added}` : `+ ${COCKPIT_STRINGS.catalog.add}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </StaggerItem>
        ))}
      </div>
    </Sheet>
  );
}
