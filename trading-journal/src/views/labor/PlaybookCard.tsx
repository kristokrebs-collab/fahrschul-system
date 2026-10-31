/**
 * Playbook exchange (F13 / F45): export a draft as a versioned JSON text (file or clipboard), import one with the strict reader
 * (`@/domain/playbook`) – errors with their reasons, a preview before anything is created, the imported draft stays marked
 * "fremd", and a "Probe im Labor" tests it on the market's own history. No server, nothing is uploaded.
 *
 * F45: a draft of your own that is exported gets a stable id and a revision number; the same playbook read in again with a higher
 * number is shown as a NEWER FASSUNG of the draft you have – with what changed in plain language – and only your click takes it over
 * (as a new version of that draft). A checklist of manual pre-trade checks travels with the file and can become the checklist of a
 * journal setup. There is no subscription: an update is a new file you read in yourself.
 */
import { useId, useMemo, useRef, useState } from "react";
import { CUSTOM_TEMPLATES, customKey, summarizeCustom, type CustomConfig } from "@/domain/lab";
import { cleanChecklist, MAX_AUTHOR, MAX_CHANGES, MAX_CHECK_ITEM, MAX_CHECKLIST, MAX_DESCRIPTION, MAX_PLAYBOOK_BYTES, MAX_TITLE, newPlaybookId, nextRevision, playbookFileName, playbookText, readPlaybook, type Playbook } from "@/domain/playbook";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input, Textarea } from "@/primitives/Input";
import { download } from "@/store/download";
import { useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { DRAFTS } from "./draftStrings";
import { DRAFTS_MAX, useLabor } from "./laborStore";
import { FieldRow } from "./ui";
import { addPlaybookDraft, addPlaybookSetup, applyPlaybookUpdate, findPlaybookDraft, probeInLab, relationOf } from "./versionActions";

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
  const setups = useJournal((s) => s.settings.setups);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── export ─────────────────────────────────────────────────────────────────────────
  const [pick, setPick] = useState("editor");
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [changes, setChanges] = useState("");
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

  // the revision of an own draft: its stable id and the next number (the id is made once per draft, remembered when the file is saved or copied)
  const pickedDraft = pick.startsWith("d:") ? (drafts.find((d) => `d:${d.id}` === pick) ?? null) : null;
  const ownDraft = pickedDraft && !pickedDraft.origin ? pickedDraft : null;
  const freshIds = useRef<Record<string, string>>({});
  const rules = customKey(choice.config);
  const revision = useMemo(() => {
    if (!ownDraft) return null;
    const id = ownDraft.exported?.id ?? (freshIds.current[ownDraft.id] ??= newPlaybookId(Math.random));
    return { id, rev: nextRevision(ownDraft.exported, rules), key: rules };
  }, [ownDraft, rules]);
  const checklist = useMemo(() => cleanChecklist(checklistText.split("\n")), [checklistText]);
  const text = useMemo(
    () => playbookText(choice.config, { title: titleV, description, author, symbol: withMarket ? lab.symbol : undefined, checklist, ...(revision ? { id: revision.id, rev: revision.rev, changes } : {}) }),
    [choice.config, titleV, description, author, withMarket, lab.symbol, checklist, revision, changes],
  );
  const setupOptions = useMemo(() => [{ value: "", label: P.checklistNone }, ...setups.filter((s) => s.checklist.length > 0).map((s) => ({ value: s.id, label: s.name }))], [setups]);

  const rememberAuthor = (v: string): void => {
    setAuthor(v);
    writeJson(AUTHOR_KEY, v.slice(0, MAX_AUTHOR));
  };
  /** the file leaves the app: from now on this id and revision are the draft's last export */
  const markExported = (): void => {
    if (ownDraft && revision) useLabor.getState().markExported(ownDraft.id, { id: revision.id, rev: revision.rev, key: revision.key });
  };
  const saveFile = async (): Promise<void> => {
    if (await download(playbookFileName(titleV), text, "application/json")) {
      markExported();
      pushToast({ kind: "success", title: P.exported });
    }
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      markExported();
      pushToast({ kind: "success", title: P.copied });
    } catch {
      pushToast({ kind: "error", title: P.copyFailed });
    }
  };
  const revLine = !pickedDraft
    ? P.rev.none
    : pickedDraft.origin
      ? P.rev.foreign
      : !pickedDraft.exported
        ? P.rev.first
        : pickedDraft.exported.key === rules
          ? P.rev.same(pickedDraft.exported.rev)
          : P.rev.next(pickedDraft.exported.rev, pickedDraft.exported.rev + 1);

  // ── import ─────────────────────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState<Checked>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [appliedRev, setAppliedRev] = useState<number | null>(null);
  const full = drafts.length >= DRAFTS_MAX;

  const reset = (): void => {
    setCreatedId(null);
    setAppliedRev(null);
  };
  const check = (t: string): void => {
    setFileError(null);
    reset();
    setChecked(readPlaybook(t));
  };
  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    reset();
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
  const apply = (pb: Playbook, draftId: string): void => {
    if (applyPlaybookUpdate(draftId, pb)) {
      setAppliedRev(pb.rev);
      pushToast({ kind: "success", title: P.update.applied(pb.rev ?? 0), detail: P.update.appliedDetail });
    }
  };
  const toJournal = async (pb: Playbook): Promise<void> => {
    const name = await addPlaybookSetup(pb);
    if (name) pushToast({ kind: "success", title: P.journaled(name), detail: P.journaledDetail });
    else pushToast({ kind: "error", title: P.journalFailed });
  };

  const pbOk = checked?.ok ? checked.playbook : null;
  // the draft this file is a revision of (same playbook id), and how the file relates to it
  const sibling = pbOk ? findPlaybookDraft(pbOk) : null;
  const rel = pbOk ? relationOf(pbOk, sibling) : null;

  return (
    <Card title={P.title} note={P.lead} className={className} data-testid="labor-playbook">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid min-w-0 content-start gap-3" aria-labelledby={`${uid}-ex`} data-testid="playbook-export">
          <h3 id={`${uid}-ex`} className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">
            {P.exportTitle}
          </h3>
          <FieldRow label={P.exportOf} htmlFor={`${uid}-pick`}>
            <MorphSelect id={`${uid}-pick`} value={choice.value} onChange={(v) => { setPick(v); setTitle(null); setChanges(""); }} options={choices.map((c) => ({ value: c.value, label: c.label }))} wrap data-testid="playbook-pick" />
          </FieldRow>
          <FieldRow label={P.titleField} htmlFor={`${uid}-title`}>
            <Input id={`${uid}-title`} value={titleV} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} autoComplete="off" spellCheck={false} data-testid="playbook-title" />
          </FieldRow>
          <FieldRow label={P.description} htmlFor={`${uid}-desc`}>
            <Textarea id={`${uid}-desc`} value={description} maxLength={MAX_DESCRIPTION} rows={3} onChange={(e) => setDescription(e.target.value)} data-testid="playbook-description" />
          </FieldRow>
          <FieldRow label={P.checklist} htmlFor={`${uid}-check`} hint={P.checklistHint(MAX_CHECKLIST, MAX_CHECK_ITEM)}>
            <Textarea id={`${uid}-check`} value={checklistText} rows={3} onChange={(e) => setChecklistText(e.target.value)} data-testid="playbook-checklist" />
          </FieldRow>
          {setupOptions.length > 1 && (
            <FieldRow label={P.checklistFrom} htmlFor={`${uid}-from`}>
              <MorphSelect
                id={`${uid}-from`}
                value=""
                onChange={(v) => {
                  const s = setups.find((x) => x.id === v);
                  if (s) setChecklistText(s.checklist.map((c) => c.text).join("\n"));
                }}
                options={setupOptions}
                wrap
                data-testid="playbook-checklist-from"
              />
            </FieldRow>
          )}
          <FieldRow label={P.author} htmlFor={`${uid}-author`} hint={P.authorHint}>
            <Input id={`${uid}-author`} value={author} maxLength={MAX_AUTHOR} onChange={(e) => rememberAuthor(e.target.value)} autoComplete="off" spellCheck={false} data-testid="playbook-author" />
          </FieldRow>
          {revision && (
            <FieldRow label={P.changes} htmlFor={`${uid}-changes`} hint={P.changesHint}>
              <Input id={`${uid}-changes`} value={changes} maxLength={MAX_CHANGES} onChange={(e) => setChanges(e.target.value)} autoComplete="off" data-testid="playbook-changes" />
            </FieldRow>
          )}
          <p className="text-[12px] leading-snug text-mute" data-testid="playbook-rev">
            {revLine}
          </p>
          <label className="flex min-h-9 items-center gap-2 text-[12.5px] text-mute pointer-coarse:-mx-3 pointer-coarse:min-h-11 pointer-coarse:px-3">
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
            <Textarea id={`${uid}-in`} value={input} rows={6} placeholder={P.pastePlaceholder} onChange={(e) => { setInput(e.target.value); setChecked(null); reset(); }} className="font-mono text-[11.5px]" spellCheck={false} data-testid="playbook-input" />
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
              <Button size="sm" variant="secondary" onClick={() => { setInput(""); setChecked(null); setFileError(null); reset(); }}>
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
                <span className="flex flex-wrap gap-1.5">
                  {checked.playbook.rev != null && <Badge tone="mute">{P.revBadge(checked.playbook.rev)}</Badge>}
                  <Badge tone="warn">{P.foreignBadge}</Badge>
                </span>
              </div>
              <div className="grid gap-0.5">
                <span className="text-[14px] font-semibold [overflow-wrap:anywhere]" data-testid="playbook-preview-title">
                  {checked.playbook.title}
                </span>
                <span className="text-[11.5px] text-faint">{checked.playbook.author ? P.byAuthor(checked.playbook.author) : P.noAuthor}</span>
              </div>
              {checked.playbook.description && <p className="text-[12.5px] leading-relaxed text-mute [overflow-wrap:anywhere]">{checked.playbook.description}</p>}
              {checked.playbook.changes && (
                <p className="text-[12.5px] leading-relaxed text-fg/90 [overflow-wrap:anywhere]" data-testid="playbook-preview-changes">
                  {P.changesOf(checked.playbook.changes)}
                </p>
              )}
              <div className="grid gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.rules}</span>
                <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/85" data-testid="playbook-preview-rules">
                  {summarizeCustom(checked.playbook.config).map((l) => (
                    <li key={l} className="[overflow-wrap:anywhere]">{l}</li>
                  ))}
                </ul>
              </div>
              {checked.playbook.checklist.length > 0 && (
                <div className="grid gap-1" data-testid="playbook-preview-checklist">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.checklistTitle(checked.playbook.checklist.length)}</span>
                  <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/85">
                    {checked.playbook.checklist.map((c) => (
                      <li key={c} className="flex gap-2 [overflow-wrap:anywhere]">
                        <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-sm border border-faint-line" />
                        {c}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11.5px] leading-snug text-faint">{P.checklistNote}</p>
                </div>
              )}
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

              {sibling && rel && (rel.kind === "newer" || rel.kind === "same" || rel.kind === "same-rev-changed" || rel.kind === "older") && (
                <div className="grid gap-2 rounded-xl border border-line-2 bg-white/[0.03] p-3" data-testid="playbook-update" data-relation={rel.kind}>
                  <p className="text-[13px] font-medium leading-snug">
                    {rel.kind === "newer" ? P.update.newer(sibling.name, rel.from, rel.to) : rel.kind === "same" ? P.update.same(sibling.name, rel.rev) : rel.kind === "same-rev-changed" ? P.update.sameRevChanged(sibling.name, rel.rev) : P.update.older(sibling.name, rel.from, rel.to)}
                  </p>
                  {rel.kind !== "same" && (
                    <div className="grid gap-1">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{P.update.diffTitle}</span>
                      {rel.diff.length ? (
                        <ul className="grid gap-1 text-[12.5px] leading-relaxed" data-testid="playbook-update-diff">
                          {rel.diff.map((d) => (
                            <li key={d} className="[overflow-wrap:anywhere]">{d}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12.5px] text-mute">{P.update.noDiff}</p>
                      )}
                    </div>
                  )}
                  {rel.kind !== "same" && rel.localEdits && (
                    <p className="text-[12px] leading-snug text-warn" role="status" data-testid="playbook-update-local">
                      {P.update.local}
                    </p>
                  )}
                  <p className="text-[11.5px] leading-snug text-faint">{P.update.note}</p>
                  {appliedRev != null ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="teal" dot>
                        {P.update.applied(appliedRev)}
                      </Badge>
                      <Button size="sm" variant="primary" onClick={() => void probe(checked.playbook)} data-testid="playbook-probe">
                        {P.probe}
                      </Button>
                    </div>
                  ) : (
                    (rel.kind === "newer" || rel.kind === "same-rev-changed") && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="primary" onClick={() => apply(checked.playbook, sibling.id)} data-testid="playbook-update-apply">
                          {P.update.apply(sibling.name)}
                        </Button>
                      </div>
                    )
                  )}
                </div>
              )}

              <p className="text-[12px] leading-relaxed text-mute">{P.foreignNote}</p>
              {full && !createdId && <p className="text-[12px] text-warn">{P.full}</p>}
              <div className="flex flex-wrap gap-2">
                {!createdId ? (
                  appliedRev == null && (
                    <Button size="sm" variant={sibling && rel && rel.kind !== "none" && rel.kind !== "other" ? "secondary" : "primary"} disabled={full} onClick={() => create(checked.playbook)} data-testid="playbook-create">
                      {sibling && rel && rel.kind !== "none" && rel.kind !== "other" ? P.update.separate : P.create}
                    </Button>
                  )
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
                <Button size="sm" onClick={() => void toJournal(checked.playbook)} data-testid="playbook-journal">
                  {P.toJournal}
                </Button>
              </div>
              <p className="text-[11.5px] leading-relaxed text-faint">{P.toJournalNote}</p>
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
