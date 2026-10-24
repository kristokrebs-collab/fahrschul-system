/**
 * Placeholders of the two slot panels (`Slots.tsx`). The real panels – pattern discovery and the background optimiser –
 * are built elsewhere and wired in HERE by the main agent (replace the bodies, keep the exports and the props).
 */
import type { StudioPanelProps } from "./types";

function Soon({ title, text, id }: { title: string; text: string; id: string }) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-dashed border-line-2 bg-ink-950/40 p-4" data-testid={id} data-state="soon">
      <h3 className="label !text-mute">{title}</h3>
      <p className="text-[13px] text-mute">Kommt gleich.</p>
      <p className="text-[12px] text-faint">{text}</p>
    </div>
  );
}

export function DiscoveryPanelImpl(_props: StudioPanelProps) {
  void _props;
  return <Soon id="studio-discovery" title="Muster entdecken" text="Hier sucht später ein Werkzeug Muster in den Kerzen, die zu deiner Strategie passen – als Vorschlag, nie als Änderung ohne dein Ja." />;
}

export function EvolvePanelImpl(_props: StudioPanelProps) {
  void _props;
  return <Soon id="studio-evolve" title="Weiterentwickeln" text="Hier probiert später ein Optimierer Varianten deiner Regeln aus und zählt jeden Versuch mit – damit der Mehrfachtest-Hinweis stimmt." />;
}
