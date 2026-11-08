import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import "../src/styles/themes.css";
import { MotionRoot } from "@/motion/MotionRoot";
import type { RingMood } from "@/motion/ringMath";
import { RadialShare } from "@/motion/RadialShare";
import { ThinkingOrb } from "@/motion/ThinkingOrb";
import { Glyph } from "@/social/ui/glyphs";

/*
 * Dev harness of the Runde-12 voice ring: `/dev/ring.html` under `npm run dev` (`?theme=light`, `?size=64`). The three moods side by side
 * (aktiv · denkt nach · ruhig-mono) at the size you ask for, the dot orbs of R11 for comparison, and a button that cycles ONE ring through
 * the moods so the ease between them can be watched. `?static=1` renders the still symbols (the reduced-motion picture). At the foot the
 * share fan (`RadialShare`, glass chips + caption): click „Teilen“.
 */
const params = new URLSearchParams(location.search);
if (params.get("theme") === "light") document.documentElement.dataset.theme = "light";
const size = Number(params.get("size") ?? 64) || 64;
const still = params.get("static") === "1";

const MOODS: { mood: RingMood; word: string; hint: string }[] = [
  { mood: "active", word: "aktiv", hint: "Antwort wird gebildet · Szenarien werden berechnet" },
  { mood: "think", word: "denkt nach", hint: "kurzes Warten auf einen Dienst" },
  { mood: "quiet", word: "ruhig (mono)", hint: "bewegt sich einen Moment, dann Ruhe" },
];

function Harness() {
  const [mood, setMood] = useState<RingMood>("active");
  const next: RingMood = mood === "active" ? "think" : mood === "think" ? "quiet" : "active";
  return (
    <MotionRoot>
      <main className="mx-auto grid max-w-3xl gap-8 p-8 text-fg">
        <h1 className="font-mono text-sm uppercase tracking-[0.16em] text-mute">Voice Ring – drei Zustände</h1>
        <section className="grid grid-cols-3 gap-6" data-testid="ring-moods">
          {MOODS.map((m) => (
            <div key={m.mood} className="grid justify-items-center gap-3 rounded-2xl border border-line bg-ink-900 p-6 text-center">
              <ThinkingOrb variant="ring" mood={m.mood} size={size} active={!still} />
              <span className="text-[13px] font-medium">{m.word}</span>
              <span className="text-[11.5px] leading-snug text-mute">{m.hint}</span>
            </div>
          ))}
        </section>
        <section className="grid justify-items-start gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Ein Ring, Zustand wechselt (weich)</h2>
          <div className="flex items-center gap-4">
            <ThinkingOrb variant="ring" mood={mood} size={size} />
            <button type="button" className="rounded-full border border-line-2 px-4 py-2 text-[13px]" onClick={() => setMood(next)} data-testid="ring-cycle">
              {mood} → {next}
            </button>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Neben einer Zeile (so, wie er eingebaut ist)</h2>
          <p className="flex items-center gap-2 text-[14px]">
            <ThinkingOrb variant="ring" mood="think" size={20} className="text-mute" />
            <span className="text-mute">Denke nach …</span>
          </p>
          <p className="flex items-center gap-3 rounded-xl border border-line bg-ink-950/50 p-3.5 text-[12.5px]">
            <ThinkingOrb variant="ring" mood="active" size={28} />
            <span>10.000 Szenarien werden berechnet · Sitzungen simulieren</span>
          </p>
        </section>
        <section className="flex items-center gap-4" data-testid="ring-share">
          <span className="text-[11.5px] text-faint">Weitergeben</span>
          <RadialShare
            label="Teilen"
            icon={<Glyph name="share" className="size-4" />}
            testId="demo-share"
            targets={[
              { id: "copy", label: "Kopieren", detail: "Kurzfassung ohne Geldbeträge kopieren", icon: <Glyph name="copy" className="size-5" />, onSelect: () => undefined },
              { id: "image", label: "Bild", detail: "Teilen-Bild speichern (nur R und %)", icon: <Glyph name="image" className="size-5" />, onSelect: () => undefined },
              { id: "link", label: "Link", detail: "Teilen-Blatt mit Link öffnen", icon: <Glyph name="link" className="size-5" />, onSelect: () => undefined },
              { id: "native", label: "Weitergeben", detail: "Mit einer App teilen", icon: <Glyph name="send" className="size-5" />, onSelect: () => undefined },
            ]}
          />
        </section>
        <section className="flex items-center gap-6">
          <ThinkingOrb variant="search" size={40} />
          <ThinkingOrb variant="calc" size={40} />
          <ThinkingOrb variant="plan" size={40} />
        </section>
      </main>
    </MotionRoot>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
