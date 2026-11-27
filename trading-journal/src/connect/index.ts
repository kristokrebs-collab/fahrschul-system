/**
 * Verbindungen (Paket Verbindungen): placeholder, dialog, TradingView assistant, Binance wizard, partner links.
 * Eager exports are tiny; everything heavy loads on demand (`ConnectSlot` → `SlotView`, `ConnectMount` → `ConnectHost`).
 */
export { ConnectSlot, type ConnectSlotProps } from "./ConnectSlot";
export { openConnectDialog, closeConnectDialog, useConnectUi } from "./open";
export { SERVICES, SERVICE_IDS, HUB_ORDER, PHONE_ALERTS_READY, isServiceId, type ServiceId } from "./services";
export { slotState, wizardReducer, wizardStart, type SlotFacts, type SlotState, type WizardState } from "./slotState";
export { partnerLink, PARTNER_NOTICE, type PartnerId, type PartnerLink } from "./partners";
