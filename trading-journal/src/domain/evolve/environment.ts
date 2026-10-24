/**
 * What the browser tells about the device (tab visibility, battery, data saver, pointer) – the input of the throttle. Browser
 * only, every read guarded: a missing API simply means "no reason to slow down". Nothing is stored or sent anywhere.
 */
import type { Power } from "./config";
import type { ThrottleEnv } from "./throttle";

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

let battery: BatteryLike | null = null;
let batteryAsked = false;

function askBattery(onChange: () => void): () => void {
  const nav = globalThis.navigator as (Navigator & { getBattery?: () => Promise<BatteryLike> }) | undefined;
  if (batteryAsked || !nav?.getBattery) return () => undefined;
  batteryAsked = true;
  let off = (): void => undefined;
  void nav
    .getBattery()
    .then((b) => {
      battery = b;
      b.addEventListener("levelchange", onChange);
      b.addEventListener("chargingchange", onChange);
      off = () => {
        b.removeEventListener("levelchange", onChange);
        b.removeEventListener("chargingchange", onChange);
      };
      onChange();
    })
    .catch(() => undefined);
  return () => off();
}

export function readThrottleEnv(power: Power): ThrottleEnv {
  const coarse = ((): boolean => {
    try {
      return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  })();
  const conn = (globalThis.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined)?.connection;
  return {
    hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
    saveData: conn?.saveData === true,
    batteryLow: !!battery && !battery.charging && battery.level <= 0.2,
    coarse,
    power,
  };
}

/** Calls `onChange` when the tab is shown / hidden or the battery state changes. Returns the function that stops watching. */
export function watchEnvironment(onChange: () => void): () => void {
  const vis = (): void => onChange();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", vis);
  const offBattery = askBattery(onChange);
  return () => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", vis);
    offBattery();
  };
}
