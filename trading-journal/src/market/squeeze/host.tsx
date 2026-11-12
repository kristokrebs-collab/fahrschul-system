/**
 * Leaf host of the squeeze alert (F07): runs the watcher while it is mounted, renders nothing. The shell mounts it only
 * while `settings.squeeze.alerts` is on AND the archive runs (`SqueezeMount` in `DeferredHosts`).
 */
import { useSqueezeAlerts } from "./alerts";

export default function SqueezeHost(): null {
  useSqueezeAlerts();
  return null;
}
