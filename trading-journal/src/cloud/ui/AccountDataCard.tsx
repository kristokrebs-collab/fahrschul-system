import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { HoldButton } from "@/motion/HoldButton";
import { HoldConfirm } from "@/motion/HoldConfirm";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Skeleton } from "@/primitives/Skeleton";
import { importBackup } from "@/store/backup";
import { download } from "@/store/download";
import { pushToast } from "@/store/uiStore";
import { ActionButton, GlyphDownload } from "@/views/settings/fx";
import { ApiError, apiFetch, downloadLinkOf, fetchDownload } from "../api";
import { agoLabel } from "../device";
import { ensureCloud } from "../runtime";
import { openAuthSheet, useCloudSession } from "../session";
import { PixelDissolve } from "./PixelDissolve";
import { AUDIT_LABELS, DATA_CARD, DATA_CARD_ID } from "./strings";
import { useTick } from "./SyncStatusCard";

interface BackupItem {
  day: string;
  size: number | null;
}
interface AuditItem {
  id: number;
  action: string;
  at: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "Der Server ist gerade nicht erreichbar.";
}

/** `12. Okt.` style day label of `YYYY-MM-DD`. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(+d) ? day : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * `Deine Daten` card (P09, DSGVO): export of everything stored about the account (`/api/v1/account/export`), the
 * nightly cloud backups with restore (merge through the normal import – snapshot first), the security log, and the
 * account deletion – type `LÖSCHEN`, HOLD to delete; the card dissolves into pixels (`PixelDissolve`), then the
 * session ends. Server errors are shown honestly (e.g. functions not deployed). Lists cascade (`stagger.cards`).
 */
export function AccountDataCard({ className }: { className?: string }) {
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const [dissolving, setDissolving] = useState(false);
  // bumped after an action that writes the audit trail (export) → the log reloads
  const [auditKey, setAuditKey] = useState(0);
  if (!signedIn && !dissolving) return null;
  return (
    <PixelDissolve active={dissolving} onDone={() => setDissolving(false)} className="h-full rounded-2xl">
      <Card title={DATA_CARD.title} className={cn("scroll-mt-24 outline-none", className)} id={DATA_CARD_ID} tabIndex={-1}>
        <p className="mb-4 text-[13px] leading-relaxed text-mute">{DATA_CARD.intro}</p>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="grid content-start gap-6">
            <ExportSection onDone={() => setAuditKey((k) => k + 1)} />
            <BackupsSection />
          </div>
          <div className="grid content-start gap-6">
            <AuditSection reloadKey={auditKey} />
            <DeleteSection onDeleted={() => setDissolving(true)} />
          </div>
        </div>
      </Card>
    </PixelDissolve>
  );
}

function ExportSection({ onDone }: { onDone: () => void }) {
  return (
    <section className="grid gap-2">
      <ActionButton
        className="justify-self-start"
        icon={<GlyphDownload />}
        onRun={async () => {
          try {
            const data = await apiFetch<unknown>("/account/export");
            // a large account comes as a short link to the file in Storage (review DSGVO-02)
            const link = downloadLinkOf(data);
            if (link) {
              const ok = await download(link.name ?? `trade-journal-konto-${new Date().toISOString().slice(0, 10)}.json`, await fetchDownload(link), "application/json");
              onDone();
              return ok;
            }
            if (!isObj(data)) throw new ApiError(0, "unavailable", "Unerwartete Antwort vom Server.");
            const day = typeof data.exportedAt === "string" ? data.exportedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
            const ok = await download(`trade-journal-konto-${day}.json`, JSON.stringify(data, null, 2), "application/json");
            onDone();
            return ok;
          } catch (e) {
            if (e instanceof ApiError && e.code === "mfa_required") openAuthSheet("mfa", "card");
            pushToast({ kind: "error", title: "Export fehlgeschlagen", detail: errorText(e) });
            return false;
          }
        }}
      >
        {DATA_CARD.export}
      </ActionButton>
      <p className="text-[11.5px] text-faint">{DATA_CARD.exportHint}</p>
    </section>
  );
}

function BackupsSection() {
  const reduced = useReducedFx();
  const [items, setItems] = useState<BackupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch<{ items?: BackupItem[] }>("/account/backups")
      .then((r) => {
        if (alive) setItems(Array.isArray(r?.items) ? r.items : []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function restore(day: string) {
    setBusy(true);
    try {
      const data = await apiFetch<unknown>("/account/backups", { query: { day } });
      const link = downloadLinkOf(data);
      const res = await importBackup(link ? await fetchDownload(link) : JSON.stringify(data), { mode: "merge" });
      if (res.ok) pushToast({ kind: "success", title: DATA_CARD.restored, value: dayLabel(day) });
    } catch (e) {
      pushToast({ kind: "error", title: "Wiederherstellen fehlgeschlagen", detail: errorText(e) });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  return (
    <section className="grid gap-2.5" aria-labelledby="data-backups">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="data-backups" className="text-[14px] font-semibold text-fg">
          {DATA_CARD.backupsTitle}
        </h3>
        <span className="text-[11px] text-faint">{DATA_CARD.backupsHint}</span>
      </div>
      {items === null ? (
        <Skeleton height={44} />
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-faint">{error ?? DATA_CARD.backupsEmpty}</p>
      ) : (
        <ul className="grid gap-1.5">
          {items.slice(0, 7).map((b, i) => (
            <motion.li
              key={b.day}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              transition={{ y: { ...spring.enter, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
            >
              <span className="text-[13px] text-fg">
                {dayLabel(b.day)}
                {b.size ? <span className="ml-2 font-mono text-[11px] text-faint">{Math.max(1, Math.round(b.size / 1024))} KB</span> : null}
              </span>
              {ask === b.day ? (
                <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-mute" role="alert">
                  {DATA_CARD.restoreAsk}
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore(b.day)}>
                    Ja
                  </Button>
                  <Button size="sm" onClick={() => setAsk(null)}>
                    Nein
                  </Button>
                </span>
              ) : (
                <HoldConfirm size="sm" variant="secondary" disabled={busy} onAsk={() => setAsk(b.day)} onConfirm={() => void restore(b.day)}>
                  {DATA_CARD.restore}
                </HoldConfirm>
              )}
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditSection({ reloadKey }: { reloadKey: number }) {
  const reduced = useReducedFx();
  const now = useTick(60_000);
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch<{ items?: AuditItem[] }>("/audit", { query: { limit: 8 } })
      .then((r) => alive && setItems(Array.isArray(r?.items) ? r.items : []))
      .catch((e: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  return (
    <section className="grid gap-2.5" aria-labelledby="data-audit">
      <h3 id="data-audit" className="text-[14px] font-semibold text-fg">
        {DATA_CARD.auditTitle}
      </h3>
      {items === null ? (
        <Skeleton height={60} />
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-faint">{error ?? DATA_CARD.auditEmpty}</p>
      ) : (
        <ol className="relative grid gap-2 border-l border-line pl-4">
          {items.map((a, i) => (
            <motion.li
              key={a.id}
              className="relative flex items-baseline justify-between gap-3 text-[12.5px]"
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
              transition={{ x: { ...spring.enter, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
            >
              <span aria-hidden="true" className={cn("absolute -left-[21px] top-1.5 size-2 rounded-full border border-ink-900", a.action.startsWith("account.delete") ? "bg-signal" : "bg-mute")} />
              <span className="min-w-0 truncate text-fg">{AUDIT_LABELS[a.action] ?? a.action}</span>
              <span className="shrink-0 font-mono text-[11px] text-faint">{agoLabel(a.at, now)}</span>
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DeleteSection({ onDeleted }: { onDeleted: () => void }) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; key: number } | null>(null);
  const id = useId();
  const ready = word.trim().toUpperCase() === DATA_CARD.deleteWord;

  async function del() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await apiFetch("/account/delete", { method: "POST", body: { confirm: DATA_CARD.deleteWord } });
      onDeleted();
      const m = await ensureCloud().catch(() => null);
      await m?.signOutScope("local");
      pushToast({ kind: "info", title: DATA_CARD.deleted, detail: DATA_CARD.deletedDetail, duration: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.code === "mfa_required") openAuthSheet("mfa", "card");
      setErr({ message: errorText(e), key: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-signal/25 bg-signal/[0.04] p-4" aria-labelledby="data-delete">
      <h3 id="data-delete" className="text-[14px] font-semibold text-(--color-danger-text)">
        {DATA_CARD.deleteTitle}
      </h3>
      <p className="text-[12.5px] leading-relaxed text-mute">{DATA_CARD.deleteText}</p>
      <Field label={DATA_CARD.deleteType(DATA_CARD.deleteWord)} htmlFor={`${id}-word`} error={err?.message} invalidKey={err?.key ?? null}>
        <Input id={`${id}-word`} value={word} autoComplete="off" spellCheck={false} onChange={(e) => setWord(e.target.value)} className="font-mono uppercase tracking-[0.2em]" />
      </Field>
      <AnimatePresence initial={false}>
        {ready && (
          <motion.div key="hold" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }} exit={{ opacity: 0, transition: tween.exit }} transition={{ y: spring.pop, opacity: tween.fade }}>
            <HoldButton variant="danger" onConfirm={() => void del()} disabled={busy} armedLabel={DATA_CARD.deleteArmed}>
              {DATA_CARD.deleteHold}
            </HoldButton>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
