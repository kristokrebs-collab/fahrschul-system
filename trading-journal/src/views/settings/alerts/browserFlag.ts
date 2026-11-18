/**
 * "The browser channel is on" as a flag of THIS browser, so the app shell knows – without loading the settings card or asking the server –
 * whether to fetch the small host that picks up browser alerts (`AlertFeedHost`). The settings card sets it when it saves; the truth stays on
 * the server (a deleted flag only means the host is not fetched until the card is opened again).
 */
import { useSyncExternalStore } from "react";
import { storageKey } from "@/store/storage";

const KEY = storageKey("alerts-browser");
const EVENT = "tj2-alerts-browser";

export function browserAlertsOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setBrowserAlertsOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: the host simply does not start by itself */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export const useBrowserAlertsOn = (): boolean => useSyncExternalStore(subscribe, browserAlertsOn, () => false);
