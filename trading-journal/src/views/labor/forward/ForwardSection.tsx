/**
 * Forward-Test (F23): the section under the lab's extras – a form for a new virtual account and the list of accounts. Its own
 * lazy chunk (`LaborView` loads it with `lazy`); the background catch-up is `ForwardHost` (mounted by `DeferredHosts`).
 */
import { useEffect, useMemo } from "react";
import { forwardCfgOf, MAX_ACCOUNTS, MAX_RUNNING } from "@/domain/forward";
import { Reveal } from "@/motion/Reveal";
import { EmptyState } from "@/primitives/EmptyState";
import { useJournal } from "@/store/journalStore";
import { AccountCard } from "./AccountCard";
import { catchUpAll } from "./forwardRunner";
import { NewAccountCard } from "./NewAccountCard";
import { FORWARD } from "./strings";

const F = FORWARD;

export function ForwardSection() {
  const raw = useJournal((s) => s.settings.forward);
  const accounts = useMemo(() => forwardCfgOf(raw).accounts, [raw]);
  const ids = accounts.filter((a) => !a.cursor.done).map((a) => `${a.id}:${a.status}`).join("|");

  // opening the section brings the accounts up to date at once (the background host does it too; a run in progress is joined)
  useEffect(() => {
    if (ids) void catchUpAll();
  }, [ids]);

  const running = accounts.filter((a) => a.status !== "ended").length;
  return (
    <div className="grid gap-4" data-testid="forward-section">
      <p className="max-w-[78ch] text-[13px] leading-relaxed text-mute">{F.lead}</p>
      <p className="max-w-[78ch] text-[12px] leading-relaxed text-faint">{F.honest}</p>
      <NewAccountCard />
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">{F.accountsTitle}</h3>
        <span className="num text-[11.5px] text-faint" data-testid="forward-count">
          {F.count(accounts.length, MAX_ACCOUNTS)}
          {running >= MAX_RUNNING ? ` · höchstens ${MAX_RUNNING} laufende oder pausierte` : ""}
        </span>
      </div>
      {!accounts.length ? (
        <EmptyState title="Noch kein virtuelles Konto" text={F.empty} />
      ) : (
        <div className="grid gap-4" data-testid="forward-list">
          {accounts.map((a, i) => (
            <Reveal key={a.id} index={i} className="min-w-0">
              <AccountCard account={a} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

export default ForwardSection;
