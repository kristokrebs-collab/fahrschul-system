import { webcrypto } from "node:crypto";

/**
 * jsdom bringt `crypto.getRandomValues` mit, aber KEIN `crypto.subtle`. Die
 * Entwurfsverschlüsselung (§7) braucht echtes WebCrypto – im Browser ist es
 * vorhanden, im Test wird Nodes Implementierung untergeschoben. Es wird
 * bewusst NICHT gemockt: eine gemockte Verschlüsselung würde nichts beweisen.
 */
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
