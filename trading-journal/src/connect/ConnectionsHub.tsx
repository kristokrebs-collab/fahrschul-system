import { useEffect } from "react";
import { Card } from "@/primitives/Card";
import { ConnectSlot } from "./ConnectSlot";
import { openConnectDialog } from "./open";
import { useTv } from "./tvStore";
import { GROUP_LABEL, HUB_ORDER, SERVICES, type ServiceGroup } from "./services";

const GROUPS: readonly ServiceGroup[] = ["account", "exchange", "signal", "alert"];

/**
 * Einstellungen → Verbindungen (Paket Verbindungen): the one place that lists every service with its honest state.
 * Each row is the same `ConnectSlot` that stands where the connection is needed. Everybody connects their own accounts –
 * nothing is hosted for them, and a service the operator has not set up says so instead of failing later.
 */
export default function ConnectionsHub({ className }: { className?: string }) {
  // coming back from the sign-in at TradingView (`/?tvmcp=ok|abgebrochen|fehler#settings`, a fixed address the server redirects to):
  // open the TradingView dialog, say how it ended, and take the marker out of the address
  useEffect(() => {
    if (typeof location === "undefined") return;
    const v = new URLSearchParams(location.search).get("tvmcp");
    if (v !== "ok" && v !== "abgebrochen" && v !== "fehler") return;
    useTv.setState({ mcpReturn: v });
    openConnectDialog("tradingview");
    try {
      const u = new URL(location.href);
      u.searchParams.delete("tvmcp");
      history.replaceState(history.state, "", `${u.pathname}${u.search}${u.hash}`);
    } catch {
      /* the marker may stay; nothing depends on it */
    }
  }, []);
  return (
    <Card title="Verbindungen" note="Deine eigenen Konten und Dienste. Alles nur lesend oder von dir ausgelöst – du trennst jede Verbindung selbst." className={className}>
      <div className="grid gap-5" data-testid="connections-hub">
        {GROUPS.map((g) => {
          const ids = HUB_ORDER.filter((id) => SERVICES[id].group === g);
          return (
            <section key={g} aria-label={GROUP_LABEL[g]} className="grid gap-2">
              <h3 className="label">{GROUP_LABEL[g]}</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {ids.map((id) => (
                  <ConnectSlot key={id} service={id} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
