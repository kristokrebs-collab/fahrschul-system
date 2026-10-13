/**
 * Behaviour profile – "Personal Trading Intelligence" (P04): style, direction, best session, weakest day, strongest
 * setup, risk per trade, tempo, the edge and the most expensive pattern, all measured from the journal. The traits
 * fan out into an elliptical ring once the card is in view (`OrbitSpread`: depth scale, pointer drift, ←/→ turn it)
 * – the plain trait list next to it carries the same facts for small screens and screen readers.
 */
import type { BehaviorProfile, ProfileTrait } from "@/domain/coach";
import { cn } from "@/lib/cn";
import { OrbitSpread } from "@/motion/pulse/OrbitSpread";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { PROFILE_MIN_TRADES } from "@/domain/coach";
import { TONE_TEXT } from "./ui";

const ORBIT_MAX = 8;

function OrbitTrait({ t }: { t: ProfileTrait }) {
  return (
    <div className="grid size-full content-between bg-[linear-gradient(160deg,var(--color-ink-750),var(--color-ink-900))] p-[1.3cqw]">
      <span className="truncate font-mono text-[max(8px,1.25cqw)] uppercase tracking-[0.12em] text-mute">{t.label}</span>
      <span className={cn("line-clamp-2 text-[max(10px,2.1cqw)] font-semibold leading-tight", TONE_TEXT[t.tone])}>{t.value}</span>
      <span className="truncate text-[max(7px,1.05cqw)] text-faint">{t.detail}</span>
    </div>
  );
}

export function ProfileCard({ profile, className }: { profile: BehaviorProfile; className?: string }) {
  if (!profile.traits.length) {
    return (
      <Card title="Dein Profil" className={className} data-testid="coach-profile">
        <EmptyState title="Profil im Aufbau" text={`Ab ${PROFILE_MIN_TRADES} abgeschlossenen Trades zeichnet der Coach dein Profil: Stil, Session, Stärken, teuerste Muster. Bisher: ${profile.n}.`} line={false} />
      </Card>
    );
  }
  const orbit = profile.traits.slice(0, ORBIT_MAX);
  return (
    <Card title="Dein Profil" note={`Aus ${profile.n} abgeschlossenen Trades`} className={className} data-testid="coach-profile" innerClassName="grid gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] xl:items-center">
        <div className="grid content-start gap-3">
          <p className="text-[clamp(18px,4.6vw,24px)] font-semibold leading-tight tracking-[-0.02em] text-fg [text-wrap:balance]">{profile.headline || "Dein Trading in Zahlen"}</p>
          <dl className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            {profile.traits.map((t) => (
              <div key={t.id} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/70 py-1.5 text-[12.5px]">
                <dt className="shrink-0 text-mute">{t.label}</dt>
                <dd className={cn("min-w-0 truncate text-right font-medium", TONE_TEXT[t.tone])} title={t.detail}>
                  {t.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border border-line">
          <OrbitSpread label="Dein Profil als Ring" listLabel="Eigenschaften" items={orbit.map((t) => <OrbitTrait key={t.id} t={t} />)}>
            <span className="text-[5cqw] font-semibold leading-none tracking-[-0.06em] text-fg">Du.</span>
            <span className="max-w-[60cqw] text-[max(10px,1.5cqw)] text-white/60">{profile.headline}</span>
          </OrbitSpread>
        </div>
      </div>
    </Card>
  );
}
