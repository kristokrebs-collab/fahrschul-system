/**
 * The card fields of the payment window (Paket V) behind one small interface, so the window does not care WHO draws them:
 *
 * - `stripe`: Stripe Elements (`cardNumber`, `cardExpiry`, `cardCvc` – three separate iframes, so each field reports its own focus),
 *   loaded lazily with `@stripe/stripe-js` only when the window opens. The card number never passes through our code: Stripe tells us
 *   only `empty` / `complete` / `brand` / an error, and confirms the payment itself (`confirmCardSetup` / `confirmCardPayment`, 3-D
 *   Secure included).
 * - `demo`: the same window with plain demo inputs, clearly marked – ONLY in the dev server and where a build registers it
 *   (`registerDemoFields`); the production build does not contain it.
 * - `redirect`: no publishable key (or Stripe Tax on, which needs Stripe's own address form): the window shows the order and its button
 *   hands over to Stripe Checkout as before.
 */

export type CardFieldKind = "number" | "expiry" | "cvc";

export interface CardFieldState {
  empty: boolean;
  complete: boolean;
  /** Stripe's own (localised) message of an invalid entry, else null. */
  error: string | null;
}

export interface CardFieldHandlers {
  change(kind: CardFieldKind, state: CardFieldState, brand?: string | null): void;
  focus(kind: CardFieldKind): void;
  blur(kind: CardFieldKind): void;
}

/** The look of the text inside the fields (Stripe's iframes cannot read our CSS variables: computed values are passed in). */
export interface CardFieldStyle {
  color: string;
  placeholder: string;
  danger: string;
  fontFamily: string;
  fontSize: string;
}

export type ConfirmOutcome = { ok: true; intentId: string } | { ok: false; code: string; message: string; field: CardFieldKind | null };

export interface CardFields {
  readonly source: "stripe" | "demo";
  mount(targets: Record<CardFieldKind, HTMLElement>, on: CardFieldHandlers, style: CardFieldStyle): void;
  restyle(style: CardFieldStyle): void;
  focus(kind: CardFieldKind): void;
  /** Confirms the intent the server made (`setup` = trial: save the card; `payment` = pay the first invoice). */
  confirm(kind: "setup" | "payment", clientSecret: string, billing: { name: string }): Promise<ConfirmOutcome>;
  destroy(): void;
}

export type CardFieldsLoader = () => Promise<CardFields>;

let demoLoader: CardFieldsLoader | null = null;

/** A build that wants the demo fields registers them (the dev server below; never the production build). */
export function registerDemoFields(loader: CardFieldsLoader | null): void {
  demoLoader = loader;
}

if (import.meta.env.DEV) registerDemoFields(() => import("./demoFields").then((m) => m.createDemoFields()));

/** The publishable key of the build, or null. Only `pk_test_…` / `pk_live_…` count: anything else is not used (the build guard refuses secret keys). */
export function stripeKey(raw: string | undefined = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY): string | null {
  const k = raw?.trim() ?? "";
  return /^pk_(test|live)_[A-Za-z0-9]{10,}$/.test(k) ? k : null;
}

export type FieldSource = "stripe" | "demo" | "redirect";

/** Which fields the window shows: Stripe with a key (and without Stripe Tax), else the demo where registered, else the hand-over to Checkout. */
export function fieldSource(opts: { automaticTax: boolean; key?: string | null; demo?: boolean }): FieldSource {
  if (opts.automaticTax) return "redirect";
  if (opts.key ?? stripeKey()) return "stripe";
  return (opts.demo ?? demoLoader !== null) ? "demo" : "redirect";
}

export function loadFields(source: Exclude<FieldSource, "redirect">): Promise<CardFields> {
  if (source === "demo") {
    if (!demoLoader) return Promise.reject(new Error("no demo fields"));
    return demoLoader();
  }
  const key = stripeKey();
  if (!key) return Promise.reject(new Error("no publishable key"));
  return import("./stripeFields").then((m) => m.createStripeFields(key));
}
