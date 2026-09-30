/**
 * Page components of the four tabs, gathered in one module so the shell (and its tests) has a
 * single seam. The trades/setups/settings views are owned by other waves; the names imported here
 * are the contract the integrator reconciles (see `src/app/README.md`).
 */
export { OverviewView } from "@/views/overview";
export { TradesView } from "@/views/trades";
export { SetupsView } from "@/views/setups";
export { SettingsView } from "@/views/settings";
