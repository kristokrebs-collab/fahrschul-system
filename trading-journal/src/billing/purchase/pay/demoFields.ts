/**
 * DEMO card fields of the payment window (Paket V) – the same window without Stripe: three plain inputs in place of Stripe's iframes,
 * clearly marked "Demo". ONLY in the dev server (`fields.ts`, behind `import.meta.env.DEV`) and in builds that register it
 * themselves; the production build does not contain this module (the production-bundle guard test scans `dist/` for its marker
 * `tj-demo-card`).
 *
 * To keep real cards out even here, only Stripe's public TEST numbers are accepted (4242 4242 4242 4242 and friends); anything else is
 * refused at the field. The window gets exactly what Stripe would give it – `empty` / `complete` / `brand`, never the digits – and the
 * confirmation sends only a verdict ("ok" / "declined" / "funds") to the demo server, never a number.
 */
import { apiFetch, ApiError } from "@/cloud/api";
import type { CardFieldHandlers, CardFieldKind, CardFields, CardFieldStyle, ConfirmOutcome } from "./fields";

export const DEMO_MARK = "tj-demo-card";

/** Stripe's public test numbers and what the demo makes of them. */
export const DEMO_CARDS: Readonly<Record<string, "ok" | "declined" | "funds" | "unpaid">> = {
  "4242424242424242": "ok",
  "5555555555554444": "ok",
  "4000002760003184": "ok",
  "4000000000000002": "declined",
  "4000000000009995": "funds",
  "4000000000000341": "unpaid",
};

const digits = (v: string, max: number): string => v.replace(/\D/g, "").slice(0, max);
export const groupNumber = (v: string): string => (digits(v, 16).match(/.{1,4}/g) ?? []).join(" ");
export const groupExpiry = (v: string): string => {
  const d = digits(v, 4);
  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
};
export const brandOf = (d: string): string => (d.startsWith("4") ? "visa" : /^(5[1-5]|2[2-7])/.test(d) ? "mastercard" : /^3[47]/.test(d) ? "amex" : "unknown");

function expiryOk(d: string, now = new Date()): boolean {
  if (d.length !== 4) return false;
  const m = Number(d.slice(0, 2));
  const y = 2000 + Number(d.slice(2));
  if (m < 1 || m > 12) return false;
  return y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1);
}

const PLACEHOLDER: Record<CardFieldKind, string> = { number: "4242 4242 4242 4242", expiry: "MM / JJ", cvc: "•••" };
const LABEL: Record<CardFieldKind, string> = { number: "Kartennummer (Demo)", expiry: "Gültig bis (Demo)", cvc: "Prüfziffer (Demo)" };

export function createDemoFields(): Promise<CardFields> {
  const inputs: Partial<Record<CardFieldKind, HTMLInputElement>> = {};
  let verdict: "ok" | "declined" | "funds" | "unpaid" | null = null;
  const apply = (el: HTMLInputElement, s: CardFieldStyle) => {
    Object.assign(el.style, { color: s.color, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: "500", letterSpacing: "0.04em", background: "transparent", border: "0", outline: "none", width: "100%", height: "100%", padding: "0", caretColor: s.color });
    el.style.setProperty("--demo-placeholder", s.placeholder);
  };
  const fields: CardFields = {
    source: "demo",
    mount(targets, on: CardFieldHandlers, style) {
      (Object.keys(targets) as CardFieldKind[]).forEach((kind) => {
        const el = document.createElement("input");
        el.type = "text";
        el.inputMode = "numeric";
        el.autocomplete = "off";
        el.spellcheck = false;
        el.placeholder = PLACEHOLDER[kind];
        el.setAttribute("aria-label", LABEL[kind]);
        el.dataset.testid = `demo-${kind}`;
        el.className = DEMO_MARK;
        apply(el, style);
        el.addEventListener("focus", () => on.focus(kind));
        el.addEventListener("blur", () => on.blur(kind));
        el.addEventListener("input", () => {
          if (kind === "number") {
            el.value = groupNumber(el.value);
            const d = digits(el.value, 16);
            const known = DEMO_CARDS[d];
            verdict = known ?? null;
            const error = d.length === 16 && !known ? "Demo: nur Testkarten, z. B. 4242 4242 4242 4242." : null;
            on.change("number", { empty: d.length === 0, complete: !!known, error }, d.length ? brandOf(d) : "unknown");
          } else if (kind === "expiry") {
            el.value = groupExpiry(el.value);
            const d = digits(el.value, 4);
            on.change("expiry", { empty: !d.length, complete: expiryOk(d), error: d.length === 4 && !expiryOk(d) ? "Das Ablaufdatum liegt in der Vergangenheit." : null });
          } else {
            el.value = digits(el.value, 3);
            on.change("cvc", { empty: !el.value.length, complete: el.value.length === 3, error: null });
          }
        });
        targets[kind].replaceChildren(el);
        inputs[kind] = el;
      });
    },
    restyle(style) {
      for (const el of Object.values(inputs)) if (el) apply(el, style);
    },
    focus(kind) {
      inputs[kind]?.focus();
    },
    async confirm(kind, clientSecret): Promise<ConfirmOutcome> {
      // only the verdict travels – the demo server never sees a number
      try {
        const r = await apiFetch<{ intentId: string }>("/billing/demo-confirm", { method: "POST", body: { clientSecret, kind, verdict: verdict ?? "declined" } });
        return { ok: true, intentId: r.intentId };
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "demo_failed";
        const message = e instanceof ApiError ? e.message : "Die Demo-Zahlung ging nicht durch.";
        return { ok: false, code, message, field: code === "card_declined" || code === "insufficient_funds" ? "number" : null };
      }
    },
    destroy() {
      for (const el of Object.values(inputs)) {
        if (!el) continue;
        el.value = "";
        el.remove();
      }
    },
  };
  return Promise.resolve(fields);
}
