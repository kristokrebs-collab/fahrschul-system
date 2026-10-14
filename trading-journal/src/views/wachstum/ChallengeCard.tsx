/**
 * Challenges (P08) as a card deck: the running challenges and the deck are dealt into their grid on first view
 * (`CardSpread` "deal": a slanted stack flies out card by card and rests at `transform: none`). "Karte ziehen" flips the
 * top card of the deck out – rotateY to the edge, the front comes round on `spring.pop` and rests flat (`transform:
 * none`) – showing the challenge that fits the trader's most frequent pattern; "Andere Karte" flips to the next one,
 * "Annehmen" starts it today. A running card shows its days as cells (clean / broken / today / ahead). Challenges never
 * need a trade: not trading is never punished. Done / failed is written back by the page (`useGrowthTransitions`).
 */
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { ChallengeProgress, ChallengeTemplate } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { pushToast } from "@/store/uiStore";
import { patchChallenge, startChallenge } from "./actions";
import { WACHSTUM } from "./strings";

const CH = WACHSTUM.challenges;
const CELL: Record<string, string> = { ok: "bg-win/80", fail: "bg-loss", pending: "border border-dashed border-white/40 bg-transparent", future: "bg-white/[0.06]", idle: "bg-white/15" };
/** A 7 × 9 card-back pattern (a diamond lattice), static. */
const BACK = Array.from({ length: 7 }, (_, r) => Array.from({ length: 9 }, (_, c) => ((r + c) % 4 === 0 || (r - c + 16) % 4 === 0 ? 0.55 : 0)));

function Running({ p }: { p: ChallengeProgress }) {
  const [ask, setAsk] = useState(false);
  const t = p.template;
  const drop = async () => {
    if (await patchChallenge(p.challenge.id, { status: "dropped", endedAt: new Date().toISOString() })) pushToast({ kind: "info", title: CH.dropped, detail: t.title });
  };
  return (
    <div className="grid h-full content-start gap-3 rounded-2xl border border-line-2 bg-ink-950/50 p-4" data-testid="challenge-running" data-template={t.key} data-state={p.state}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="label !text-[10px]">Läuft</span>
          <h3 className="text-[14.5px] font-semibold leading-snug">{t.title}</h3>
          <p className="text-[11.5px] text-mute">{t.text}</p>
        </div>
        <DotMatrixText text={t.glyph} tone="fg" size={3} gap={1} decorative />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="dot-num text-[30px] leading-none">{Math.min(p.day, p.days)}</span>
        <span className="text-[12px] text-mute">
          von {p.days} Tagen{t.mode === "count" ? ` · ${p.have}/${p.need} geschafft` : ""}
        </span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(p.days, 14)}, minmax(0, 1fr))` }} role="img" aria-label={`${p.cells.filter((c) => c.state === "ok").length} von ${p.days} Tagen geschafft`}>
        {p.cells.map((c) => (
          <span key={c.key} title={c.key} className={cn("aspect-square rounded-[4px]", CELL[c.state])} data-cell={c.state} />
        ))}
      </div>
      {p.violations[0] && <p className="text-[11.5px] text-loss">{p.violations[0].text}</p>}
      <div className="flex justify-end">
        {ask ? (
          <span className="flex items-center gap-2 text-[11.5px]">
            Wirklich abbrechen?
            <Button size="sm" variant="danger" onClick={() => void drop()}>
              Ja
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>
              Nein
            </Button>
          </span>
        ) : (
          <button type="button" className="min-h-9 rounded-lg px-2 text-[11px] text-faint hover:text-fg pointer-coarse:min-h-11" onClick={() => setAsk(true)}>
            {CH.drop}
          </button>
        )}
      </div>
    </div>
  );
}

/** The deck: a card back until drawn, then the drawn challenge flips out. */
function Deck({ suggestions, todayKey }: { suggestions: readonly ChallengeTemplate[]; todayKey: string }) {
  const reduced = useReducedFx();
  const [face, setFace] = useState<"back" | "front">("back");
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const cur = suggestions.length ? suggestions[i % suggestions.length]! : null;

  if (!cur) {
    return (
      <div className="grid h-full place-items-center rounded-2xl border border-dashed border-line-2 p-4 text-center text-[12px] text-mute" data-testid="challenge-deck" data-face="empty">
        {CH.all}
      </div>
    );
  }
  // the flip: the back leaves by turning to the edge (and lifting), the front comes round on `spring.pop`
  const draw = () => setFace("front");
  const accept = async () => {
    setBusy(true);
    const c = await startChallenge(cur.key, cur.title, todayKey);
    setBusy(false);
    if (c) {
      setFace("back");
      setI(0);
    }
  };
  return (
    <div className="h-full [perspective:900px]" data-testid="challenge-deck" data-face={face} data-template={face === "front" ? cur.key : ""}>
      <AnimatePresence mode="wait" initial={false}>
        {face === "back" ? (
          <motion.div
            key="back"
            className="relative grid h-full min-h-[210px] place-items-center gap-3 overflow-hidden rounded-2xl border border-line-2 bg-gradient-to-br from-ink-800 to-ink-950 p-4"
            initial={reduced ? false : { rotateY: 90 }}
            animate={{ rotateY: 0, transitionEnd: { transform: "none" } }}
            exit={reduced ? { opacity: 0, transition: tween.exit } : { rotateY: 90, y: -6, scale: 1.03, transition: { duration: tween.fade.duration, ease: "easeIn" } }}
            transition={spring.pop}
          >
            <DotMatrix pattern={BACK} rows={7} cols={9} size={5} gap={3} tone="mute" />
            <Button variant="primary" onClick={draw} data-testid="challenge-draw">
              {CH.draw}
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key={`front-${cur.key}`}
            className="grid h-full min-h-[210px] content-start gap-3 rounded-2xl border border-white/40 bg-ink-850 p-4 shadow-[0_18px_40px_rgb(0_0_0/calc(0.45*var(--shade,1)))]"
            initial={reduced ? false : { rotateY: -90, scale: 1.03 }}
            animate={{ rotateY: 0, scale: 1, transitionEnd: { transform: "none" } }}
            exit={{ rotateY: 90, transition: tween.exit }}
            transition={spring.pop}
            data-testid="challenge-drawn"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="grid min-w-0 gap-0.5">
                <span className="label !text-[10px]">{cur.days} Tage</span>
                <h3 className="text-[15px] font-semibold leading-snug">{cur.title}</h3>
              </div>
              <DotMatrixText text={cur.glyph} tone="signal" size={3} gap={1} decorative />
            </div>
            <p className="text-[12.5px] leading-relaxed text-mute">{cur.text}</p>
            <p className="text-[11px] text-faint">{cur.mode === "clean" ? "Gewonnen, wenn die Tage ohne Verstoß vergehen – auch ohne Trade." : "Gewonnen, sobald du es an genug Tagen geschafft hast."}</p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => void accept()} disabled={busy} data-testid="challenge-accept">
                {CH.accept}
              </Button>
              {suggestions.length > 1 && (
                <Button size="sm" onClick={() => setI((x) => x + 1)} disabled={busy} data-testid="challenge-other">
                  {CH.other}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChallengeCard({ running, suggestions, todayKey, done = [], className }: { running: readonly ChallengeProgress[]; suggestions: readonly ChallengeTemplate[]; todayKey: string; done?: readonly string[]; className?: string }) {
  return (
    <Card title={CH.title} note={running.length ? `${running.length} läuft` : CH.none} className={className} data-testid="growth-challenges" data-running={running.length}>
      <div className="grid gap-4">
        <CardSpread variant="deal" className="grid gap-3 sm:grid-cols-2" itemClassName="min-w-0" label="Challenge-Karten">
          {[...running.map((p) => <Running key={p.challenge.id} p={p} />), <Deck key="deck" suggestions={suggestions} todayKey={todayKey} />]}
        </CardSpread>
        <div className="grid gap-1.5 border-t border-line pt-3" data-testid="challenge-done" data-n={done.length}>
          <span className="label !text-[10px]">Gemeistert</span>
          {done.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {done.slice(0, 8).map((t, i) => (
                <li key={`${t}-${i}`} className="rounded-full border border-win/40 px-2.5 py-1 text-[11.5px] text-fg">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">Noch keine – jede Karte dauert 7 bis 14 Tage und braucht keinen einzigen Trade.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
