/**
 * Showroom runtime state shared by the installer (`install.ts`) and the lazy UI (`ui/*`): the backend, the page the simulated "Stripe" is showing,
 * the panel's open flag (closed until the visitor opens it). A light zustand store; nothing here touches the network.
 */
import { create } from "zustand";
import type { Backend } from "./mock/backend";

export interface HostedPage {
  kind: "checkout" | "portal";
  /** the address the app was about to leave for (a stripe.com URL of the mock); only its path / query is read */
  url: string;
}

export interface ShowroomState {
  hosted: HostedPage | null;
  panelOpen: boolean;
  /** bumps whenever the mock mailbox changes (the "Link simulieren" knob re-reads it) */
  mailTick: number;
}

const PANEL_KEY = "tj2-showroom-panel";

/** The panel never opens by itself: only a click on its pill opens it (and the choice is remembered). */
function readPanel(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === "open";
  } catch {
    return false;
  }
}

export const useShowroom = create<ShowroomState>(() => ({ hosted: null, panelOpen: readPanel(), mailTick: 0 }));

export function setPanelOpen(open: boolean): void {
  useShowroom.setState({ panelOpen: open });
  try {
    localStorage.setItem(PANEL_KEY, open ? "open" : "closed");
  } catch {
    /* storage blocked – the panel just opens again next time */
  }
}

let backend: Backend | null = null;
export const setBackend = (b: Backend | null): void => {
  backend = b;
};
export function getBackend(): Backend {
  if (!backend) throw new Error("Showroom nicht installiert");
  return backend;
}
export const hasBackend = (): boolean => backend !== null;

/** Requests the page refused (a host of a mocked service the Showroom has no answer for) – the tests assert that no account, payment or AI host was reached. */
export const netLog = { refused: [] as string[] };

/** What the page was opened with (read once, before the app boots and its hosts remove the params): the Stripe return of the simulated payment page. */
export const arrival: { billing: string | null } = { billing: null };
