/**
 * Client error reporting (P09): `reportError(error, ctx)` → POST `/api/v1/log`, only
 * - when the cloud is available (the function exists) AND
 * - the user opted in to telemetry (PrivacyCard, default OFF).
 * Scrubbed before it leaves the browser (`scrub.ts`; the function scrubs again), de-duplicated per fingerprint, at most
 * `MAX_REPORTS` per page session, never re-entrant, never throws. `installErrorReporting()` wires `window.onerror` /
 * `unhandledrejection` (the P13 ErrorBoundary calls `reportError` with `source: "boundary"`).
 */
import { EDITION } from "@/edition";
import { apiFetch } from "./api";
import { cloudEnabled } from "./env";
import { readPrivacy } from "./privacy";
import { errorFingerprint, scrubExtra, scrubStack, scrubText, scrubUrl } from "./scrub";

export interface ErrorContext {
  /** Where it was caught. */
  source?: "boundary" | "window" | "promise" | "manual";
  /** React component stack (ErrorBoundary). */
  componentStack?: string;
  /** Extra, non-personal data (no trade values, no notes). */
  extra?: Record<string, unknown>;
}

export interface ErrorReport {
  message: string;
  stack: string | null;
  url: string | null;
  release: string;
  edition: "personal" | "share";
  source: NonNullable<ErrorContext["source"]>;
  fingerprint: string;
  extra: Record<string, unknown>;
}

export const MAX_REPORTS = 5;
export const RELEASE = "0.1.0";

/** Noise that is not ours (extensions, cross-origin "Script error.", benign observer loops). */
const IGNORE = [/^Script error\.?$/i, /ResizeObserver loop/i, /chrome-extension:|moz-extension:|safari-extension:/i, /^AbortError\b/];

const sent = new Set<string>();
let count = 0;
let inside = false;

type Sender = (report: ErrorReport) => Promise<unknown>;

const defaultSender: Sender = (report) => apiFetch("/log", { method: "POST", body: report, keepalive: true });
let sender: Sender = defaultSender;

/** Tests: replace the transport (`null` restores it) and forget what was sent. */
export function setReportSenderForTests(fn: Sender | null): void {
  sender = fn ?? defaultSender;
  sent.clear();
  count = 0;
}

function messageOf(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error)?.slice(0, 300) ?? String(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/** Builds the scrubbed report (`null` for ignored noise). Pure apart from `location`. */
export function buildReport(error: unknown, ctx: ErrorContext = {}, href: string = typeof location === "undefined" ? "" : location.href): ErrorReport | null {
  const raw = messageOf(error);
  if (IGNORE.some((re) => re.test(raw.message) || (raw.stack ? re.test(raw.stack) : false))) return null;
  const message = scrubText(raw.message, 2000);
  const stackSource = [raw.stack, ctx.componentStack ? `Component stack:${ctx.componentStack}` : null].filter(Boolean).join("\n");
  const stack = scrubStack(stackSource || null);
  return {
    message,
    stack,
    url: scrubUrl(href),
    release: RELEASE,
    edition: EDITION,
    source: ctx.source ?? "manual",
    fingerprint: errorFingerprint(message, stack),
    extra: scrubExtra(ctx.extra),
  };
}

/** Reports an error (see module doc). Never throws. */
export function reportError(error: unknown, context?: ErrorContext): void {
  if (inside) return;
  inside = true;
  try {
    if (!cloudEnabled() || !readPrivacy().telemetry) return;
    if (count >= MAX_REPORTS) return;
    const report = buildReport(error, context);
    if (!report || sent.has(report.fingerprint)) return;
    sent.add(report.fingerprint);
    count++;
    void sender(report).catch(() => undefined);
  } catch {
    /* reporting must never break the app */
  } finally {
    inside = false;
  }
}

let installed: (() => void) | null = null;

/** Installs `error` / `unhandledrejection` listeners → `reportError`; idempotent; returns the uninstaller. */
export function installErrorReporting(target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined = typeof window === "undefined" ? undefined : window): () => void {
  if (!target) return () => {};
  if (installed) return installed;
  const onError = (e: Event) => {
    const ev = e as Partial<ErrorEvent>;
    // resource load errors (img/script) arrive as plain Events without `error` / `message`
    if (ev.error == null && !ev.message) return;
    reportError(ev.error ?? ev.message, { source: "window" });
  };
  const onRejection = (e: Event) => reportError((e as PromiseRejectionEvent).reason, { source: "promise" });
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  const uninstall = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    if (installed === uninstall) installed = null;
  };
  installed = uninstall;
  return uninstall;
}
