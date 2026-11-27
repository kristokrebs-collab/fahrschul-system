import { useState } from "react";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { MCP } from "./strings";
import { revokeMcp, startMcp, testMcp, useTv } from "./tvStore";

const when = (iso: string): string => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * "TradingView-Konto lesend verbinden" (OAuth 2.1 with PKCE towards the official TradingView MCP, B3). A second, optional way next to the
 * address of the alerts. States, all honest: not set up by the operator · not connected · connected (read test) · connection no longer valid.
 * The app only READS (a read test lists the watchlists); it never creates or changes anything in the TradingView account.
 * Only checked against a mock server – the real service was not signed in to (docs/ENV.md).
 */
export function TvMcpPanel() {
  const mcp = useTv((s) => s.status?.mcp);
  const busy = useTv((s) => s.mcpBusy);
  const test = useTv((s) => s.mcpTest);
  const error = useTv((s) => s.mcpError);
  const back = useTv((s) => s.mcpReturn);
  const [ask, setAsk] = useState(false);
  const [revokedNote, setRevokedNote] = useState<string | null>(null);
  if (!mcp) return null;

  return (
    <section className="grid gap-3 rounded-2xl border border-line p-3.5" aria-labelledby="tvmcp-h" data-testid="tvmcp" data-state={!mcp.configured ? "unconfigured" : mcp.status === "invalid" ? "invalid" : mcp.connected ? "connected" : "disconnected"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="tvmcp-h" className="text-[14px] font-semibold">
          {MCP.title}
        </h3>
        {!mcp.configured ? <Badge tone="warn">{MCP.badgeSetup}</Badge> : mcp.status === "invalid" ? <Badge tone="loss">{MCP.badgeInvalid}</Badge> : mcp.connected ? <Badge tone="win">{MCP.badgeConnected}</Badge> : <Badge tone="mute">{MCP.badgeOff}</Badge>}
      </div>
      <p className="text-[12.5px] leading-relaxed text-mute">{MCP.lead}</p>

      {back && (
        <p role="status" className={back === "ok" ? "rounded-xl border border-win/35 bg-win/[0.06] px-3 py-2 text-[12.5px] text-fg" : "rounded-xl border border-warn/35 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-fg"} data-testid="tvmcp-return">
          {MCP.back[back]}
        </p>
      )}

      {!mcp.configured ? (
        <p className="text-[12.5px] leading-relaxed text-mute" data-testid="tvmcp-unconfigured">
          {MCP.unconfigured}
        </p>
      ) : (
        <>
          {mcp.connected && (
            <div className="grid gap-1 text-[12.5px] text-mute" data-testid="tvmcp-state">
              <span>{mcp.createdAt ? MCP.since(when(mcp.createdAt)) : MCP.connectedLine}</span>
              <span data-testid="tvmcp-last">
                {mcp.lastTestAt ? (mcp.lastTestOk ? MCP.testOk(when(mcp.lastTestAt)) : MCP.testBad(when(mcp.lastTestAt))) : MCP.testNone}
              </span>
              {test && (
                <span className="text-fg" data-testid="tvmcp-result">
                  {MCP.result(test.tools, test.watchlists)}
                </span>
              )}
            </div>
          )}
          {mcp.status === "invalid" && (
            <p className="text-[12.5px] leading-relaxed text-loss" role="alert" data-testid="tvmcp-invalid">
              {mcp.lastError ?? MCP.invalidFallback}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-loss/35 bg-loss/[0.07] px-3 py-2 text-[12.5px] text-loss" data-testid="tvmcp-error">
              {error}
            </p>
          )}
          {revokedNote && (
            <p role="status" className="text-[12px] leading-snug text-warn" data-testid="tvmcp-revoked-note">
              {revokedNote}
            </p>
          )}
          <p className="text-[11.5px] leading-relaxed text-faint">{MCP.planNote}</p>
          <div className="flex flex-wrap gap-2">
            {!mcp.connected && (
              <Button variant="primary" fx={false} loading={busy === "start"} onClick={() => void startMcp()} data-testid="tvmcp-start">
                {mcp.status === "invalid" ? MCP.reconnect : MCP.connect}
              </Button>
            )}
            {mcp.connected && (
              <Button size="sm" loading={busy === "test"} onClick={() => void testMcp()} data-testid="tvmcp-test">
                {MCP.test}
              </Button>
            )}
            {(mcp.connected || mcp.status === "invalid") &&
              (ask ? (
                <span className="flex flex-wrap items-center gap-2" role="group" aria-label={MCP.disconnect}>
                  <span className="text-[12px] text-mute">{MCP.disconnectAsk}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === "revoke"}
                    onClick={() =>
                      void revokeMcp().then((r) => {
                        if (!r.ok) return;
                        setAsk(false);
                        setRevokedNote(r.revoked ? null : MCP.notConfirmed);
                      })
                    }
                    data-testid="tvmcp-revoke-yes"
                  >
                    {MCP.disconnectYes}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>
                    {MCP.disconnectNo}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setAsk(true)} data-testid="tvmcp-revoke">
                  {MCP.disconnect}
                </Button>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
