/**
 * The origin of an idea handed over by "Diese Idee testen" (F12): what became a rule, what did NOT (with the reason) and which
 * approximations the translation chose. Memory only; the set-up below is already filled – the trader checks it and starts.
 */
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useLabor } from "./laborStore";

export const IDEA = {
  title: "Idee aus dem Journal",
  lead: "Das ist ein Entwurf: gespeichert und gestartet ist nichts. Prüfe die Regeln im Versuchsaufbau, ändere sie frei und starte dann den Test. Getestet wird die Regel über die ganze Historie, nicht der Moment, aus dem sie stammt.",
  mapped: "Übernommen",
  gaps: "Nicht abgebildet",
  gapsNone: "Nichts – alles aus der Quelle ist eine Regel geworden.",
  notes: "Näherungen und Standardwerte",
  back: "Vorheriges Setup zurück",
  hide: "Ausblenden",
} as const;

function List({ title, items, testId, empty }: { title: string; items: readonly { key: string; head: string; why?: string }[]; testId: string; empty?: string }) {
  return (
    <section className="grid min-w-0 content-start gap-2" data-testid={testId}>
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{title}</h3>
      {items.length ? (
        <ul className="grid gap-1.5">
          {items.map((it, i) => (
            <li key={`${i}-${it.key}`} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg/85">
              <span aria-hidden="true" className="mt-[8px] size-1 shrink-0 rounded-full bg-signal" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {it.head}
                {it.why && <span className="block text-[11.5px] text-mute">{it.why}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-mute">{empty}</p>
      )}
    </section>
  );
}

export function IdeaCard({ className }: { className?: string }) {
  const idea = useLabor((s) => s.idea);
  const restore = useLabor((s) => s.restoreBeforeIdea);
  const dismiss = useLabor((s) => s.dismissIdea);
  if (!idea) return null;
  const d = idea.draft;
  return (
    <Card
      title={IDEA.title}
      note={d.origin}
      className={className}
      data-testid="labor-idea"
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={restore} data-testid="labor-idea-back">
            {IDEA.back}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} data-testid="labor-idea-hide">
            {IDEA.hide}
          </Button>
        </div>
      }
    >
      <p className="mb-4 max-w-[72ch] text-[12.5px] leading-relaxed text-mute">{IDEA.lead}</p>
      <div className="grid gap-5 lg:grid-cols-3">
        <List title={IDEA.mapped} items={d.mapped.map((m) => ({ key: m, head: m }))} testId="labor-idea-mapped" />
        <List title={IDEA.gaps} items={d.gaps.map((g) => ({ key: g.what, head: g.what, why: g.why }))} testId="labor-idea-gaps" empty={IDEA.gapsNone} />
        <List title={IDEA.notes} items={d.notes.map((n) => ({ key: n, head: n }))} testId="labor-idea-notes" empty="Keine." />
      </div>
    </Card>
  );
}
