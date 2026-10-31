import { useState } from "react";
import { GlyphCheck } from "@/primitives/icons";
import { cn } from "@/lib/cn";
import { Collapse, Expander } from "@/primitives/Expander";
import { Badge } from "@/primitives/Badge";
import { inputClass } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { fmtWhen, type CellKey, type OcrEdit, type PreviewCell, type PreviewRow } from "../preview";

export const LIST_STRINGS = {
  select: (title: string, on: boolean) => `${title} ${on ? "abwählen" : "auswählen"}`,
  uncertain: "unsicher",
  missing: "fehlt",
  derived: "abgeleitet",
  change: "ändern",
  crop: "Ausschnitt aus dem Screenshot",
  zoom: "vergrößern",
  shrink: "verkleinern",
  duplicate: "Schon vorhanden – abgewählt",
  blocked: (why: string) => `Kann so nicht eingetragen werden: ${why}.`,
  attention: (n: number) => (n === 1 ? "1 Feld prüfen" : `${n} Felder prüfen`),
  ok: "alles gelesen",
} as const;
const S = LIST_STRINGS;

/** The short line of a collapsed trade: quantity, prices, result, time. */
export function summaryOf(row: PreviewRow): string {
  const get = (k: CellKey): PreviewCell | undefined => row.cells.find((c) => c.key === k);
  const parts = [get("qty")?.text, [get("entry")?.text, get("exit")?.text].filter((x) => x && x !== "—").join(" → "), get("pnl")?.text, fmtWhen(row.cells.find((c) => c.key === "date")?.input.replace(" ", "T") ?? null).slice(0, 16)];
  return parts.filter((p) => p && p !== "—").join(" · ");
}

interface RowProps {
  row: PreviewRow;
  taken: boolean;
  cropUrl: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onTake: (on: boolean) => void;
  onEdit: (e: OcrEdit) => void;
  index: number;
}

export function PreviewRowCard({ row, taken, cropUrl, open, onToggleOpen, onTake, onEdit, index }: RowProps) {
  const [zoom, setZoom] = useState(false);
  const blocked = row.blocked;
  const state = row.attention ? "attention" : "ok";
  return (
    <section
      className={cn("grid gap-0 rounded-2xl border bg-ink-850", taken && !blocked ? "border-line-2" : "border-line", !taken && "opacity-80")}
      aria-label={`Trade ${index + 1}: ${row.title}`}
      data-testid="ocr-trade"
      data-id={row.id}
      data-taken={taken ? "1" : "0"}
      data-state={blocked ? "blocked" : state}
    >
      <header className="flex items-start gap-3 px-3.5 py-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={taken}
          aria-label={S.select(row.title, taken)}
          onClick={() => onTake(!taken)}
          data-testid="ocr-take"
          className="touch-hit relative mt-0.5 grid size-6 shrink-0 place-items-center"
        >
          <span aria-hidden="true" className={cn("grid size-[22px] place-items-center rounded-md border transition-colors", taken ? "border-transparent bg-fg text-ink-950" : "border-line-2 bg-ink-950/60 text-transparent")}>
            <GlyphCheck className="size-3" strokeWidth="2.4" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h3 className="text-[14.5px] font-semibold">{row.title}</h3>
            {row.status === "open" && <Badge tone="teal">Offen</Badge>}
            {row.duplicate && <Badge tone="warn">{S.duplicate}</Badge>}
            {row.attention > 0 ? <Badge tone="warn">{S.attention(row.attention)}</Badge> : <Badge tone="win">{S.ok}</Badge>}
          </div>
          <p className="mt-1 break-words font-mono text-[12.5px] text-mute" data-testid="ocr-summary-line">
            {summaryOf(row) || "—"}
          </p>
          {blocked && (
            <p className="mt-1.5 text-[12px] text-warn" role="status">
              {S.blocked(blocked)}
            </p>
          )}
        </div>
        <Expander open={open} onToggle={onToggleOpen} label={row.title} />
      </header>
      <Collapse open={open}>
        <div className="grid gap-3 border-t border-line px-3.5 pb-3.5 pt-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {cropUrl ? (
            <div className="min-w-0">
              <img
                src={cropUrl}
                alt={S.crop}
                data-testid="ocr-crop"
                className={cn("w-full rounded-lg border border-line bg-ink-950 object-contain object-left-top", zoom ? "max-h-none" : "max-h-52")}
              />
              <button type="button" onClick={() => setZoom(!zoom)} className="mt-1 rounded-lg px-1 py-1 text-[11.5px] text-mute underline-offset-2 hover:text-fg hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2">
                {zoom ? S.shrink : S.zoom}
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-faint">Kein Ausschnitt (der Trade wurde nicht aus einem Bild gelesen).</p>
          )}
          <ul className="grid min-w-0 gap-1.5" aria-label="Erkannte Werte">
            {row.cells.map((c) => (
              <CellRow key={c.key} cell={c} id={row.id} onEdit={onEdit} />
            ))}
          </ul>
          {row.warnings.length > 0 && (
            <ul className="grid gap-1.5 md:col-span-2" aria-label="Hinweise">
              {row.warnings.map((w) => (
                <li key={w} className="rounded-xl border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-relaxed" data-testid="ocr-warning">
                  {w}
                </li>
              ))}
            </ul>
          )}
          {row.duplicate && (
            <p className="rounded-xl border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[12.5px] leading-relaxed md:col-span-2" data-testid="ocr-duplicate">
              {row.duplicate.text}
            </p>
          )}
        </div>
      </Collapse>
    </section>
  );
}

const EDIT_KEY: Partial<Record<CellKey, "pair" | "qty" | "entry" | "exit" | "pnl" | "leverage" | "fees">> = { pair: "pair", qty: "qty", entry: "entry", exit: "exit", pnl: "pnl", leverage: "leverage", fees: "fees" };

function CellRow({ cell, id, onEdit }: { cell: PreviewCell; id: string; onEdit: (e: OcrEdit) => void }) {
  const flagged = cell.state === "uncertain" || (cell.state === "missing" && cell.required);
  const [editing, setEditing] = useState(false);
  const inputOn = flagged || editing;
  const commit = (text: string): void => {
    if (cell.key === "side") return;
    if (cell.key === "date" || cell.key === "exitDate") onEdit({ id, kind: "time", key: cell.key, text });
    else {
      const key = EDIT_KEY[cell.key];
      if (key) onEdit({ id, kind: "field", key, text });
    }
    setEditing(false);
  };
  const inputId = `ocr-${id}-${cell.key}`;
  return (
    <li
      className={cn("grid grid-cols-[minmax(0,5.75rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2", flagged ? "border-warn/50 bg-warn/[0.07]" : "border-line bg-ink-950/40", cell.state === "missing" && cell.required && "border-dashed")}
      data-testid={`ocr-cell-${cell.key}`}
      data-state={cell.state}
    >
      <label htmlFor={inputOn && cell.key !== "side" ? inputId : undefined} className="text-[12px] text-mute">
        {cell.label}
      </label>
      <div className="min-w-0">
        {cell.key === "side" && inputOn ? (
          <Segmented
            aria-label="Richtung"
            size="sm"
            value={cell.input === "long" || cell.input === "short" ? cell.input : null}
            onChange={(v) => {
              onEdit({ id, kind: "side", value: v });
              setEditing(false);
            }}
            options={[
              { v: "long", label: "Long" },
              { v: "short", label: "Short" },
            ]}
            tones={{ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" }}
          />
        ) : inputOn && cell.key !== "side" ? (
          <input
            id={inputId}
            key={`${cell.key}-${cell.input}`}
            defaultValue={cell.input}
            inputMode={cell.key === "pair" || cell.key === "date" || cell.key === "exitDate" ? "text" : "decimal"}
            autoComplete="off"
            spellCheck={false}
            placeholder={cell.required ? "ergänzen" : "optional"}
            onBlur={(e) => e.target.value.trim() !== cell.input.trim() && commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit((e.target as HTMLInputElement).value);
              }
            }}
            className={cn(inputClass, "py-1.5 font-mono text-[13px] pointer-coarse:min-h-11")}
            data-testid={`ocr-input-${cell.key}`}
          />
        ) : (
          <span className={cn("block break-words font-mono text-[13.5px]", cell.text === "—" && "text-faint")}>{cell.text}</span>
        )}
        {cell.notes.map((n) => (
          <span key={n} className={cn("mt-0.5 block text-[11.5px] leading-snug", cell.derived && !flagged ? "text-mute" : "text-warn")}>
            {n}
          </span>
        ))}
      </div>
      <span className="flex items-center gap-2 justify-self-end">
        {cell.derived && <span className="text-[11px] font-medium text-mute">{S.derived}</span>}
        {flagged && <span className="text-[11px] font-medium text-warn">{cell.state === "missing" ? S.missing : S.uncertain}</span>}
        {!inputOn && cell.text !== "—" && (
          <button type="button" onClick={() => setEditing(true)} aria-label={`${cell.label} ändern`} className="rounded-lg px-2 py-1 text-[11.5px] text-mute underline-offset-2 hover:text-fg hover:underline pointer-coarse:min-h-11 pointer-coarse:px-3">
            {S.change}
          </button>
        )}
      </span>
    </li>
  );
}
