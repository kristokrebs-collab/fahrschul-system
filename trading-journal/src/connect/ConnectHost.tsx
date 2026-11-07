import { useState } from "react";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import "./connect.css";
import { BinanceWizard } from "./BinanceWizard";
import { useServiceView } from "./facts";
import { InfoPanel } from "./InfoPanels";
import { closeConnectDialog, useConnectUi } from "./open";
import { binanceMarketOf, SERVICES, type ServiceId } from "./services";
import { BN, TV } from "./strings";
import { TradingViewWizard } from "./TradingViewWizard";

function titleOf(id: ServiceId): string {
  const market = binanceMarketOf(id);
  if (market) return BN.title(market);
  if (id === "tradingview") return TV.title;
  return SERVICES[id].name;
}

/**
 * The connection dialog (Paket Verbindungen): one Sheet for every service. `ConnectMount` (DeferredHosts) loads this
 * chunk the first time something was opened. The body is remounted per opening (`key = seq`), so a closed dialog never
 * keeps a typed secret or a half-done step.
 */
export default function ConnectHost() {
  const service = useConnectUi((s) => s.service);
  const seq = useConnectUi((s) => s.seq);
  // the last service stays on screen while the sheet closes (adjusted during render, no ref read)
  const [last, setLast] = useState<ServiceId>("cloud");
  if (service && service !== last) setLast(service);
  const id = service ?? last;
  const market = binanceMarketOf(id);
  // a service the operator has not set up gets the explanation, never a wizard that would fail at the end
  const notSetUp = useServiceView(id).state === "unconfigured";
  return (
    <Sheet open={service !== null} onClose={closeConnectDialog} title={titleOf(id)} size="md" dismissGuard={false}>
      <div data-testid="connect-dialog" data-service={id}>
        <StaggerItem key={`${id}-${seq}`}>
          {notSetUp ? (
            <InfoPanel id={id} onClose={closeConnectDialog} />
          ) : market ? (
            <BinanceWizard id={id} onClose={closeConnectDialog} />
          ) : id === "tradingview" ? (
            <TradingViewWizard onClose={closeConnectDialog} />
          ) : (
            <InfoPanel id={id} onClose={closeConnectDialog} />
          )}
        </StaggerItem>
      </div>
    </Sheet>
  );
}
