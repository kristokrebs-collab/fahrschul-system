/**
 * "Live testen (Papier)": the saved version of the open strategy runs as a virtual account of the lab's forward test –
 * on new, closed candles from now on, never backwards, never with real money, never with an order. Starting asks once;
 * the account freezes the rules, so a later change of the text is a new version and a new account.
 */
import { useMemo, useState } from "react";
import { forwardCfgOf } from "@/domain/forward";
import { customKey } from "@/domain/lab";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { navigate } from "@/store/router";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { accountsOf, startLive } from "./live";
import { resolveEditor, versionMatches } from "./resolve";
import { useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { Disclaimer } from "./ui";
import type { StoredStrategy } from "@/domain/strategytext";

const L = STUDIO.live;

export function LiveCard({ strategies, className }: { strategies: StoredStrategy[]; className?: string }) {
  const editor = useStudio((s) => s.editor);
  const parsed = useStudio((s) => s.parsed);
  const rawForward = useJournal((s) => s.settings.forward);
  const accounts = useMemo(() => forwardCfgOf(rawForward).accounts, [rawForward]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = strategies.find((s) => s.id === editor.id);
  const last = st?.versions[st.versions.length - 1];
  const r = st ? resolveEditor(editor, parsed, st.versions) : null;
  // the saved version IS what the editor shows: same text, same answers, same rules
  const saved = !!st && !!last && versionMatches(last, editor.text, editor.answers) && !!r && customKey(last.config) === customKey(r.config);
  const list = st ? accountsOf(st, accounts) : [];

  const start = async (): Promise<void> => {
    if (!st || !last || busy) return;
    setBusy(true);
    const res = await startLive(st, last);
    setBusy(false);
    setConfirm(false);
    if (res.ok) pushToast({ kind: "success", title: L.started, detail: L.startedDetail(`${st.name} v${last.n}`) });
    else pushToast({ kind: "error", title: L.failed, detail: res.error });
  };

  return (
    <Card title={L.title} note={L.note} className={className} data-testid="studio-live">
      <div className="grid gap-4">
        {!confirm ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setConfirm(true)} disabled={!saved || !r?.ready} data-testid="studio-live-start">
              {L.start}
            </Button>
            {!saved && <span className="text-[12.5px] text-faint">{L.needsSaved}</span>}
            {saved && r && !r.ready && <span className="text-[12.5px] text-faint">{r.why}</span>}
          </div>
        ) : (
          <div className="grid gap-3 rounded-xl border border-line-2 bg-ink-950/60 p-3" role="group" aria-label={L.start} data-testid="studio-live-confirm">
            <p className="text-[12.5px] leading-relaxed text-fg/90">{L.explain}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void start()} disabled={busy} data-testid="studio-live-yes">
                {L.confirm}
              </Button>
              <Button onClick={() => setConfirm(false)} disabled={busy}>
                {L.cancel}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-2" data-testid="studio-live-accounts">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{L.accounts}</h3>
          {list.length === 0 ? (
            <p className="text-[12.5px] text-mute">{L.noAccounts}</p>
          ) : (
            <ul className="grid gap-1.5">
              {list.map(({ link, account }) => (
                <li key={link.accountId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px]" data-testid="studio-live-account">
                  <span className="min-w-0 flex-1 truncate text-fg">{account ? account.name : L.gone}</span>
                  {link.versionNo != null && <span className="font-mono text-[11px] text-faint">v{link.versionNo}</span>}
                  {account && <Badge tone={account.status === "running" ? "win" : "mute"}>{L.statusWord[account.status] ?? account.status}</Badge>}
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <Button size="sm" className="justify-self-start" onClick={() => navigate("labor")}>
              {L.open}
            </Button>
          )}
        </div>
        <Disclaimer />
      </div>
    </Card>
  );
}
