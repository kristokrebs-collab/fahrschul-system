/**
 * Playbook exchange (F13 / F45): export a draft as a versioned JSON text (file or clipboard), import one with the strict reader
 * (`@/domain/playbook`) – errors with their reasons, a preview before anything is created, the imported draft stays marked
 * "fremd", and a "Probe im Labor" tests it on the market's own history. No server, nothing is uploaded.
 */
import { useId, useMemo, useRef, useState } from "react";
import { CUSTOM_TEMPLATES, summarizeCustom, type CustomConfig } from "@/domain/lab";
import { MAX_AUTHOR, MAX_DESCRIPTION, MAX_PLAYBOOK_BYTES, MAX_TITLE, playbookFileName, playbookText, readPlaybook, type Playbook } from "@/domain/playbook";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input, Textarea } from "@/primitives/Input";
import { download } from "@/store/download";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { DRAFTS } from "./draftStrings";
import { DRAFTS_MAX, useLabor } from "./laborStore";
import { FieldRow } from "./ui";
import { addPlaybookDraft, probeInLab } from "./versionActions";

const P = DRAFTS.playbook;
const AUTHOR_KEY = storageKey("labor-playbook-author");

type Checked = { ok: true; playbook: Playbook; warnings: string[] } | { ok: false; errors: string[] } | null;

interface Choice {
  value: string;
  label: string;
  config: CustomConfig;
}

export function PlaybookCard({ className }: { className?: string }) {
  const uid = useId();
  const lab = useLabor((s) => s.cfg);
  const drafts = useLabor((s) => s.drafts);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── export ─────────────────────────────────────────────────────────────────────────
  const [pick, setPick] = useState("editor");
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState<string>(() => {
    const v = readJson<unknown>(AUTHOR_KEY, "");
    return typeof v === "string" ? v.slice(0, MAX_AUTHOR) : "";
  });
  const [withMarket, setWithMarket] = useState(false);
  const choices = useMemo<Choice[]>(
    () => [
      { value: "editor", label: P.editor(lab.custom.name), config: lab.custom },
      ...drafts.map((d) => ({ value: `d:${d.id}`, label: d.name, config: d.config })),
      ...CUSTOM_TEMPLATES.map((t) => ({ value: `t:${t.id}`, label: t.title, config: t.build() })),
    ],
    [lab.custom, drafts],
  );
  const choice = choices.find((c) => c.value === pick) ?? choices[0]!;
  const titleV = title ?? choice.config.name;
  const text = useMemo(() => playbookText(choice.config, { title: titleV, description, author, symbol: withMarket ? lab.symbol : undefined }), [choice.config, titleV, description, author, withMarket, lab.symbol]);

  const rememberAuthor = (v: string): void => {
    setAuthor(v);
    writeJson(AUTHOR_KEY, v.slice(0, MAX_AUTHOR));
  };
  const saveFile = async (): Promise<void> => {
    if (await download(playbookFileName(titleV), text, "application/json")) pushToast({ kind: "success", title: P.exported });
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ kind: "success", title: P.copied });
    } catch {
      pushToast({ kind: "error", title: P.copyFailed });
    }
  };

  // ── import ─────────────────────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState<Checked>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const full = drafts.length >= DRAFTS_MAX;

  const check = (t: string): void => {
    setFileError(null);
    setCreatedId(null);
    setChecked(readPlaybook(t));
  };
  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    setCreatedId(null);
    if (f.size > MAX_PLAYBOOK_BYTES) {
      setChecked(null);
      setFileError(P.fileTooBig(Math.round(MAX_PLAYBOOK_BYTES / 1000)));
      return;
    }
    try {
      const t = await f.text();
      setInput(t);
      check(t);
    } catch {
      setChecked(null);
      setFileError(P.fileFailed);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const create = (pb: Playbook): void => {
    const id = addPlaybookDraft(pb);
    if (id == null) pushToast({ kind: "error", title: P.full });
    else {
      setCreatedId(id);
      pushToast({ kind: "success", title: P.created, detail: P.createdDetail });
    }
  };
  const probe = async (pb: Playbook): Promise<void> => {
    pushToast({ kind: "success", title: P.probeStarted, detail: P.probeStartedDetail });
    document.querySelector('[data-testid="labor-run"]')?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    await probeInLab(pb.config, pb.symbol);
  };

  return (
    <Card title={P.title} note={P.lead} className={className} data-testid="labor-playbook">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid min-w-0 content-start gap-3" aria-labelledby={`${uid}-ex`} data-testid="playbook-export">
          <h3 id={`${uid}-ex`} className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">
            {P.exportTitle}
          </h3>
          <FieldRow label={P.exportOf} htmlFor={`${uid}-pick`}>
            <MorphSelect id={`${uid}-pick`} value={choice.value} onChange={(v) => { setPick(v); setTitle(null); }} options={choices.map((c) => ({ value: c.value, label: c.label }))} wrap data-testid="playbook-pick" />
          </FieldRow>
          <FieldRow label={P.titleField} htmlFor={`${uid}-title`}>
            <Input id={`${uid}-title`} value={titleV} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} autoComplete="off" spellCheck={false} data-testid="playbook-title" />
          </FieldRow>
          <FieldRow label={P.description} htmlFor={`${uid}-desc`}>
            <Textarea id={`${uid}-desc`} value={description} maxLength={MAX_DESCRIPTION} rows={3} onChange={(e) => setDescription(e.target.value)} data-testid="playbook-description" />
          </FieldRow>
          <FieldRow label={P.author} htmlFor={`${uid}-author`} hint={P.authorHint}>
            <Input id={`${uid}-author`} value={author} maxLength={MAX_AUTHOR} onChange={(e) => rememberAuthor(e.target.value)} autoComplete="off" spellCheck={false} data-testid="playbook-author" />
          </FieldRow>
          <label className="flex min-h-9 items-center gap-2 text-[12.5px] text-mute pointer-coarse:min-h-11">
            <input type="checkbox" checked={withMarket} onChange={(e) => setWithMarket(e.target.checked)} className="size-4 accent-current" data-testid="playbook-market" />
            {P.withMarket(lab.symbol)}
          </label>
          <FieldRow label={P.preview} htmlFor={`${uid}-text`}>
            <Textarea id={`${uid}-text`} value={text} readOnly rows={8} className="font-mono text-[11.5px]" spellCheck={false} data-testid="playbook-text" />
          </FieldRow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void saveFile()} data-testid="playbook-save">
              {P.save}
            </Button>
            <Button size="sm" onClick={() => void copy()} data-testid="playbook-copy">
              {P.copy}
            </Button>
          </div>
        </section>

        <section className="grid min-w-0 content-start gap-3" aria-labelledby={`${uid}-im`} data-testid="playbook-import">
          <h3 id={`${uid}-im`} className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">
            {P.importTitle}
          </h3>
          <p className="text-[12.5px] leading-relaxed text-mute">{P.importLead}</p>
          <FieldRow label={P.paste} htmlFor={`${uid}-in`}>
            <Textarea id={`${uid}-in`} value={input} rows={6} placeholder={P.pastePlaceholder} onChange={(e) => { setInput(e.target.value); setChecked(null); setCreatedId(null); }} className="font-mono text-[11.5px]" spellCheck={false} data-testid="playbook-input" />
          </FieldRow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={!input.trim()} onClick={() => check(input)} data-testid="playbook-check">
              {P.check}
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()} data-testid="playbook-file-btn">
              {P.file}
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json,text/plain" className="sr-only" tabIndex={-1} aria-label={P.file} onChange={(e) => void onFile(e.target.files?.[0])} data-testid="playbook-file" />
            {(input || checked || fileError) && (
              <Button size="sm" variant="ghost" onClick={() => { setInput(""); setChecked(null); setFileError(null); setCreatedId(null); }}>
                {P.clear}
              </Button>
            )}
          </div>
          {fileError && (
            <p className="text-[12.5px] text-(--color-danger-text)" role="alert" data-testid="playbook-file-error">
              {fileError}
            </p>
          )}
          {checked && !checked.ok && (
            <div className="grid gap-1.5 rounded-xl border border-loss/30 bg-loss/8 p-3" role="alert" data-testid="playbook-errors">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-loss">{P.errors}</span>
              <ul className="grid gap-1 text-[12.5px] leading-relaxed">
                {checked.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {checked?.ok && (
            <div className="grid gap-3 rounded-xl border border-line bg-ink-950/50 p-3" data-testid="playbook-preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.previewTitle}</span>
                <Badge tone="warn">{P.foreignBadge}</Badge>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[14px] font-semibold [overflow-wrap:anywhere]" data-testid="playbook-preview-title">
                  {checked.playbook.title}
                </span>
                <span className="text-[11.5px] text-faint">{checked.playbook.author ? P.byAuthor(checked.playbook.author) : P.noAuthor}</span>
              </div>
              {checked.playbook.description && <p className="text-[12.5px] leading-relaxed text-mute [overflow-wrap:anywhere]">{checked.playbook.description}</p>}
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.rules}</span>
                <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/85" data-testid="playbook-preview-rules">
                  {summarizeCustom(checked.playbook.config).map((l) => (
                    <li key={l} className="[overflow-wrap:anywhere]">{l}</li>
                  ))}
                </ul>
              </div>
              <p className="text-[12px] text-faint">{checked.playbook.symbol ? P.market(checked.playbook.symbol) : P.noMarket}</p>
              {checked.warnings.length > 0 && (
                <div className="grid gap-1" data-testid="playbook-warnings">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-warn">{P.warnings}</span>
                  <ul className="grid gap-1 text-[12px] leading-relaxed text-warn">
                    {checked.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[12px] leading-relaxed text-mute">{P.foreignNote}</p>
              {full && !createdId && <p className="text-[12px] text-warn">{P.full}</p>}
              <div className="flex flex-wrap gap-2">
                {!createdId ? (
                  <Button size="sm" variant="primary" disabled={full} onClick={() => create(checked.playbook)} data-testid="playbook-create">
                    {P.create}
                  </Button>
                ) : (
                  <>
                    <Badge tone="teal" dot>
                      {P.created}
                    </Badge>
                    <Button size="sm" variant="primary" onClick={() => void probe(checked.playbook)} data-testid="playbook-probe">
                      {P.probe}
                    </Button>
                  </>
                )}
              </div>
              {createdId && (
                <p className="text-[11.5px] leading-relaxed text-faint">
                  {P.probeNote} {P.forward}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
