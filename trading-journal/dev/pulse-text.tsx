/**
 * Dev-only gallery for the pulse text primitives (120 Hz checks, visual review). Not part of the app bundle:
 * open http://localhost:<port>/dev/pulse-text.html with the Vite dev server.
 */
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { MotionRoot } from "@/motion/MotionRoot";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { DancingLetters, DancingSvgWord } from "@/motion/pulse/DancingLetters";
import { PixelTextFill } from "@/motion/pulse/PixelTextFill";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { TextMorph } from "@/motion/pulse/TextMorph";
import { TextPrism } from "@/motion/pulse/TextPrism";
import { Typewriter } from "@/motion/pulse/Typewriter";

/** `?only=<id>` renders a single section, so a 120 Hz measurement sees only the effect under test. */
const ONLY = new URLSearchParams(location.search).get("only");

function Section({ id, title, children, onReplay }: { id: string; title: string; children: ReactNode; onReplay?: () => void }) {
  if (ONLY && ONLY !== id) return null;
  return (
    <section id={id} className="border-line relative flex min-h-[260px] flex-col justify-center gap-6 border-b px-4 py-10 sm:px-10">
      <header className="flex items-center justify-between">
        <h2 className="text-faint font-mono text-[11px] tracking-[0.18em] uppercase">{title}</h2>
        {onReplay ? (
          <button type="button" data-testid={`replay-${id}`} onClick={onReplay} className="border-line-2 text-mute hover:text-fg rounded-full border px-3 py-1 font-mono text-[11px]">
            Replay
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function FooterWordmark() {
  return (
    <DancingSvgWord text="TRADE JOURNAL" className="h-28 w-full sm:h-36" textClassName="font-sans text-[72px] font-bold">
      {(ch) => (
        <text dominantBaseline="middle" className="stroke-line-2" fill="transparent" strokeWidth="0.8">
          {ch}
        </text>
      )}
    </DancingSvgWord>
  );
}

const STATUS = ["LIVE", "VERZÖGERT", "OFFLINE"];

function Gallery() {
  const [cascade, setCascade] = useState(0);
  const [fill, setFill] = useState(0);
  const [type, setType] = useState(0);
  const [status, setStatus] = useState(0);
  const [marker, setMarker] = useState(true);
  const [title, setTitle] = useState(0);
  return (
    <main className="bg-ink-900 text-fg mx-auto max-w-5xl">
      <Section id="cascade" title="01 · AsciiCascade" onReplay={() => setCascade((n) => n + 1)}>
        <div className="flex flex-col items-center gap-10">
          <AsciiCascade text="TRADE JOURNAL" as="h1" play={cascade} reserve className="font-dot text-[32px] font-extrabold tracking-[0.08em] sm:text-[64px]" />
          <button type="button" data-testid="scenario" className="text-left" onClick={() => setTitle((n) => (n + 1) % 3)}>
            <AsciiCascade text={["Long-Ausbruch", "Range-Rückkehr", "Short-Abverkauf"][title]!} drop={0.3} className="font-mono text-[15px] font-medium" />
          </button>
        </div>
      </Section>

      <Section id="fill" title="02 · PixelTextFill" onReplay={() => setFill((n) => n + 1)}>
        <PixelTextFill lines={["Disziplin schlägt Gefühl."]} play={fill} align="center" className="text-[30px] font-medium tracking-[-0.01em] sm:text-[40px]" />
        <PixelTextFill
          lines={["Build with calm motion.", "Keep the rhythm crisp and clear.", "Make each screen feel alive.", "Let every detail guide focus."]}
          play={fill}
          align="center"
          className="text-[22px] leading-[1.2] font-medium sm:text-[32px]"
        />
      </Section>

      <Section id="type" title="03 · Typewriter" onReplay={() => setType((n) => n + 1)}>
        <Typewriter text="13 Trades · 4 Grundlagen · BTCUSDT 86.100" play={type} align="center" className="text-mute w-full font-mono text-[15px]" />
        <Typewriter text="Ship beautiful interfaces, fast." play={type} align="center" className="w-full text-[28px] font-medium" />
      </Section>

      <Section id="morph" title="04 · TextMorph" onReplay={() => setStatus((n) => (n + 1) % STATUS.length)}>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <span className="border-line-2 bg-ink-850 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.12em]">
            <span className="bg-signal size-1.5 rounded-full" />
            <TextMorph text={STATUS[status]} />
          </span>
          <TextMorph cycle={["Develop", "Deploy", "Delight"]} className="text-[40px] font-bold tracking-[-0.01em] sm:text-[56px]" align="center" />
        </div>
      </Section>

      <Section id="prism" title="05 · TextPrism">
        <div className="flex justify-center">
          <TextPrism text="+12.480,50 €" className="font-dot text-[40px] font-extrabold tracking-[-0.02em] sm:text-[64px]" />
        </div>
      </Section>

      <Section id="dance" title="06 · DancingLetters">
        <div className="flex justify-center">
          <DancingLetters text="ANIMATE" className="text-[56px] leading-none font-extrabold tracking-[-0.02em] sm:text-[96px]" />
        </div>
        <FooterWordmark />
      </Section>

      <Section id="marker" title="07 · TactileHighlight" onReplay={() => setMarker((m) => !m)}>
        <p className="text-center text-[28px] leading-[1.15] font-bold tracking-[-0.03em] sm:text-[40px]">
          Unser Fazit für heute:{" "}
          <TactileHighlight active={marker}>Long bevorzugt.</TactileHighlight>
        </p>
        <p className="text-mute text-center text-[18px]">
          Szenario-Urteil: <TactileHighlight tone="signal" playOnView>kein Trade</TactileHighlight> bis 86.400.
        </p>
      </Section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Gallery />
    </MotionRoot>
  </StrictMode>,
);
