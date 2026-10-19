/**
 * Regel-Baukasten für „Eigene Idee“ (F73): the builder of the custom strategy. The idea is a tree of AND / OR groups whose
 * leaves are building blocks, each with its own timeframe and numbers; below it stop, target and the position management
 * (break-even, trailing, partial take-profit, time stop, exit on a counter signal). Everything is live-validated, the idea
 * is read back in plain language, drafts are saved / loaded / duplicated in the lab store. Unavailable options are shown
 * DISABLED with the reason – nothing is silently ignored.
 */
import { motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import {
  BLOCKS,
  BLOCK_ORDER,
  CUSTOM_TEMPLATES,
  EXEC_TFS,
  FAMILY_LABEL,
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_LEAVES_PER_SIDE,
  TF_IDS,
  TF_LABEL,
  blockAvailability,
  type CheckEnv,
  editNode,
  leafText,
  leavesOf,
  mirrorGroup,
  newGroup,
  newLeaf,
  nextNum,
  summarizeCustom,
  tfAvailability,
  validateCustom,
  type CustomConfig,
  type Family,
  type Group,
  type Issue,
  type Leaf,
  type Node,
  type ParamDef,
  type TfId,
} from "@/domain/lab";
import { cn } from "@/lib/cn";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { radius, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { CheckboxRow } from "@/primitives/CheckboxRow";
import { Collapse } from "@/primitives/Expander";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useUi } from "@/store/uiStore";
import { DRAFTS_MAX, useLabor } from "./laborStore";
import { LABOR } from "./strings";
import { ChipPick, FieldRow, SEG_TOUCH } from "./ui";

const B = LABOR.builder;
const FAMILIES: readonly Family[] = ["momentum", "mcb", "trend", "structure", "volatility", "price", "time"];
const de = (v: number): string => String(v).replace(".", ",");

/** Everything the nested editors need from the builder. */
interface Ed {
  side: "long" | "short";
  exec: TfId;
  issues: readonly Issue[];
  /** what the run offers (funding history …) – locks blocks that need it */
  env: CheckEnv;
  disabled: boolean;
  uid: string;
  leafCount: number;
  picker: string | null;
  setPicker(id: string | null): void;
  patch(id: string, fn: (n: Node) => Node | null): void;
  add(parent: string, make: (num: number) => Node): void;
}

// ── small controls ────────────────────────────────────────────────────────────────────────────────────────────

/** A number that commits on blur / Enter and falls back to the stored value when it cannot be read. */
function NumInput({ value, label, onCommit, disabled, invalid, wide }: { value: number; label: string; onCommit: (v: number) => void; disabled?: boolean; invalid?: boolean; wide?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft.replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      numeric
      disabled={disabled}
      invalid={invalid}
      value={draft ?? de(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      wrapperClassName={wide ? "w-28" : "w-24"}
      className="text-[13px]"
    />
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="touch-hit grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-mute transition-colors hover:text-loss disabled:opacity-40 pointer-coarse:size-11 [&>svg]:size-3.5">
      <Icon name="x" />
    </button>
  );
}

function IssueLines({ issues, id }: { issues: readonly Issue[]; id?: string }) {
  if (!issues.length) return null;
  return (
    <ul id={id} className="grid gap-1">
      {issues.map((i, k) => (
        <li key={k} className={cn("text-[11.5px] leading-snug", i.level === "error" ? "text-(--color-danger-text)" : "text-warn")}>
          <span className="font-semibold">{i.level === "error" ? "Fehler: " : "Hinweis: "}</span>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

// ── leaf ──────────────────────────────────────────────────────────────────────────────────────────────────────

function ParamInput({ def, leaf, ed }: { def: ParamDef; leaf: Leaf; ed: Ed }) {
  const id = useId();
  const value = leaf.params[def.key];
  const set = (v: number | string) => ed.patch(leaf.id, (n) => (n.type === "leaf" ? { ...n, params: { ...n.params, [def.key]: v } } : n));
  const bad = leaf.block === "keyLevel" && def.key === "level" && !(Number(value) > 0);
  return (
    <FieldRow label={def.label} htmlFor={def.kind === "select" ? id : undefined} hint={def.hint} className="min-w-0 max-w-[16rem]">
      {def.kind === "select" ? (
        <MorphSelect id={id} size="sm" aria-label={`${BLOCKS[leaf.block].label}: ${def.label}`} value={String(value)} onChange={set} options={(def.options ?? []).map((o) => ({ value: o.v, label: o.label }))} disabled={ed.disabled} className="min-w-[10rem]" />
      ) : (
        <span className="flex items-center gap-1.5">
          <NumInput value={Number(value)} label={`${BLOCKS[leaf.block].label}: ${def.label}`} onCommit={set} disabled={ed.disabled} invalid={bad} />
          {def.unit && <span className="text-[11px] text-faint">{def.unit}</span>}
        </span>
      )}
    </FieldRow>
  );
}

function TfPick({ leaf, ed }: { leaf: Leaf; ed: Ed }) {
  const noteId = `${ed.uid}-tf-note`;
  const options: { v: "exec" | TfId; label: string; disabled?: boolean; title?: string }[] = [
    { v: "exec", label: `${B.tfExec} (${TF_LABEL[ed.exec]})` },
    ...TF_IDS.filter((tf) => tf !== ed.exec).map((tf) => {
      const a = tfAvailability(tf, ed.exec, leaf.block);
      return { v: tf, label: TF_LABEL[tf], disabled: !a.ok, title: a.reason };
    }),
  ];
  const value = leaf.tf === ed.exec ? "exec" : leaf.tf;
  const locked = options.some((o) => o.disabled);
  return (
    <FieldRow label={B.tf} hint={locked ? (BLOCKS[leaf.block].execOnly ?? B.tfLocked(TF_LABEL[ed.exec])) : undefined}>
      <ChipPick<"exec" | TfId> id={`${ed.uid}-${leaf.id}-tf`} label={`${B.tf}: ${BLOCKS[leaf.block].label}`} value={value} options={options} describedBy={noteId} onChange={(tf) => ed.patch(leaf.id, (n) => (n.type === "leaf" ? { ...n, tf } : n))} />
    </FieldRow>
  );
}

function LeafEditor({ leaf, ed }: { leaf: Leaf; ed: Ed }) {
  const def = BLOCKS[leaf.block];
  const reduced = useReducedFx();
  const mine = ed.issues.filter((i) => i.node === leaf.id);
  const hasError = mine.some((i) => i.level === "error");
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tween.fade}
      style={{ borderRadius: radius.input }}
      className={cn("grid gap-3 rounded-xl border bg-ink-950/50 p-3", hasError ? "border-loss/50" : "border-line")}
      data-testid="labor-leaf"
      data-block={leaf.block}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{def.label}</span>
        {def.heavy && (
          <Badge tone="warn" title={def.heavy}>
            rechenintensiv
          </Badge>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(leaf.not)}
          aria-label={`${B.not}: ${def.label}`}
          title={B.notHint}
          disabled={ed.disabled}
          onClick={() => ed.patch(leaf.id, (n) => (n.type === "leaf" ? { ...n, not: n.not ? undefined : true } : n))}
          className={cn("touch-hit min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors duration-200 disabled:opacity-40 pointer-coarse:min-h-11", leaf.not ? "border-white/40 bg-white/[0.07] text-fg" : "border-line-2 text-mute hover:text-fg")}
        >
          {B.not}
        </button>
        <RemoveButton label={`${B.removeCond}: ${def.label}`} onClick={() => ed.patch(leaf.id, () => null)} disabled={ed.disabled} />
      </div>
      <div className="grid gap-3">
        <TfPick leaf={leaf} ed={ed} />
        <div className="flex flex-wrap items-end gap-3">
          {def.params.filter((p) => !p.when || p.when(leaf.params)).map((p) => (
            <ParamInput key={p.key} def={p} leaf={leaf} ed={ed} />
          ))}
        </div>
      </div>
      <p className="text-[11.5px] leading-snug text-faint">{leafText(leaf)}</p>
      <IssueLines issues={mine} />
    </motion.li>
  );
}

// ── group ─────────────────────────────────────────────────────────────────────────────────────────────────────

function BlockPicker({ parent, ed }: { parent: string; ed: Ed }) {
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-ink-950/60 p-3" role="group" aria-label={B.pick}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{B.pick}</span>
        <Button size="sm" onClick={() => ed.setPicker(null)}>
          {B.pickClose}
        </Button>
      </div>
      {FAMILIES.map((fam) => {
        const ids = BLOCK_ORDER.filter((b) => BLOCKS[b].family === fam);
        if (!ids.length) return null;
        return (
          <div key={fam} className="grid gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{FAMILY_LABEL[fam]}</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ids.map((b) => {
                const a = blockAvailability(b, ed.exec, ed.env);
                return (
                  <button
                    key={b}
                    type="button"
                    disabled={!a.ok}
                    data-testid={`labor-block-${b}`}
                    onClick={() => {
                      ed.add(parent, (num) => newLeaf(`n${num}`, b));
                      ed.setPicker(null);
                    }}
                    className="grid min-h-11 content-start gap-0.5 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:border-white/30 focus-visible:border-white/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line"
                  >
                    <span className="text-[13px] font-semibold">{BLOCKS[b].label}</span>
                    <span className="text-[11.5px] leading-snug text-mute">{BLOCKS[b].help}</span>
                    {!a.ok && <span className="text-[11px] leading-snug text-warn">Gesperrt: {a.reason}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GroupEditor({ g, depth, ed }: { g: Group; depth: number; ed: Ed }) {
  const mine = ed.issues.filter((i) => i.node === g.id);
  const open = ed.picker === g.id;
  const full = ed.leafCount >= MAX_LEAVES_PER_SIDE || g.children.length >= MAX_CHILDREN;
  return (
    <div className={cn("grid gap-2.5", depth > 0 && "rounded-xl border border-line-2/70 bg-white/[0.015] p-3")} data-testid={depth === 0 ? "labor-tree" : "labor-group"}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<"and" | "or">
          size="sm"
          aria-label={`${depth === 0 ? B.rulesFor(ed.side) : "Gruppe"}: ${g.op === "and" ? B.allOf : B.anyOf}`}
          className={SEG_TOUCH}
          value={g.op}
          onChange={(op) => ed.patch(g.id, (n) => (n.type === "group" ? { ...n, op } : n))}
          options={[
            { v: "and", label: B.and },
            { v: "or", label: B.or },
          ]}
        />
        <span className="min-w-0 flex-1 text-[12px] text-mute">{g.op === "and" ? B.allOf : B.anyOf}</span>
        {depth > 0 && <RemoveButton label={B.removeGroup} onClick={() => ed.patch(g.id, () => null)} disabled={ed.disabled} />}
      </div>
      {g.children.length > 0 && (
        <ul className="grid gap-2" aria-label={depth === 0 ? B.rulesFor(ed.side) : "Gruppe"}>
          {g.children.map((c) => (c.type === "leaf" ? <LeafEditor key={c.id} leaf={c} ed={ed} /> : <li key={c.id}><GroupEditor g={c} depth={depth + 1} ed={ed} /></li>))}
        </ul>
      )}
      {!g.children.length && <p className="text-[12px] text-mute">{B.emptyGroup}</p>}
      <IssueLines issues={mine.filter((i) => i.level === "warn" || g.children.length === 0 || depth > 0)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={ed.disabled || full} onClick={() => ed.setPicker(open ? null : g.id)} aria-expanded={open} data-testid={depth === 0 ? "labor-add-cond" : undefined}>
          {B.addCond}
        </Button>
        {depth + 1 < MAX_DEPTH && (
          <Button size="sm" disabled={ed.disabled || full} onClick={() => ed.add(g.id, (num) => newGroup(`g${num}`, "or"))}>
            {B.addGroup}
          </Button>
        )}
      </div>
      <Collapse open={open}>
        <BlockPicker parent={g.id} ed={ed} />
      </Collapse>
    </div>
  );
}

// ── stop, target, management ─────────────────────────────────────────────────────────────────────────────────

function ManageEditor({ custom, set, disabled, uid }: { custom: CustomConfig; set: (fn: (c: CustomConfig) => CustomConfig) => void; disabled: boolean; uid: string }) {
  const { stop, target, exits } = custom;
  const setExits = (patch: Partial<CustomConfig["exits"]>) => set((c) => ({ ...c, exits: { ...c.exits, ...patch } }));
  const both = custom.sides === "both";
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow label={B.stop}>
          <ChipPick id={`${uid}-stopkind`} label={B.stop} value={stop.kind} options={(["atr", "percent", "swing"] as const).map((v) => ({ v, label: B.stopKinds[v] }))} onChange={(kind) => set((c) => ({ ...c, stop: { ...c.stop, kind } }))} />
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <FieldRow label={B.stopValue[stop.kind]}>
              <NumInput
                label={`${B.stop}: ${B.stopValue[stop.kind]}`}
                value={stop.kind === "atr" ? stop.atr : stop.kind === "percent" ? stop.pct : stop.swing}
                disabled={disabled}
                onCommit={(v) => set((c) => ({ ...c, stop: { ...c.stop, [c.stop.kind === "atr" ? "atr" : c.stop.kind === "percent" ? "pct" : "swing"]: v } }))}
              />
            </FieldRow>
            {stop.kind === "swing" && (
              <FieldRow label={B.buffer}>
                <NumInput label={`${B.stop}: ${B.buffer}`} value={stop.buffer} disabled={disabled} onCommit={(v) => set((c) => ({ ...c, stop: { ...c.stop, buffer: v } }))} />
              </FieldRow>
            )}
          </div>
        </FieldRow>
        <FieldRow label={B.target}>
          <ChipPick id={`${uid}-targetkind`} label={B.target} value={target.kind} options={(["r", "none"] as const).map((v) => ({ v, label: B.targetKinds[v] }))} onChange={(kind) => set((c) => ({ ...c, target: { ...c.target, kind } }))} />
          {target.kind === "r" && (
            <div className="flex items-end gap-3 pt-1">
              <FieldRow label={B.targetR}>
                <NumInput label={`${B.target}: ${B.targetR}`} value={target.r} disabled={disabled} onCommit={(v) => set((c) => ({ ...c, target: { ...c.target, r: v } }))} />
              </FieldRow>
            </div>
          )}
        </FieldRow>
      </div>
      <div className="grid gap-2">
        <CheckboxRow checked={exits.breakEven.on} onToggle={() => setExits({ breakEven: { ...exits.breakEven, on: !exits.breakEven.on } })} disabled={disabled}>
          {B.breakEven}
        </CheckboxRow>
        {exits.breakEven.on && (
          <div className="flex flex-wrap items-end gap-3 pl-3">
            <FieldRow label={B.breakEvenAfter}>
              <ChipPick id={`${uid}-be-trig`} label={`${B.breakEven}: ${B.breakEvenAfter}`} value={exits.breakEven.trigger} options={[{ v: "r", label: "+ R" }, { v: "pct", label: "+ %" }]} onChange={(trigger) => setExits({ breakEven: { ...exits.breakEven, trigger } })} />
            </FieldRow>
            <NumInput label={`${B.breakEven}: ${B.breakEvenAfter}`} value={exits.breakEven.value} disabled={disabled} onCommit={(value) => setExits({ breakEven: { ...exits.breakEven, value } })} />
            <FieldRow label="Stop wandert">
              <ChipPick id={`${uid}-be-to`} label={`${B.breakEven}: Ziel des Stops`} value={exits.breakEven.to} options={(["entry", "net"] as const).map((v) => ({ v, label: B.breakEvenTo[v] }))} onChange={(to) => setExits({ breakEven: { ...exits.breakEven, to } })} />
            </FieldRow>
          </div>
        )}
        <CheckboxRow checked={exits.trail.on} onToggle={() => setExits({ trail: { ...exits.trail, on: !exits.trail.on } })} disabled={disabled}>
          {B.trail}
        </CheckboxRow>
        {exits.trail.on && (
          <div className="flex flex-wrap items-end gap-3 pl-3">
            <FieldRow label="Abstand">
              <ChipPick id={`${uid}-trail-kind`} label={`${B.trail}: Abstand`} value={exits.trail.kind} options={(["atr", "pct"] as const).map((v) => ({ v, label: B.trailKinds[v] }))} onChange={(kind) => setExits({ trail: { ...exits.trail, kind } })} />
            </FieldRow>
            <NumInput label={`${B.trail}: Abstand`} value={exits.trail.value} disabled={disabled} onCommit={(value) => setExits({ trail: { ...exits.trail, value } })} />
            <FieldRow label={B.trailFrom}>
              <NumInput label={`${B.trail}: ${B.trailFrom}`} value={exits.trail.activateR} disabled={disabled} onCommit={(activateR) => setExits({ trail: { ...exits.trail, activateR } })} />
            </FieldRow>
          </div>
        )}
        <CheckboxRow checked={exits.partial.on} onToggle={() => setExits({ partial: { ...exits.partial, on: !exits.partial.on } })} disabled={disabled}>
          {B.partial}
        </CheckboxRow>
        {exits.partial.on && (
          <div className="flex flex-wrap items-end gap-3 pl-3">
            <FieldRow label={B.partialAt}>
              <NumInput label={`${B.partial}: ${B.partialAt}`} value={exits.partial.atR} disabled={disabled} onCommit={(atR) => setExits({ partial: { ...exits.partial, atR } })} />
            </FieldRow>
            <FieldRow label={B.partialFrac}>
              <NumInput label={`${B.partial}: ${B.partialFrac}`} value={exits.partial.fracPct} disabled={disabled} onCommit={(fracPct) => setExits({ partial: { ...exits.partial, fracPct } })} />
            </FieldRow>
            <CheckboxRow checked={exits.partial.thenBreakEven} onToggle={() => setExits({ partial: { ...exits.partial, thenBreakEven: !exits.partial.thenBreakEven } })} disabled={disabled} className="min-w-[14rem] flex-1">
              {B.partialBe}
            </CheckboxRow>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <FieldRow label={B.timeStop}>
            <NumInput label={B.timeStop} value={exits.maxBars} disabled={disabled} onCommit={(maxBars) => setExits({ maxBars })} wide />
          </FieldRow>
        </div>
        <CheckboxRow checked={exits.exitOnOpposite && both} onToggle={() => setExits({ exitOnOpposite: !exits.exitOnOpposite })} disabled={disabled || !both} sub={both ? undefined : B.oppositeLocked}>
          {B.opposite}
        </CheckboxRow>
        <p className="text-[11.5px] leading-snug text-faint">{B.manageNote}</p>
      </div>
    </div>
  );
}

// ── drafts ────────────────────────────────────────────────────────────────────────────────────────────────────

function DraftsPanel({ uid }: { uid: string }) {
  const drafts = useLabor((s) => s.drafts);
  const saveDraft = useLabor((s) => s.saveDraft);
  const loadDraft = useLabor((s) => s.loadDraft);
  const duplicateDraft = useLabor((s) => s.duplicateDraft);
  const deleteDraft = useLabor((s) => s.deleteDraft);
  const busy = useLabor((s) => s.status === "loading" || s.status === "running");
  const pushToast = useUi((s) => s.pushToast);
  const [open, setOpen] = useState(false);
  const full = drafts.length >= DRAFTS_MAX;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${uid}-drafts`} data-testid="labor-drafts-toggle">
          {B.draftsOpen(drafts.length)}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            if (saveDraft() == null) pushToast({ kind: "error", title: B.draftsFull(DRAFTS_MAX) });
            else {
              pushToast({ kind: "success", title: B.saved });
              setOpen(true);
            }
          }}
          data-testid="labor-draft-save"
        >
          {B.save}
        </Button>
      </div>
      <Collapse open={open} id={`${uid}-drafts`}>
        <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="labor-drafts">
          {!drafts.length ? (
            <p className="text-[12px] text-mute">{B.draftsEmpty}</p>
          ) : (
            <ul className="grid gap-1.5" aria-label={B.drafts}>
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2" data-testid="labor-draft">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{d.name}</span>
                    <span className="block truncate text-[11px] text-faint">{summarizeCustom(d.config)[0]}</span>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    aria-label={`${B.load}: ${d.name}`}
                    onClick={() => {
                      loadDraft(d.id);
                      pushToast({ kind: "success", title: B.loaded, detail: d.name });
                    }}
                  >
                    {B.load}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || full}
                    aria-label={`${B.duplicate}: ${d.name}`}
                    onClick={() => {
                      if (duplicateDraft(d.id)) pushToast({ kind: "success", title: B.duplicated, detail: d.name });
                    }}
                  >
                    {B.duplicate}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`${B.remove}: ${d.name}`}
                    onClick={() => {
                      deleteDraft(d.id);
                      pushToast({ kind: "success", title: B.removed, detail: d.name });
                    }}
                  >
                    {B.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {full && <p className="text-[11.5px] text-warn">{B.draftsFull(DRAFTS_MAX)}</p>}
        </div>
      </Collapse>
    </div>
  );
}

// ── the builder ───────────────────────────────────────────────────────────────────────────────────────────────

function Name({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const commit = () => {
    if (draft != null && draft.trim()) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <FieldRow label={B.name} htmlFor={id}>
      <Input id={id} value={draft ?? value} maxLength={60} disabled={disabled} placeholder={B.namePlaceholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} autoComplete="off" spellCheck={false} data-testid="labor-idea-name" />
    </FieldRow>
  );
}

/** The whole builder of the custom idea. */
export function RuleBuilder({ uid }: { uid: string }) {
  const custom = useLabor((s) => s.cfg.custom);
  const setCustom = useLabor((s) => s.setCustom);
  const busy = useLabor((s) => s.status === "loading" || s.status === "running");
  const pushToast = useUi((s) => s.pushToast);
  const [sideTab, setSideTab] = useState<"long" | "short">("long");
  const [picker, setPicker] = useState<string | null>(null);
  const fundingMode = useLabor((s) => s.cfg.funding);
  const env = useMemo<CheckEnv>(() => ({ funding: fundingMode === "history" }), [fundingMode]);
  const issues = useMemo(() => validateCustom(custom, env), [custom, env]);
  const lines = useMemo(() => summarizeCustom(custom), [custom]);
  const side: "long" | "short" = custom.sides === "both" ? sideTab : custom.sides;
  const root = custom[side];
  const checkId = `${uid}-check`;
  const errors = issues.filter((i) => i.level === "error");

  const ed: Ed = {
    side,
    exec: custom.interval,
    issues,
    env,
    disabled: busy,
    uid,
    leafCount: leavesOf(root).length,
    picker,
    setPicker,
    patch: (id, fn) => setCustom((c) => ({ ...c, [side]: editNode(c[side], id, fn) })),
    add: (parent, make) =>
      setCustom((c) => {
        const num = nextNum(c);
        return { ...c, [side]: editNode(c[side], parent, (n) => (n.type === "group" ? { ...n, children: [...n.children, make(num)] } : n)) };
      }),
  };

  return (
    <div className="grid gap-5" data-testid="labor-builder">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Name value={custom.name} onCommit={(name) => setCustom((c) => ({ ...c, name }))} disabled={busy} />
        <DraftsPanel uid={uid} />
      </div>

      <FieldRow label={B.templates} hint={B.templatesNote}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={B.templates}>
          {CUSTOM_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              title={t.sub}
              data-testid={`labor-template-${t.id}`}
              onClick={() => {
                setCustom(t.build());
                setPicker(null);
                pushToast({ kind: "success", title: B.templateLoaded(t.title) });
              }}
              className="touch-hit min-h-9 rounded-full border border-line-2 px-3 text-[12px] font-medium text-mute transition-colors hover:border-white/30 hover:text-fg disabled:opacity-40 pointer-coarse:min-h-11"
            >
              {t.title}
            </button>
          ))}
        </div>
      </FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label={B.exec} hint={B.execHint}>
          <ChipPick id={`${uid}-exec`} label={B.exec} value={custom.interval} options={EXEC_TFS.map((v) => ({ v, label: TF_LABEL[v] }))} onChange={(interval) => setCustom((c) => ({ ...c, interval }))} />
        </FieldRow>
        <FieldRow label={B.sides}>
          <Segmented<CustomConfig["sides"]>
            size="sm"
            aria-label={B.sides}
            className={SEG_TOUCH}
            value={custom.sides}
            onChange={(sides) => setCustom((c) => ({ ...c, sides }))}
            options={[
              { v: "long", label: B.sideLong },
              { v: "short", label: B.sideShort },
              { v: "both", label: B.sideBoth },
            ]}
            tones={{ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" }}
          />
        </FieldRow>
      </div>

      <section className="grid gap-3" aria-label={B.rulesFor(side)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {custom.sides === "both" ? (
            <Segmented<"long" | "short">
              size="sm"
              aria-label="Welche Regeln bearbeiten"
              className={SEG_TOUCH}
              value={sideTab}
              onChange={(s) => {
                setSideTab(s);
                setPicker(null);
              }}
              options={[
                { v: "long", label: `${B.rulesFor("long")} (${leavesOf(custom.long).length})` },
                { v: "short", label: `${B.rulesFor("short")} (${leavesOf(custom.short).length})` },
              ]}
            />
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">{B.rulesFor(side)}</span>
          )}
          {custom.sides === "both" && sideTab === "short" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setCustom((c) => ({ ...c, short: mirrorGroup(c.long, "g2", nextNum(c)) }));
                pushToast({ kind: "success", title: B.mirrorDone });
              }}
              data-testid="labor-mirror"
            >
              {B.mirror}
            </Button>
          )}
        </div>
        <p className="text-[11.5px] leading-snug text-faint" id={`${uid}-tf-note`}>
          {B.rulesNote} {B.tfNote}
        </p>
        <GroupEditor g={root} depth={0} ed={ed} />
      </section>

      <section className="grid gap-3" aria-label={B.stopTarget}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">{B.stopTarget}</span>
        <ManageEditor custom={custom} set={(fn) => setCustom(fn)} disabled={busy} uid={uid} />
      </section>

      <section className="grid gap-3 rounded-2xl border border-line bg-ink-950/50 p-4" aria-label={B.summary} data-testid="labor-idea-summary">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">{B.summary}</span>
        <ul className="grid gap-1.5">
          {lines.map((l) => (
            <li key={l} className="text-[12.5px] leading-relaxed text-fg/90">
              {l}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2" aria-label={B.check} data-testid="labor-check">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">{B.check}</span>
        {issues.length ? <IssueLines issues={issues} id={checkId} /> : <p id={checkId} className="text-[12px] text-mute">{B.checkOk}</p>}
        {errors.length > 0 && <span className="sr-only">{errors.length} Fehler</span>}
      </section>
    </div>
  );
}

export function ideaHasErrors(custom: CustomConfig): boolean {
  return validateCustom(custom).some((i) => i.level === "error");
}

