/**
 * The bodies of the two slots (`Slots.tsx`). Both say "Kommt gleich" and what the section will hold – nothing is computed,
 * nothing is promised beyond that. The owners of the real sections replace the function bodies here.
 */
import { Card } from "@/primitives/Card";
import type { AktienSlotProps } from "./types";

function Soon({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <Card title={title} className="h-full" data-testid={id}>
      <div className="grid gap-2" data-state="soon">
        <p className="text-[13px] font-medium text-fg">Kommt gleich</p>
        <p className="max-w-[64ch] text-[12.5px] leading-relaxed text-mute">{text}</p>
      </div>
    </Card>
  );
}

export function AnalystSlotImpl(_props: AktienSlotProps) {
  return <Soon id="aktien-analyse" title="Zahlen, Bewertung und Kaufthese" text="Quartalszahlen mit dem Termin, eine Bewertung aus offen gelegten Annahmen (DCF) und deine eigene Kaufthese mit Widerlegungsbedingungen – jeweils mit Quelle und Stand." />;
}

export function CongressSlotImpl(_props: AktienSlotProps) {
  return <Soon id="aktien-kongress" title="Kongress-Tracker" text="Meldungen von Kongressmitgliedern zu Aktien, die du beobachtest – mit Meldedatum und dem Hinweis, dass die Angaben Wochen zu spät kommen können." />;
}
