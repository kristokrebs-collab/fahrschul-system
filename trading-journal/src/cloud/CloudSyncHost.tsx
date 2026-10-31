import { lazy, Suspense, useEffect } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { hasClaudeRuntime } from "@/store/capability";
import { pushToast } from "@/store/uiStore";
import { cloudEnabled } from "./env";
import { watchIdle } from "./idle";
import { installErrorReporting } from "./report";
import { bootCloud, ensureCloud, setSyncEntitled } from "./runtime";
import { useCloudSession } from "./session";
import { SECURITY } from "./ui/strings";

const AuthSheet = lazy(() => import("./ui/AuthSheet").then((m) => ({ default: m.AuthSheet })));

export interface CloudSyncHostProps {
  /** Opens the Konto page from the account panel (`() => navigate("konto")`). */
  onOpenAccount?: () => void;
}

/**
 * Leaf host of the cloud (P09) – mount ONCE in `App` (after `SetupEditor`, before `Celebrate`). Renders nothing
 * visible itself except the login sheet when it is open.
 * - boots the cloud: restores a stored login (lazy Supabase chunk) or settles "signed out" without loading anything;
 * - installs the error reporting (`window.onerror` / `unhandledrejection` → `reportError`, opt-in only);
 * - passes the plan gate (`useEntitlement("cloudSync")`) to the sync controller;
 * - signs out after the chosen idle time (Konto → Sicherheit);
 * - mounts the lazy `AuthSheet` from its first open on (kept mounted so the exit runs).
 * StrictMode-safe: every effect is idempotent (`bootCloud`, `installErrorReporting`, `ensureCloud`).
 * Not on claude.ai (that path keeps its own sync) and not without cloud config.
 */
export function CloudSyncHost({ onOpenAccount }: CloudSyncHostProps) {
  const enabled = cloudEnabled() && !hasClaudeRuntime();
  const entitled = useEntitlement("cloudSync");
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const mounted = useCloudSession((s) => s.sheet.mounted);

  useEffect(() => {
    if (!enabled) return;
    const uninstall = installErrorReporting();
    bootCloud();
    return uninstall;
  }, [enabled]);

  useEffect(() => {
    setSyncEntitled(entitled);
  }, [entitled]);

  useEffect(() => {
    if (!enabled || !signedIn) return;
    return watchIdle({
      onExpire: () => {
        void ensureCloud()
          .then((m) => m.signOutScope("local"))
          .then(() => pushToast({ kind: "info", title: SECURITY.idleSignedOut, detail: "Dein Journal bleibt in diesem Browser.", duration: 0 }));
      },
    });
  }, [enabled, signedIn]);

  if (!enabled || !mounted) return null;
  return (
    <div data-layer="CloudAuth">
      <Suspense fallback={null}>
        <AuthSheet onOpenAccount={onOpenAccount} />
      </Suspense>
    </div>
  );
}
