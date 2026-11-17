/**
 * The jump buttons of the "Neu in dieser Version" panel (Paket S): each one really takes the visitor to the thing – through the app's own routes
 * (`openFeature`, `navigate`, `requestOrder`, `openWizard`, `openAuthSheet`), never through a copy of the screen. A button whose target needs
 * another account first (a gated page, a Free account for the order window) signs in as the right DEMO account and says so in a toast.
 */
import { openFeature } from "@/app/featureOpen";
import { revealCard, whenShown } from "@/app/reveal";
import { entitledNow } from "@/billing/entitlements";
import { loadBilling, requestOrder } from "@/billing/store";
import { ensureCloud, signOut } from "@/cloud/runtime";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { openWizard } from "@/onboarding/wizard/wizardStore";
import { navigate } from "@/store/router";
import { pushToast } from "@/store/uiStore";
import { DEMO_ACCOUNT } from "../mock/backend";
import { getBackend } from "../runtime";
import { resetShowroom } from "../seed";

export type JumpId = "signin" | "signup" | "order" | "flip" | "voice" | "week" | "wizard" | "share" | "motion";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls `find` (≤ `ms`) until it returns something. */
async function until<T>(find: () => T | null | undefined, ms = 12_000): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = find();
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(120);
  }
}

const emailNow = (): string | null => {
  const s = useCloudSession.getState();
  return s.phase === "signedIn" ? (s.user?.email ?? null) : null;
};

/** Signs in as one of the demo accounts (a different one is signed out first). Resolves true when the account is in. */
async function signInDemo(account: { email: string; password: string }): Promise<boolean> {
  if (emailNow() === account.email) return true;
  if (emailNow()) await signOut("local");
  const m = await ensureCloud();
  const r = await m.signInPassword(account.email, account.password);
  if (!r.ok) {
    pushToast({ kind: "error", title: "Demo-Konto nicht angemeldet", detail: r.message });
    return false;
  }
  await until(() => useCloudSession.getState().phase === "signedIn" && !useCloudSession.getState().needsMfa, 6000);
  return true;
}

/** Gives the current account the Premium demo plan when it does not include `feature`; signed out: the Premium demo account signs in. No account switch (a device that
 * changes accounts is asked about its journal – real product behaviour, but not what a jump should stumble over). */
async function ensureEntitled(feature: Parameters<typeof entitledNow>[0]): Promise<void> {
  if (!emailNow()) await signInDemo(DEMO_ACCOUNT);
  await loadBilling().catch(() => null);
  if (entitledNow(feature)) return;
  const id = useCloudSession.getState().user?.id;
  if (!id) return;
  getBackend().billing.setAccount(id, "premium");
  await loadBilling().catch(() => null);
  pushToast({ kind: "info", title: "Demo: Premium für dieses Konto", detail: "Diese Ansicht gehört zu einem bezahlten Tarif – das Demo-Konto bekommt Premium (nur im Mock, es wurde nichts bezahlt)." });
}

export const JUMPS: Record<JumpId, () => Promise<void> | void> = {
  signin: async () => {
    if (emailNow()) await signOut("local");
    openAuthSheet("signin", "card");
    const s = useCloudSession.getState();
    useCloudSession.setState({ sheet: { ...s.sheet, email: DEMO_ACCOUNT.email } });
  },
  signup: async () => {
    if (emailNow()) await signOut("local");
    // a fresh registration starts on an EMPTY journal (a journal with trades is an "existing trader": no wizard) – the demo journal can be reloaded
    resetShowroom({ journal: "empty", signedIn: false }, "register");
  },
  order: async () => {
    // the order window sells Premium: it needs an account without it – the signed-in account (or the demo account) is set to Free first (mock only)
    if (!emailNow()) await signInDemo(DEMO_ACCOUNT);
    const id = useCloudSession.getState().user?.id;
    if (id) getBackend().billing.setAccount(id, "free");
    await loadBilling().catch(() => null);
    requestOrder({ plan: "premium", interval: "year" });
  },
  flip: () => {
    openFeature("top-trader-netto-karte", { remember: false });
  },
  voice: async () => {
    await ensureEntitled("coachAi");
    openFeature("coach-fragen", { remember: false });
    // ask the first suggested question and press "Mit KI formulieren": "Coach denkt …" while the (demo) answer is on its way
    const chip = await until(() => document.querySelector<HTMLElement>('[data-testid="coach-chat"] [data-testid="coach-chip"]'));
    chip?.click();
    const ai = await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="coach-ai"] button')).find((b) => /KI formulieren/.test(b.textContent ?? "")));
    ai?.scrollIntoView({ block: "center", behavior: "smooth" });
    ai?.click();
  },
  week: async () => {
    await ensureEntitled("reports");
    navigate("berichte");
    whenShown(
      "berichte",
      (layer) => layer.querySelector<HTMLElement>('[data-testid="week-close"]'),
      (el) => revealCard(el),
      () => pushToast({ kind: "info", title: "Wochenabschluss nicht gefunden", detail: "Die Karte steht unter Berichte." }),
      10_000,
    );
  },
  wizard: () => openWizard(false),
  share: async () => {
    await ensureEntitled("reports");
    openFeature("teilen-faecher", { remember: false });
  },
  motion: () => {
    openFeature("bewegung", { remember: false });
  },
};

export const JUMP_LIST: ReadonlyArray<{ id: JumpId; label: string; hint: string }> = [
  { id: "signin", label: "Anmelden", hint: "Anmelde-Blatt (Demo-Zugang unten)" },
  { id: "signup", label: "Registrieren", hint: "Neues Demo-Konto → simulierter Mail-Link → Einrichtung" },
  { id: "order", label: "Bezahlfenster · Premium jährlich", hint: "Bestellung → Demo-Zahlungsseite mit Demo-Karte" },
  { id: "flip", label: "Markt › Top-Trader-Karte", hint: "„Was ist ein Flip?“ über dem Top-Trader-Chart (echte Binance-Daten)" },
  { id: "voice", label: "Coach › Mit KI formulieren", hint: "Frage stellen, „Mit KI formulieren“ → „Coach denkt …“, dann die Demo-Fassung" },
  { id: "week", label: "Berichte › Wochenabschluss", hint: "Verhalten der Woche, eine Lektion für morgen" },
  { id: "wizard", label: "Einrichtungs-Wizard", hint: "Vier kurze Schritte" },
  { id: "share", label: "Teilen-Fächer", hint: "Berichte › Export › Weitergeben" },
  { id: "motion", label: "Einstellungen › Bewegung", hint: "Reduzieren, Vorschau, Prozess-Rückmeldung" },
];
