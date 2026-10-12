import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { openUpgrade } from "@/billing/store";
import { cn } from "@/lib/cn";
import { agoLabel } from "@/cloud/device";
import { useCloudSession } from "@/cloud/session";
import { useTick } from "@/cloud/ui/SyncStatusCard";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { createApiToken, listApiTokens, revokeApiToken } from "../api";
import { exchangeEnabled, toUiError } from "../store";
import { API_CARD } from "../strings";
import type { ApiToken, TokenScope } from "../types";
import { Notice } from "./parts";

const SCOPES: readonly TokenScope[] = ["webhook:tradingview", "trades:read", "trades:write"];

export const TV_TEMPLATE = `{"action":"open","id":"{{strategy.order.id}}","symbol":"{{ticker}}","side":"long","price":{{close}},"stop":0,"target":0,"setup":"Box-Breakout","timeframe":"{{interval}}"}`;

function webhookUrl(token: string): string {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return `${origin}/api/v1/hooks/tradingview/${token}`;
}

function CopyRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="label">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-ink-950/70 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg" data-testid={testId}>
          {value}
        </code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            );
            setTimeout(() => setCopied(false), 1_400);
          }}
        >
          {copied ? API_CARD.copied : API_CARD.copy}
        </Button>
      </div>
    </div>
  );
}

function TokenRow({ t, onRevoke }: { t: ApiToken; onRevoke: () => void }) {
  const now = useTick(60_000);
  const [asking, setAsking] = useState(false);
  const { trigger, no } = useConfirmFocus(asking);
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/40 p-3" data-testid="api-token">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{t.name || "Token"}</span>
          <code className="font-mono text-[11.5px] text-faint">
            <TextScramble text={`${t.prefix}…`} />
          </code>
        </span>
        <span className="text-[11px] text-faint">{t.lastUsedAt ? `${API_CARD.lastUsed} ${agoLabel(t.lastUsedAt, now)}` : API_CARD.neverUsed}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {t.scopes.map((s) => (
          <Badge key={s} tone="steel">
            {API_CARD.scopes[s]}
          </Badge>
        ))}
        <span className="flex-1" />
        {asking ? (
          <span className="flex flex-wrap items-center gap-2 text-[12px] text-[#ff8a90]" role="alert">
            {API_CARD.revokeAsk}
            <Button size="sm" variant="danger" onClick={onRevoke}>
              {API_CARD.revoke}
            </Button>
            <Button ref={no} size="sm" onClick={() => setAsking(false)}>
              Abbrechen
            </Button>
          </span>
        ) : (
          <HoldConfirm ref={trigger} size="sm" variant="danger" onAsk={() => setAsking(true)} onConfirm={onRevoke}>
            {API_CARD.revoke}
          </HoldConfirm>
        )}
      </div>
    </li>
  );
}

/**
 * "API & Webhooks" (P11, plan feature `apiAccess`): personal tokens for the REST API and the TradingView webhook.
 * A new token is shown ONCE (decoded by TextScramble) together with the webhook URL and the alert template to copy;
 * the list shows only the prefix. Revoking asks first or confirms by holding.
 */
export function ApiAccessCard({ className }: { className?: string }) {
  const enabled = exchangeEnabled();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const entitled = useEntitlement("apiAccess");
  const reduced = useReducedFx();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("TradingView");
  const [scopes, setScopes] = useState<Set<TokenScope>>(() => new Set(["webhook:tradingview"]));
  const [fresh, setFresh] = useState<{ token: string; info: ApiToken } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !signedIn || !entitled) return;
    let live = true;
    listApiTokens().then(
      (r) => live && setTokens(r.tokens),
      (e) => live && setError(toUiError(e).message),
    );
    return () => {
      live = false;
    };
  }, [enabled, signedIn, entitled]);

  if (!enabled || !signedIn) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await createApiToken(name.trim() || "Token", [...scopes]);
      setFresh(out);
      setTokens((t) => [out.info, ...(t ?? [])]);
    } catch (e) {
      setError(toUiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await revokeApiToken(id);
      setTokens((t) => (t ?? []).filter((x) => x.id !== id));
      if (fresh?.info.id === id) setFresh(null);
    } catch (e) {
      setError(toUiError(e).message);
    }
  };

  return (
    <div className="h-full" data-testid="api-card">
      <Card title={API_CARD.title} className={cn("h-full", className)}>
        <div className="grid gap-4">
          <p className="text-[12.5px] text-mute">{API_CARD.lead}</p>
          {!entitled ? (
            <div className="grid gap-2.5 rounded-xl border border-line bg-ink-950/40 p-3">
              <span className="flex items-center gap-2 text-[13px] text-mute">
                <Badge tone="steel">Premium</Badge>
                {API_CARD.locked}
              </span>
              <Button size="sm" variant="primary" className="justify-self-start" onClick={() => openUpgrade("apiAccess", "premium")}>
                Premium ansehen
              </Button>
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {fresh && (
                  <motion.div
                    key={fresh.info.id}
                    className="grid gap-3 rounded-2xl border border-win/30 bg-win/[0.04] p-3"
                    initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
                    exit={{ opacity: 0, transition: tween.exit }}
                    transition={{ default: spring.enter, opacity: tween.fade }}
                    data-testid="api-fresh"
                  >
                    <p className="text-[12px] text-win">{API_CARD.once}</p>
                    <CopyRow label="Token" value={fresh.token} testId="api-token-value" />
                    {fresh.info.scopes.includes("webhook:tradingview") && (
                      <>
                        <CopyRow label={API_CARD.webhookUrl} value={webhookUrl(fresh.token)} />
                        <CopyRow label={API_CARD.template} value={TV_TEMPLATE} />
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <form
                className="grid gap-2.5 rounded-xl border border-line bg-ink-950/40 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (scopes.size) void create();
                }}
              >
                <label className="grid gap-1">
                  <span className="label">{API_CARD.name}</span>
                  <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={API_CARD.namePh} />
                </label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rechte">
                  {SCOPES.map((s) => {
                    const on = scopes.has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setScopes((cur) => {
                            const n = new Set(cur);
                            if (n.has(s)) n.delete(s);
                            else n.add(s);
                            return n;
                          })
                        }
                        className={cn("touch-hit rounded-full border px-2.5 py-1 text-[11.5px] transition-colors", on ? "border-white/40 bg-white/[0.1] text-fg" : "border-line text-mute hover:text-fg")}
                      >
                        {API_CARD.scopes[s]}
                      </button>
                    );
                  })}
                </div>
                <Button type="submit" size="sm" variant="primary" className="justify-self-start" disabled={busy || scopes.size === 0}>
                  {API_CARD.create}
                </Button>
              </form>

              {error && <Notice tone="warn">{error}</Notice>}
              {tokens && tokens.length > 0 ? (
                <ul className="grid gap-2">
                  {tokens.map((t) => (
                    <TokenRow key={t.id} t={t} onRevoke={() => void revoke(t.id)} />
                  ))}
                </ul>
              ) : tokens ? (
                <p className="text-[12px] text-faint">{API_CARD.none}</p>
              ) : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
