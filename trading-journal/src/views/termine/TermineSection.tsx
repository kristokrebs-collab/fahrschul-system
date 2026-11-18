/**
 * Section „Termine“ of the Markt page (F43): „Heute wichtig“ (the Morgenbriefing), „Termine“ (calendar) and „Ereignisphasen“
 * (the strategy filter). One lazy chunk, loaded when the Markt page is open – the first load never imports it. The cards are
 * found by their `data-testid` (`briefing-card`, `termine-card`, `phasen-card`) for the page's „Inhalt“ strip.
 */
import { Fold } from "@/primitives/Fold";
import { Reveal } from "@/motion/Reveal";
import { BriefingCard } from "./BriefingCard";
import { PhasenCard } from "./PhasenCard";
import { TermineCard } from "./TermineCard";

export default function TermineSection() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" data-testid="termine-section">
      <Reveal index={0} className="min-w-0 lg:col-span-5">
        <BriefingCard />
      </Reveal>
      {/* settled: the calendar is a long list (3 000+ px on a phone, more with Funding on) – a reveal waits for 15 % of the element in view and a card that tall would stay at opacity 0 on a short screen */}
      <Reveal index={1} settled className="min-w-0 lg:col-span-7">
        <TermineCard />
      </Reveal>
      <Reveal index={2} className="min-w-0 lg:col-span-12">
        <Fold id="markt-phasen" title="Ereignisphasen" hint="Wie deine Trades rund um Termine liefen, verglichen mit allen anderen">
          <PhasenCard />
        </Fold>
      </Reveal>
    </div>
  );
}
