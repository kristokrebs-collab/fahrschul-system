/**
 * Which connection dialog is open (Paket Verbindungen). Tiny on purpose: the placeholders call `openConnectDialog`, the
 * app host (`DeferredHosts` → `ConnectMount`) loads the dialog chunk the first time something was opened.
 */
import { create } from "zustand";
import type { ServiceId } from "./services";

export interface ConnectUi {
  service: ServiceId | null;
  /** Counts opens: the host loads its chunk once `seq > 0` and then stays mounted (close animation). */
  seq: number;
}

export const useConnectUi = create<ConnectUi>()(() => ({ service: null, seq: 0 }));

export function openConnectDialog(service: ServiceId): void {
  useConnectUi.setState((s) => ({ service, seq: s.seq + 1 }));
}

export function closeConnectDialog(): void {
  useConnectUi.setState({ service: null });
}
