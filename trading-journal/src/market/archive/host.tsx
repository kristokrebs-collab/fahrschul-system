/**
 * Leaf host of the archive (F26): runs the collector while it is mounted, renders nothing. The shell mounts it only while
 * the archive switch is on (`ArchiveMount` in `DeferredHosts`), so with the switch off this chunk is never fetched.
 */
import { useEffect } from "react";
import { startArchiveRunner } from "./runner";

export default function ArchiveHost(): null {
  useEffect(() => startArchiveRunner(), []);
  return null;
}
