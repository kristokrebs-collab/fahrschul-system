import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { openConnect } from "@/exchanges/store";
import { Button } from "@/primitives/Button";
import { navigate } from "@/store/router";
import { PartnerBox } from "./PartnerBox";
import { useServiceView } from "./facts";
import type { ServiceId } from "./services";
import { SERVICES } from "./services";
import { OTHER } from "./strings";

/**
 * Dialog bodies of the connections that are not a guided key / address flow: Bitunix (hands over to the existing
 * exchange dialog), the e-mail alarm (switch lives at the alarms), the telephone alarm (not set up), the cloud account.
 * A service the operator has not set up always says so first.
 */
export function InfoPanel({ id, onClose }: { id: ServiceId; onClose: () => void }) {
  const view = useServiceView(id);
  const def = SERVICES[id];
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  let lead: string = def.what;
  let action: { label: string; run: () => void } | null = null;

  if (view.state === "unconfigured") {
    lead = id === "alert-phone" ? OTHER.phoneLead : OTHER.unconfigured;
  } else if (id === "bitunix") {
    lead = OTHER.bitunixLead;
    action = {
      label: view.state === "connected" ? OTHER.bitunixManage : OTHER.bitunixOpen,
      run: () => {
        onClose();
        if (view.state === "connected") navigate("konto");
        else openConnect();
      },
    };
  } else if (id === "alert-email") {
    lead = OTHER.emailLead;
    action = {
      label: OTHER.emailOpen,
      run: () => {
        onClose();
        navigate("markt");
      },
    };
  } else if (id === "cloud") {
    lead = OTHER.cloudLead;
    action = signedIn
      ? {
          label: OTHER.cloudAccount,
          run: () => {
            onClose();
            navigate("konto");
          },
        }
      : { label: OTHER.cloudSignIn, run: () => openAuthSheet("signin", "card") };
  }

  return (
    <div className="grid gap-4" data-testid="connect-info" data-service={id} data-state={view.state}>
      <p className="text-[13px] leading-relaxed text-mute">{lead}</p>
      <p className="cx-panel px-3 py-2 text-[12.5px] text-fg" data-testid="connect-info-state">
        {view.line}
      </p>
      {action && (
        <Button variant="primary" fx={false} className="justify-self-start" onClick={action.run} data-testid="connect-info-action">
          {action.label}
        </Button>
      )}
      {def.partner && view.state !== "connected" && <PartnerBox partner={def.partner} />}
    </div>
  );
}
