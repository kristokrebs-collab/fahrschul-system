/**
 * Muster-Entdecker (Auftrag B). Import lazily – the card pulls in the whole domain of the search:
 *   const DiscoveryPanel = lazy(() => import("@/views/discovery/DiscoveryPanel"));
 * This index is for hosts that already load the chunk (Labor section, Strategie-Studio); the shell must not import it.
 */
export { DiscoveryPanel, type DiscoveryPanelProps } from "./DiscoveryPanel";
export type { FilterTestState } from "./FindingCard";
export { DISC } from "./strings";
