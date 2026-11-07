/**
 * The "Benachrichtigungen" group of the settings page: one folded row ("Alarme") that opens the alarm card. The card is its own chunk and is
 * fetched only when the fold is opened (by a tap, or by a jump from the function finder), so the settings page does not get heavier. The group sits
 * BELOW the settings form on purpose: it has its own save button and its own buttons (a form inside the form would be invalid HTML, and Enter in one of its fields must not
 * save the page's settings).
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Fold } from "@/primitives/Fold";
import { Skeleton } from "@/primitives/Skeleton";
import { SettingsGroup } from "../SettingsGroup";

const AlertSettingsCard = lazy(() => import("./AlertSettingsCard"));

export const ALERTS_GROUP = { section: "s-alarme", title: "Benachrichtigungen", sub: "Die vier Alarme per Browser, E-Mail und Telefon – und was davon bei dir angekommen ist." } as const;

/** Renders `children` once the surrounding `details` has been open (now or later); never before. */
function WhenOpen({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const d = ref.current?.closest("details");
    if (!d) return setSeen(true);
    if (d.open) setSeen(true);
    const on = (): void => {
      if (d.open) setSeen(true);
    };
    d.addEventListener("toggle", on);
    return () => d.removeEventListener("toggle", on);
  }, []);
  return (
    <div ref={ref} className="min-h-12">
      {seen ? children : null}
    </div>
  );
}

export function AlertsGroup() {
  return (
    <SettingsGroup section={ALERTS_GROUP.section} title={ALERTS_GROUP.title} sub={ALERTS_GROUP.sub} className="mt-5 lg:grid-cols-1">
      <Fold id="settings-alarme" title="Alarme" hint="Grün- und Rot-Vorwarnung und -Bestätigung per Browser, E-Mail und Telefon, mit Ruhezeit und Zustellprotokoll" className="lg:col-span-1">
        <WhenOpen>
          <Suspense
            fallback={
              <div className="rounded-2xl border border-line p-5" data-testid="alerts-settings-loading">
                <Skeleton className="h-64" />
                <span className="sr-only">Lade …</span>
              </div>
            }
          >
            <AlertSettingsCard />
          </Suspense>
        </WhenOpen>
      </Fold>
    </SettingsGroup>
  );
}
