import { motion } from "motion/react";
import { useEffect, useId } from "react";
import { cn } from "@/lib/cn";
import { Switch } from "@/motion/Switch";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { setPrivacy, usePrivacy, type PrivacyPrefs } from "../privacy";
import { cloudEnabled } from "../env";
import { useCloudSession } from "../session";
import { DATA_CARD_ID, PRIVACY_CARD } from "./strings";

interface Row {
  key: keyof PrivacyPrefs;
  label: string;
  help: string;
  /** Needs a signed-in account. */
  account?: boolean;
}

const ROWS: readonly Row[] = [
  { key: "sync", label: PRIVACY_CARD.sync, help: PRIVACY_CARD.syncHelp },
  { key: "telemetry", label: PRIVACY_CARD.telemetry, help: PRIVACY_CARD.telemetryHelp },
  { key: "leaderboard", label: PRIVACY_CARD.leaderboard, help: PRIVACY_CARD.leaderboardHelp, account: true },
];

/**
 * `Datenschutz` card (P09): Sync on this device, anonymous error reports (opt-in, default off), ranking opt-in (P12).
 * Every row is an elastic `Switch`; rows cascade in (`stagger.cards`), a row that is on gets a soft win edge that fades
 * (`tween.crossfade`). Telemetry and ranking follow the account (`profiles.privacy`) when signed in; the ranking row
 * also adopts the server's opt-in on mount (`followServerOptIn`), so Konto and Community never disagree.
 */
export function PrivacyCard({ className }: { className?: string }) {
  const prefs = usePrivacy();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const reduced = useReducedFx();
  const id = useId();
  // the ranking row is the same switch as Community's „In der Rangliste erscheinen“: it follows the server's opt-in
  // as soon as the card shows (P1-03) – the social store loads on demand, it stays out of this chunk
  useEffect(() => {
    if (!signedIn || !cloudEnabled()) return;
    void import("@/social/store").then((m) => m.followServerOptIn()).catch(() => undefined);
  }, [signedIn]);
  return (
    <Card title={PRIVACY_CARD.title} className={className}>
      <p className="mb-4 text-[13px] leading-relaxed text-mute">{PRIVACY_CARD.intro}</p>
      <ul className={cn("grid gap-2", signedIn && "mb-4")}>
        {ROWS.map((r, i) => {
          const disabled = !!r.account && !signedIn;
          const on = prefs[r.key] && !disabled;
          const sid = `${id}-${r.key}`;
          return (
            <motion.li
              key={r.key}
              className={cn("relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border px-3.5 py-3 transition-colors duration-200", on ? "border-win/25" : "border-line")}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
              transition={{ y: { ...spring.enter, delay: i * stagger.cards }, opacity: { ...tween.fade, delay: i * stagger.cards } }}
            >
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-win/[0.07] to-transparent"
                initial={false}
                animate={{ opacity: on ? 1 : 0 }}
                transition={tween.crossfade}
              />
              <span className="relative grid min-w-0 gap-0.5">
                <label htmlFor={sid} className={cn("flex flex-wrap items-center gap-2 text-[13px]", disabled ? "text-faint" : "cursor-pointer text-fg")}>
                  {r.label}
                  {disabled && <Badge tone="mute">{PRIVACY_CARD.needsAccount}</Badge>}
                </label>
                <span className="text-[11.5px] leading-snug text-faint">{r.help}</span>
              </span>
              <Switch id={sid} className="relative" checked={on} disabled={disabled} tone={r.key === "sync" ? "fg" : "win"} onCheckedChange={(v) => setPrivacy({ [r.key]: v })} />
            </motion.li>
          );
        })}
      </ul>
      {signedIn && (
        // the card floor (Sicherheit beside it is taller): the way to export / delete, like the Community footer
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-[11.5px] text-faint">{PRIVACY_CARD.toDataHint}</span>
          <Button size="sm" variant="ghost" onClick={() => toDataCard(reduced)} data-testid="privacy-to-data">
            {PRIVACY_CARD.toData}
            <span aria-hidden="true">↓</span>
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Scrolls to „Deine Daten“ (export, backups, delete) and moves the focus there – no route change (hash routing). */
function toDataCard(reduced: boolean): void {
  const el = document.getElementById(DATA_CARD_ID);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}
