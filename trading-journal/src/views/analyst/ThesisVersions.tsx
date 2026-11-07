/**
 * Versions of a thesis: an immutable snapshot of text, scenarios, conditions and prices, saved by the person with a note, and for
 * each version the plain list of what changed against the one before (and the DCF value per scenario before → after), so a changed
 * target value can be traced to its assumptions. Nothing is saved without a click.
 */
import { useId, useState } from "react";
import { diffSnapshots, snapshotOfThesis, type Thesis, type ThesisVersion } from "@/domain/thesis";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Disclosure, Sub } from "./parts";
import { TH } from "./strings";

interface Props {
  t: Thesis;
  onSave: (note: string) => "saved" | "same";
}

function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function VersionRow({ v, prev }: { v: ThesisVersion; prev: ThesisVersion | null }) {
  const lines = prev ? diffSnapshots(prev.snapshot, v.snapshot) : [];
  return (
    <li className="grid gap-1.5 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="thesis-version" data-n={v.n}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[13px] font-semibold">Version {v.n}</p>
        <p className="num font-mono text-[11.5px] text-mute">{dateTime(v.at)}</p>
      </div>
      {v.note && <p className="text-[12.5px] leading-snug">{v.note}</p>}
      {v.check && (
        <p className="text-[12px] text-mute" data-testid="thesis-version-check">
          Prüfung dabei: {v.check.triggered} von {v.check.total} Bedingungen ausgelöst{v.check.quarterEnd ? ` (Quartal bis ${v.check.quarterEnd.split("-").reverse().join(".")})` : ""}.
        </p>
      )}
      {prev ? (
        lines.length > 0 ? (
          <ul className="grid list-disc gap-0.5 pl-4 text-[12px] leading-snug text-mute" data-testid="thesis-version-diff">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-mute">Gegenüber der Version davor unverändert.</p>
        )
      ) : (
        <p className="text-[12px] text-mute">Erste gespeicherte Fassung.</p>
      )}
    </li>
  );
}

export function ThesisVersions({ t, onSave }: Props) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const changed = (() => {
    const last = t.versions[t.versions.length - 1];
    return !last || diffSnapshots(last.snapshot, snapshotOfThesis(t)).length > 0;
  })();
  const newestFirst = [...t.versions].reverse();
  return (
    <section className="grid gap-3" aria-label={TH.versionsTitle} data-section="thesis-versions" data-testid="thesis-versions">
      <Sub>{TH.versionsTitle}</Sub>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={TH.versionNote} htmlFor={noteId} className="min-w-0 flex-1 basis-60">
          <Input id={noteId} value={note} maxLength={280} data-testid="thesis-version-note" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const r = onSave(note);
            setMsg(r === "saved" ? TH.versionSaved : TH.versionSame);
            if (r === "saved") setNote("");
          }}
          data-testid="thesis-version-save"
        >
          {TH.saveVersion}
        </Button>
      </div>
      {msg && (
        <p className="text-[12px] text-mute" role="status" data-testid="thesis-version-msg">
          {msg}
        </p>
      )}
      {!changed && !msg && t.versions.length > 0 && <p className="text-[12px] text-mute">Seit der letzten Version hat sich nichts geändert.</p>}
      {t.versions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-2 p-3.5 text-[12.5px] text-mute" data-testid="thesis-no-versions">
          {TH.noVersions}
        </p>
      ) : (
        <Disclosure title="Gespeicherte Versionen" count={t.versions.length} defaultOpen testId="thesis-version-list">
          <ul className="grid gap-2">
            {newestFirst.map((v, i) => (
              <VersionRow key={v.id} v={v} prev={newestFirst[i + 1] ?? null} />
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
