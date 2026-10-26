import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { DotMatrix } from "@/motion/DotMatrix";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { Reveal } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { withAdoptedSetup } from "@/social/adopt";
import { fetchShared } from "@/social/api";
import { parseSharePayload, type SharedResponse } from "@/social/contract";
import { sendFeedback, toUiError, type UiError } from "@/social/store";
import { S, SHARED } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { PayloadCard } from "@/social/ui/ShareCards";
import { PROOF_PAGE } from "@/social/proofStrings";
import { PageHeader } from "@/views/setups/PageHeader";

const ProofPage = lazy(() => import("./ProofPage").then((m) => ({ default: m.ProofPage })));

export interface SharedViewProps {
  /** The token of `#share/<token>` (P14's router: `parseShareHash(location.hash)`). */
  token: string;
  /** "Zum eigenen Journal" – P14 navigates to the overview. */
  onOpenApp?: () => void;
  className?: string;
}

type State = { phase: "loading" } | { phase: "ok"; data: SharedResponse } | { phase: "gone" } | { phase: "error"; error: UiError } | { phase: "off" };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Struck-through link glyph of an expired / revoked share (static). */
const o = 0.5;
const GONE = [
  [0, 0, o, o, 0, 0, 0, 0, 1],
  [0, o, 0, 0, o, 0, 0, 1, 0],
  [0, o, 0, 0, o, 0, 1, 0, 0],
  [0, 0, o, o, 0, 1, o, o, 0],
  [0, 0, 0, 0, 1, o, 0, 0, o],
  [0, 0, 0, 1, 0, o, 0, 0, o],
  [0, 0, 1, 0, 0, 0, o, o, 0],
];

/**
 * The public page of a share link (P12, route `#share/<token>`): no login needed, no journal data read or written
 * unless the visitor adopts a shared setup. The redacted card blur-fades in with one red sweep; expired / revoked links
 * say so honestly; without a cloud in this build the page says that too. Reporting needs a login.
 */
export function SharedView({ token, onOpenApp, className }: SharedViewProps) {
  const reduced = useReducedFx();
  const enabled = cloudEnabled();
  const [state, setState] = useState<State>(() => (enabled ? { phase: "loading" } : { phase: "off" }));
  const [adopted, setAdopted] = useState(false);
  const settings = useJournal((s) => s.settings);
  const saveSettings = useJournal((s) => s.saveSettings);
  const phase = useCloudSession((s) => s.phase);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchShared(token)
      .then((data) => {
        if (!live) return;
        const payload = parseSharePayload(data.payload);
        setState(payload ? { phase: "ok", data: { ...data, payload } } : { phase: "gone" });
      })
      .catch((e: unknown) => {
        if (!live) return;
        const err = toUiError(e);
        setState(err.code === "share_not_found" ? { phase: "gone" } : { phase: "error", error: err });
      });
    return () => {
      live = false;
    };
  }, [token, enabled]);

  const adopt = async () => {
    if (state.phase !== "ok" || state.data.payload.kind !== "setup") return;
    try {
      const { settings: next } = withAdoptedSetup(settings, state.data.payload);
      await saveSettings(next);
      setAdopted(true);
      pushToast({ kind: "success", title: SHARED.adopted });
    } catch {
      pushToast({ kind: "error", title: S.failed });
    }
  };
  const report = () => {
    if (phase !== "signedIn") {
      pushToast({ kind: "error", title: S.loginToReport });
      return;
    }
    void sendFeedback({ kind: "report", message: SHARED.reportReason, page: "share", target: { type: "share", id: token } });
  };

  const isProof = state.phase === "ok" && state.data.payload.kind === "proof";
  return (
    <div className={cn("mx-auto grid w-full max-w-[760px] gap-5", className)} data-testid="shared-view" data-phase={state.phase}>
      <PageHeader title={isProof ? PROOF_PAGE.title : SHARED.title} lead={isProof ? PROOF_PAGE.lead : SHARED.redacted} />
      {state.phase === "loading" && (
        <div className="grid place-items-center gap-3 rounded-2xl border border-line bg-ink-900 px-5 py-14" aria-busy="true">
          <DotMatrixText text="" preset="wave" cycles={Infinity} presetTone="mute" decorative />
          <span className="text-[13px] text-mute">{SHARED.loading}</span>
        </div>
      )}
      {(state.phase === "gone" || state.phase === "off" || state.phase === "error") && (
        <motion.div
          className="grid justify-items-start gap-4 rounded-2xl border border-line bg-ink-900 p-6"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
          transition={{ y: spring.enter, opacity: tween.fade }}
          data-testid="shared-gone"
        >
          <DotMatrix pattern={GONE} size={6} gap={2} tone="mute" glow={false} label="Link ungültig" />
          <h2 className="text-[19px] font-semibold tracking-tight">{state.phase === "gone" ? SHARED.goneTitle : state.phase === "off" ? SHARED.title : SHARED.goneTitle}</h2>
          <p className="max-w-[56ch] text-[13.5px] leading-relaxed text-mute">{state.phase === "gone" ? SHARED.goneText : state.phase === "off" ? SHARED.noCloud : state.error.message}</p>
          {onOpenApp && <Button onClick={onOpenApp}>{SHARED.openApp}</Button>}
        </motion.div>
      )}
      {state.phase === "ok" && (
        <>
          {state.data.payload.kind === "proof" ? (
            <Suspense fallback={<div className="h-64 rounded-2xl border border-line bg-ink-900/60" aria-hidden="true" />}>
              <ProofPage proof={state.data.payload} createdAt={state.data.createdAt} />
            </Suspense>
          ) : (
            <Reveal index={0} className="relative min-w-0 overflow-hidden rounded-2xl">
              <SpotlightSweep tone="signal" />
              <PayloadCard p={state.data.payload} big className="bg-[radial-gradient(120%_70%_at_0%_0%,var(--color-ink-750)_0%,var(--color-ink-850)_55%)] p-5 sm:p-7" />
            </Reveal>
          )}
          <Reveal index={1} className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              {SHARED.sharedOn(dateLabel(state.data.createdAt))}
              {state.data.expiresAt ? ` · ${SHARED.until(dateLabel(state.data.expiresAt))}` : ""} · {SHARED.views(state.data.views)}
            </span>
            <span className="flex flex-wrap gap-2">
              {state.data.payload.kind === "setup" && (
                <Button variant="primary" onClick={adopt} disabled={adopted} data-testid="shared-adopt">
                  <Glyph name={adopted ? "check" : "plus"} className="size-4" />
                  {adopted ? SHARED.adopted : SHARED.adopt}
                </Button>
              )}
              {onOpenApp && <Button onClick={onOpenApp}>{SHARED.openApp}</Button>}
              <Button onClick={report} aria-label={SHARED.report} data-testid="shared-report">
                <Glyph name="flag" className="size-4" />
              </Button>
            </span>
          </Reveal>
        </>
      )}
    </div>
  );
}
