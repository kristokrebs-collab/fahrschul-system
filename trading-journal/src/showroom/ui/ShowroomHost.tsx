/**
 * The Showroom's UI host (Paket S) – ONE lazy chunk, mounted by `App` only in a build with the flag:
 *   - the "Neu in dieser Version" panel (closable; a pill brings it back) with a jump button per new thing,
 *   - the simulated hosted payment page (`DemoCheckout`) or Customer Portal when the order hands over to "Stripe",
 *   - the mail knob "Bestätigungslink simulieren" while the sign-in sheet waits for a mail,
 *   - the return note ("Demo: Tarif aktiv …") after the simulated payment page, and the "after the reset" step (the registration jump).
 * Its stylesheet (`showroom.css`) belongs to this chunk – the app's own CSS is untouched.
 */
import { useEffect, useRef } from "react";
import { useCloudSession, openAuthSheet } from "@/cloud/session";
import { useIntroSettled } from "@/intro/introStore";
import { pushToast } from "@/store/uiStore";
import { DEMO_ACCOUNT } from "../mock/backend";
import { arrival, getBackend, setPanelOpen, useShowroom } from "../runtime";
import { resetShowroom, savePersisted, takeAfter } from "../seed";
import { DemoCheckout } from "./DemoCheckout";
import { JUMP_LIST, JUMPS, type JumpId } from "./jumps";
import "./showroom.css";

const OUTCOME_NOTE: Record<string, { title: string; detail: string }> = {
  active: { title: "Demo: Tarif aktiv (simuliert)", detail: "Der Mock-Server hat die Bestellung bestätigt – es wurde nichts bezahlt." },
  trialing: { title: "Demo: Tarif aktiv (simuliert)", detail: "Der Mock-Server hat die Bestellung bestätigt – es wurde nichts bezahlt." },
  incomplete: { title: "Demo: Zahlung wartet auf Bestätigung (simuliert)", detail: "So sähe ein offener 3-D-Secure-Schritt aus – nichts wurde bezahlt." },
  unpaid: { title: "Demo: Zahlung fehlgeschlagen (simuliert)", detail: "Fehlerfall der Demo – es wurde nichts berechnet." },
  never: { title: "Demo: Bestätigung steht aus (simuliert)", detail: "Der Mock-Server meldet sich nicht – die Ergebnisseite bleibt ehrlich bei „in Bearbeitung“." },
};

/** Leaves for `url`: the mock's own return address (same site), or the portal's "back". The state is saved first (the page unloads). */
function leave(url: string): void {
  savePersisted(getBackend().persisted());
  location.assign(url);
}

function Panel() {
  const open = useShowroom((s) => s.panelOpen);
  const email = useCloudSession((s) => (s.phase === "signedIn" ? s.user?.email : null));
  const run = (id: JumpId) => {
    // the panel steps aside (not remembered): the target is what the jump is about
    useShowroom.setState({ panelOpen: false });
    void Promise.resolve(JUMPS[id]()).catch(() => pushToast({ kind: "error", title: "Sprung nicht möglich", detail: "Das Ziel ließ sich nicht öffnen." }));
  };
  if (!open) {
    return (
      <button type="button" className="sr-pill" onClick={() => setPanelOpen(true)} data-testid="sr-open">
        Neu in dieser Version
      </button>
    );
  }
  const demo = email === DEMO_ACCOUNT.email ? "Demo-Konto Premium" : null;
  return (
    <section className="sr-panel" aria-label="Neu in dieser Version" data-testid="sr-panel">
      <div className="sr-head">
        <h2>Neu in dieser Version</h2>
        <button type="button" className="sr-x" onClick={() => setPanelOpen(false)} aria-label="Panel schließen" data-testid="sr-close">
          ×
        </button>
      </div>
      <p className="sr-state" data-testid="sr-state">
        {email ? (
          <>
            Angemeldet: <strong>{email}</strong>
            {demo ? ` (${demo} – keine echte Person)` : " (neues Demo-Konto)"}
          </>
        ) : (
          <>Nicht angemeldet – Demo-Daten, keine echten Konten oder Zahlungen.</>
        )}
      </p>
      <ul className="sr-list">
        {JUMP_LIST.map((j) => (
          <li key={j.id}>
            <button type="button" className="sr-jump" onClick={() => run(j.id)} data-testid={`sr-jump-${j.id}`}>
              {j.label}
              <small>{j.hint}</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="sr-foot">
        Demo-Zugang: <code>{DEMO_ACCOUNT.email}</code> · Passwort <code>{DEMO_ACCOUNT.password}</code>. Alles hier läuft gegen einen
        Mock im Browser: kein Supabase, kein Stripe, keine Börse, keine KI.
      </p>
      <button type="button" className="sr-reset" onClick={() => resetShowroom({ journal: "demo", signedIn: true })} data-testid="sr-reset">
        Demo zurücksetzen
      </button>
    </section>
  );
}

/** While the sheet waits for a mail: the knob that "clicks" the link of the mail the mock recorded. */
function MailKnob() {
  const sheet = useCloudSession((s) => s.sheet);
  useShowroom((s) => s.mailTick);
  if (!sheet.open || sheet.view !== "sent") return null;
  const mails = getBackend().sb.mails.filter((m) => !m.opened);
  const mail = [...mails].reverse().find((m) => m.email === sheet.email.trim().toLowerCase()) ?? mails.at(-1);
  if (!mail) return null;
  const label = mail.kind === "confirm" ? "Bestätigungslink simulieren" : mail.kind === "magic" ? "Anmelde-Link simulieren" : "Reset-Link simulieren";
  const click = () => {
    const hit = getBackend().sb.openMail(mail.id);
    if (hit) leave(hit.url);
  };
  return (
    <div className="sr-knob" role="status" aria-live="polite" data-testid="sr-mail-knob">
      <b>Demo · keine echte Mail</b>
      <span>
        Im echten Betrieb käme jetzt eine Mail an {mail.email}. Hier gibt es keine – dieser Knopf öffnet den Link, den die Mail enthielte.
      </span>
      <button type="button" onClick={click} data-testid="sr-mail-open">
        {label}
      </button>
    </div>
  );
}

function Hosted() {
  const hosted = useShowroom((s) => s.hosted);
  if (!hosted) return null;
  if (hosted.kind === "checkout") return <DemoCheckout onLeave={leave} />;
  const back = new URL(hosted.url).searchParams.get("return") ?? `${location.origin}/`;
  return (
    <div className="sr-pay" role="dialog" aria-modal="true" aria-label="Kundenportal (Demo)" data-testid="demo-portal">
      <div className="sr-pay-bar">
        <b>Demo-Kundenportal</b>
        <span>kein Stripe · hier ließe sich ein Abo verwalten – nichts wird gespeichert oder gesendet</span>
      </div>
      <div className="sr-auth">
        <h2>Kundenportal (Demo)</h2>
        <p>Im echten Betrieb öffnet sich hier Stripes eigenes Kundenportal. Die Demo zeigt nur den Rückweg.</p>
        <button type="button" className="sr-primary" style={{ padding: "0 26px" }} onClick={() => leave(back)} data-testid="demo-portal-back">
          Zurück zum Journal
        </button>
      </div>
    </div>
  );
}

/** One-shot work after a page load: the note after the simulated payment page, the sign-up sheet after the registration reset. */
function Arrivals() {
  const settled = useIntroSettled();
  const done = useRef(false);
  useEffect(() => {
    if (!settled || done.current) return;
    done.current = true;
    // the Stripe return params are removed by the billing host: `install.ts` read them before the app booted
    const ret = arrival.billing;
    if (ret === "success") {
      const saved = (() => {
        try {
          return sessionStorage.getItem("tj2-showroom-outcome");
        } catch {
          return null;
        }
      })();
      const note = OUTCOME_NOTE[saved ?? "active"] ?? OUTCOME_NOTE.active!;
      pushToast({ kind: "info", title: note.title, detail: note.detail });
    } else if (ret === "cancel") {
      pushToast({ kind: "info", title: "Demo: Bestellung abgebrochen", detail: "Nichts wurde berechnet und kein Vertrag geschlossen (simuliert)." });
    }
    const after = takeAfter();
    if (after === "register") openAuthSheet("signup", "card");
    else if (after === "signin") openAuthSheet("signin", "card");
  }, [settled]);
  return null;
}

export default function ShowroomHost() {
  return (
    <>
      <Arrivals />
      <Panel />
      <MailKnob />
      <Hosted />
    </>
  );
}
