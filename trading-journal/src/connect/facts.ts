/**
 * What the app knows about each connection (Paket Verbindungen): one hook per service turns the existing stores
 * (cloud session, exchange status, TradingView status, e-mail alarm status) into `SlotFacts` plus a one-line status text.
 * Nothing is invented: a value that is not known yet is `null` / loading, never "connected".
 */
import { useEffect, useState } from "react";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { exchangeEnabled, loadExchangeStatus, useExchange } from "@/exchanges/store";
import type { ExchangeConnection, ExchangeStatus } from "@/exchanges/types";
import { hasClaudeRuntime } from "@/store/capability";
import { fetchAlertStatus, type AlertStatus } from "@/views/schluesselmarken/emailAlertApi";
import { binanceMarketOf, PHONE_ALERTS_READY, type ServiceId } from "./services";
import { OFFLINE_FACTS, slotState, type SlotFacts, type SlotState } from "./slotState";
import { loadTv, tvAvailable, tvList, useTv, type TvStatus } from "./tvStore";

export interface ServiceView {
  id: ServiceId;
  state: SlotState;
  facts: SlotFacts;
  /** One line under the name: what is true right now, in plain words. */
  line: string;
  /** The connection (exchanges). */
  connection: ExchangeConnection | null;
}

/** The connection of an exchange service in the status, or null. */
export function connectionOf(status: ExchangeStatus | null, id: ServiceId): ExchangeConnection | null {
  if (!status) return null;
  const market = binanceMarketOf(id);
  if (id === "bitunix") return status.connections.find((c) => c.exchange === "bitunix" && c.status !== "revoked") ?? null;
  if (market) return status.connections.find((c) => c.exchange === "binance" && c.market === market && c.status !== "revoked") ?? null;
  return null;
}

const when = (iso: string | null): string => {
  if (!iso) return "noch nicht abgeglichen";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "gerade abgeglichen";
  const min = Math.round(ms / 60_000);
  if (min < 2) return "gerade abgeglichen";
  if (min < 90) return `vor ${min} Min. abgeglichen`;
  const h = Math.round(min / 60);
  if (h < 36) return `vor ${h} Std. abgeglichen`;
  return `vor ${Math.round(h / 24)} Tagen abgeglichen`;
};

/** Exchange view from the exchange status – pure, tested. */
export function exchangeView(id: ServiceId, status: ExchangeStatus | null, o: { signedIn: boolean; enabled: boolean; connectBusy: boolean; importing: boolean; loading: boolean }): ServiceView {
  const connection = connectionOf(status, id);
  const invalid = connection?.status === "invalid";
  const facts: SlotFacts = {
    configured: !o.enabled ? false : status ? status.configured || !!connection : null,
    needsSignIn: o.enabled && !o.signedIn,
    busy: o.connectBusy || o.importing,
    error: invalid ? (connection?.lastError ?? "Der Schlüssel wird nicht mehr akzeptiert.") : null,
    connected: !!connection && !invalid,
    entitled: status ? status.plan.entitled : true,
  };
  const state = slotState(facts);
  let line: string;
  if (state === "unconfigured") line = !o.enabled ? "In dieser Ausgabe nicht verfügbar – Konto und Server fehlen." : "Der Betreiber hat die Börsen-Verbindung noch nicht eingerichtet.";
  else if (state === "signin") line = "Melde dich an, dann verbindest du deinen Schlüssel.";
  else if (state === "connecting") line = o.importing ? "Erstimport läuft …" : "Schlüssel wird geprüft …";
  else if (state === "error") line = facts.error ?? "Es gibt ein Problem mit der Verbindung.";
  else if (state === "connected") line = connection?.syncEnabled === false ? "Verbunden · Auto-Abgleich aus" : `Verbunden · ${when(connection?.lastSyncAt ?? null)}`;
  else if (state === "upgrade") line = "Diese Verbindung gibt es erst im höheren Tarif.";
  else line = o.loading ? "Status wird geladen …" : "Nur Lese-Schlüssel, deine Daten bleiben deine.";
  return { id, state, facts, line, connection };
}

/** TradingView view from its status – pure, tested. */
export function tvView(status: TvStatus | null, o: { enabled: boolean; signedIn: boolean; loading: boolean }): ServiceView {
  const list = tvList(status);
  const last = list.find((r) => r.status !== "rejected") ?? null;
  // the newest delivery was refused (wrong plan, bad message, a body the schema does not know): say so – a later accepted one clears it
  const newest = list[0] ?? null;
  const refused = newest && newest.status === "rejected" ? newest : null;
  const facts: SlotFacts = {
    configured: o.enabled,
    needsSignIn: o.enabled && !o.signedIn,
    busy: false,
    error: refused ? `Letztes Signal abgelehnt: ${refused.reason ?? "unbekannter Grund"}` : null,
    connected: !!status?.hasToken && !!last,
    entitled: true,
  };
  const state = slotState(facts);
  let line: string;
  if (state === "unconfigured") line = "In dieser Ausgabe nicht verfügbar – Konto und Server fehlen.";
  else if (state === "signin") line = "Melde dich an, dann bekommst du deine Zieladresse.";
  else if (state === "error") line = facts.error ?? "Es gibt ein Problem mit der Verbindung.";
  else if (state === "connected") line = last ? `Verbunden · letztes Signal ${new Date(last.receivedAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Verbunden";
  else if (status?.hasToken) line = "Zieladresse steht – noch kein Signal angekommen.";
  else line = o.loading ? "Status wird geladen …" : "Ohne OAuth: deine Alarme senden an deine Zieladresse.";
  return { id: "tradingview", state, facts, line, connection: null };
}

/** E-mail alarm view from the alert status – pure, tested. */
export function emailView(status: AlertStatus | null, o: { enabled: boolean; signedIn: boolean; loading: boolean }): ServiceView {
  const facts: SlotFacts = {
    configured: !o.enabled ? false : status ? status.configured : null,
    needsSignIn: o.enabled && !o.signedIn,
    busy: false,
    error: null,
    connected: !!status && status.configured && status.hasEmail && status.emailConfirmed && status.lastRun !== null,
    entitled: status ? status.entitled : true,
  };
  const state = slotState(facts);
  let line: string;
  if (state === "unconfigured") line = !o.enabled ? "In dieser Ausgabe nicht verfügbar – Konto und Server fehlen." : "Der Betreiber hat den E-Mail-Versand noch nicht eingerichtet.";
  else if (state === "signin") line = "Melde dich an, dann kannst du E-Mail-Alarme einschalten.";
  else if (state === "upgrade") line = "E-Mail-Alarme gibt es erst im höheren Tarif.";
  else if (state === "connected") line = "Verbunden · Alarm läuft auch bei geschlossener App.";
  else if (status && !status.hasEmail) line = "Dein Konto hat noch keine E-Mail-Adresse.";
  else if (status && !status.emailConfirmed) line = "Bestätige deine E-Mail-Adresse, dann geht der Alarm.";
  else line = o.loading ? "Status wird geladen …" : "Schalte den E-Mail-Alarm bei den Alarmen ein.";
  return { id: "alert-email", state, facts, line, connection: null };
}

export function phoneView(): ServiceView {
  const facts: SlotFacts = { ...OFFLINE_FACTS, configured: PHONE_ALERTS_READY };
  return {
    id: "alert-phone",
    state: slotState(facts),
    facts,
    line: PHONE_ALERTS_READY ? "Nicht verbunden." : "Telefon-Alarm ist noch nicht eingerichtet – es gibt dafür weder Anbieter-Zugang noch Funktion.",
    connection: null,
  };
}

export function cloudView(o: { enabled: boolean; signedIn: boolean }): ServiceView {
  const facts: SlotFacts = { configured: o.enabled, needsSignIn: false, busy: false, error: null, connected: o.signedIn, entitled: true };
  const state = slotState(facts);
  return {
    id: "cloud",
    state,
    facts,
    line: state === "unconfigured" ? "In dieser Ausgabe gibt es kein Cloud-Konto – dein Journal bleibt auf diesem Gerät." : state === "connected" ? "Angemeldet · Journal auf allen Geräten." : "Nicht angemeldet · alles bleibt auf diesem Gerät.",
    connection: null,
  };
}

/** E-mail alarm status, asked once while somebody looks (not polled). */
function useAlertStatusOnce(active: boolean): { status: AlertStatus | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ status: AlertStatus | null; loading: boolean; failed: boolean }>({ status: null, loading: active, failed: false });
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetchAlertStatus(ctrl.signal).then(
      (status) => !ctrl.signal.aborted && setState({ status, loading: false, failed: false }),
      () => !ctrl.signal.aborted && setState({ status: null, loading: false, failed: true }),
    );
    return () => ctrl.abort();
  }, [active]);
  return state;
}

/** The view of one service. Triggers the status load of the stores it needs (once, only while signed in). */
export function useServiceView(id: ServiceId): ServiceView {
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const exchangeStatus = useExchange((s) => s.status);
  const exchangeLoad = useExchange((s) => s.load);
  const busy = useExchange((s) => s.busy);
  const backfill = useExchange((s) => s.backfill);
  const tvStatus = useTv((s) => s.status);
  const tvLoad = useTv((s) => s.load);
  const isExchange = id === "bitunix" || id === "binance-spot" || id === "binance-futures";
  const wantsAlert = id === "alert-email" && cloudEnabled() && !hasClaudeRuntime() && signedIn;
  const alert = useAlertStatusOnce(wantsAlert);

  useEffect(() => {
    if (isExchange && exchangeEnabled() && signedIn && useExchange.getState().load === "idle") void loadExchangeStatus();
  }, [isExchange, signedIn]);
  useEffect(() => {
    if (id === "tradingview" && tvAvailable() && useTv.getState().load === "idle") void loadTv();
  }, [id, signedIn]);

  if (isExchange) {
    return exchangeView(id, exchangeStatus, {
      signedIn,
      enabled: exchangeEnabled(),
      connectBusy: busy === "connect",
      importing: !!backfill && !backfill.done && connectionOf(exchangeStatus, id)?.id === backfill.connectionId,
      loading: exchangeLoad === "loading",
    });
  }
  if (id === "tradingview") return tvView(tvStatus, { enabled: cloudEnabled() && !hasClaudeRuntime(), signedIn, loading: tvLoad === "loading" });
  if (id === "alert-email") return emailView(alert.status, { enabled: cloudEnabled() && !hasClaudeRuntime(), signedIn, loading: alert.loading });
  if (id === "alert-phone") return phoneView();
  return cloudView({ enabled: cloudEnabled() && !hasClaudeRuntime(), signedIn });
}
