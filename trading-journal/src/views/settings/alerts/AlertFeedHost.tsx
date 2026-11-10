/**
 * The browser channel of the four alarms: while the app is open and the flag says the channel is on, ask the server once a minute (only while
 * the page is visible) for browser alerts that are waiting, show each as a toast – and as a system notification when the user allowed them and the
 * page is not in front – and acknowledge them so they are shown once. Mounted lazily by `DeferredHosts`; renders nothing.
 * An alert is a pointer to a rule the user set up; the text says what happened and that it is no advice.
 */
import { useEffect } from "react";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { ALERT_EVENT_LABEL } from "@/domain/alerts/types";
import { pushToast } from "@/store/uiStore";
import { ackBrowser, fetchFeed } from "./api";
import type { BrowserItem } from "./model";

const POLL_MS = 60_000;
/** the toast stays a little longer than a signal toast: nobody is looking at the app at the moment it fires */
const TOAST_MS = 8000;

export function notifyBrowser(item: Pick<BrowserItem, "event" | "market" | "detail">): void {
  const title = `${ALERT_EVENT_LABEL.de[item.event]} · ${item.market}`;
  const detail = `${item.detail ? `${item.detail} · ` : ""}Das ist keine Beratung.`;
  pushToast({ kind: "signal", title, detail, duration: TOAST_MS });
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && typeof document !== "undefined" && document.hidden) new Notification(title, { body: detail, tag: `alert-${item.event}-${item.market}` });
  } catch {
    /* some mobile browsers only allow notifications from a service worker – the toast is there */
  }
}

export default function AlertFeedHost() {
  const signedIn = useCloudSession((s) => s.phase === "signedIn" && !s.needsMfa);
  useEffect(() => {
    if (!cloudEnabled() || !signedIn) return;
    const ctrl = new AbortController();
    let busy = false;
    const look = async (): Promise<void> => {
      if (busy || (typeof document !== "undefined" && document.hidden)) return;
      busy = true;
      try {
        const feed = await fetchFeed(ctrl.signal);
        if (ctrl.signal.aborted || !feed.browser.length) return;
        // acknowledge FIRST: a lost answer then shows nothing twice instead of everything again
        await ackBrowser(feed.browser.map((b) => b.deliveryId));
        for (const b of feed.browser.slice(0, 5)) notifyBrowser(b);
      } catch {
        /* offline or the server is down: the next look tries again */
      } finally {
        busy = false;
      }
    };
    void look();
    const t = setInterval(() => void look(), POLL_MS);
    const vis = (): void => void look();
    document.addEventListener("visibilitychange", vis);
    return () => {
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [signedIn]);
  return null;
}
