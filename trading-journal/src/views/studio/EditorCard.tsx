/**
 * "Strategie als Text": name, the big text field, example chips, market and period, and the three actions – Verstehen,
 * (optionally) "Mit KI genauer verstehen", "Als Entwurf speichern". The text is the source of truth: everything below the editor
 * is derived from it, and a changed text marks the reading as stale instead of silently re-reading it.
 */
import { useId, useState } from "react";
import { PERIOD_LABEL, STUDIO_PERIODS, TEXT_MAX } from "@/domain/strategytext";
import { normalizeWatchSymbol } from "@/domain/boxes";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input, Textarea } from "@/primitives/Input";
import { ChipPick, FieldRow } from "@/views/labor/ui";
import { tooLongForAi, useCompileAvailable } from "./aiClient";
import { useStudio } from "./studioStore";
import { EXAMPLES, STUDIO } from "./strings";

const E = STUDIO.editor;
const A = STUDIO.ai;

function Examples() {
  return (
    <div className="grid gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{E.examples}</span>
      <div className="flex flex-wrap gap-1.5" data-testid="studio-examples">
        {EXAMPLES.map((x) => (
          <button
            key={x.id}
            type="button"
            title={x.text}
            onClick={() => {
              const st = useStudio.getState();
              st.setEditor({ text: x.text });
              st.understand();
            }}
            className="min-h-9 rounded-full border border-line-2 px-3 text-[12px] font-medium text-mute transition-colors hover:border-white/30 hover:text-fg pointer-coarse:min-h-11"
            data-testid={`studio-example-${x.id}`}
          >
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RemoveButton() {
  const id = useStudio((s) => s.editor.id);
  const name = useStudio((s) => s.editor.name);
  const [ask, setAsk] = useState(false);
  if (!id) return null;
  if (!ask)
    return (
      <Button size="sm" className="justify-self-start" onClick={() => setAsk(true)} data-testid="studio-remove">
        {STUDIO.list.remove}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--color-danger)/30 bg-(--color-danger)/[0.06] px-3 py-2" role="group" aria-label={STUDIO.list.remove} data-testid="studio-remove-ask">
      <span className="text-[12.5px] text-fg/90">{STUDIO.list.removeAsk(name || "Strategie")}</span>
      <Button size="sm" variant="danger" onClick={() => void useStudio.getState().remove(id)} data-testid="studio-remove-yes">
        {STUDIO.list.removeYes}
      </Button>
      <Button size="sm" onClick={() => setAsk(false)}>
        {STUDIO.list.removeNo}
      </Button>
    </div>
  );
}

export function EditorCard({ className }: { className?: string }) {
  const uid = useId();
  const editor = useStudio((s) => s.editor);
  const parsed = useStudio((s) => s.parsed);
  const override = useStudio((s) => s.override);
  const ai = useStudio((s) => s.ai);
  const saveError = useStudio((s) => s.saveError);
  const aiAvailable = useCompileAvailable();
  const stale = parsed != null && parsed.text !== editor.text;
  const symNorm = normalizeWatchSymbol(editor.symbol);
  const hasText = editor.text.trim().length > 0;
  const aiTooLong = tooLongForAi(editor.text);
  const set = useStudio.getState().setEditor;

  return (
    <Card title={E.title} note={E.note} className={className} data-testid="studio-editor">
      <div className="grid gap-4">
        <FieldRow label={E.name} htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} value={editor.name} maxLength={60} placeholder={E.namePlaceholder} onChange={(e) => set({ name: e.target.value })} autoComplete="off" spellCheck={false} data-testid="studio-name" />
        </FieldRow>

        <FieldRow label={E.label} htmlFor={`${uid}-text`} hint={<span className="num font-mono text-faint">{E.count(editor.text.length, TEXT_MAX)}</span>}>
          <Textarea
            id={`${uid}-text`}
            value={editor.text}
            rows={5}
            maxLength={TEXT_MAX}
            lang="de"
            spellCheck
            placeholder={E.placeholder}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                useStudio.getState().understand();
              }
            }}
            className="min-h-32 text-[14px] leading-relaxed"
            data-testid="studio-text"
          />
        </FieldRow>

        <Examples />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <FieldRow label={E.market} htmlFor={`${uid}-sym`} hint={symNorm == null ? <span className="text-(--color-danger-text)">{E.marketInvalid}</span> : undefined}>
            <Input id={`${uid}-sym`} value={editor.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24) })} className="font-mono uppercase" autoComplete="off" spellCheck={false} invalid={symNorm == null} data-testid="studio-symbol" />
          </FieldRow>
          <FieldRow label={E.period}>
            <ChipPick id={`${uid}-period`} label={E.period} value={editor.period} options={STUDIO_PERIODS.map((p) => ({ v: p, label: PERIOD_LABEL[p] }))} onChange={(p) => set({ period: p })} />
          </FieldRow>
        </div>

        {override && (
          <div role="status" className="grid gap-2 rounded-xl border border-warn/30 bg-warn/[0.07] px-3 py-2.5" data-testid="studio-override">
            <p className="text-[12.5px] font-medium text-warn">{E.override.title}</p>
            <p className="text-[12.5px] text-fg/85">{E.override.text(override.note)}</p>
            <Button size="sm" className="justify-self-start" onClick={() => useStudio.getState().backToText()}>
              {E.override.back}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => useStudio.getState().understand()} disabled={!hasText} data-testid="studio-understand">
            {E.understand}
          </Button>
          {aiAvailable && (
            <Button onClick={() => void useStudio.getState().understandWithAi()} disabled={!hasText || ai.busy || aiTooLong} title={aiTooLong ? E.tooLongForAi : A.privacy} data-testid="studio-ai">
              {ai.busy ? A.busy : A.button}
            </Button>
          )}
          <Button onClick={() => void useStudio.getState().save()} disabled={!hasText || symNorm == null} data-testid="studio-save">
            {E.save}
          </Button>
          {parsed?.source === "ai" && !stale && (
            <>
              <Badge tone="warn" title={A.privacy} dot>
                <span data-testid="studio-ai-badge">{A.badge}</span>
              </Badge>
              <Button size="sm" onClick={() => useStudio.getState().understand()}>
                {A.back}
              </Button>
            </>
          )}
        </div>

        <div className="grid gap-1" aria-live="polite">
          {stale && (
            <p className="text-[12.5px] text-warn" data-testid="studio-stale">
              {E.stale}
            </p>
          )}
          {ai.message && (
            <p className="text-[12.5px] text-(--color-danger-text)" role="alert" data-testid="studio-ai-message">
              {ai.message}
            </p>
          )}
          {saveError && (
            <p className="text-[12.5px] text-(--color-danger-text)" role="alert" data-testid="studio-save-error">
              {saveError}
            </p>
          )}
          <p className="text-[11.5px] text-faint">{editor.id ? `${E.autosave} ${E.saveHint}` : E.saveHint}</p>
        </div>

        <RemoveButton />
      </div>
    </Card>
  );
}
