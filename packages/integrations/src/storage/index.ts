import { randomUUID } from "node:crypto";
import { assertMockOnly, type IntegrationMode } from "../types.js";

export interface DocumentStorageAdapter {
  mode: IntegrationMode;
  put(fileName: string, content: Buffer): Promise<{ reference: string }>;
  get(reference: string): Promise<Buffer | null>;
}

/**
 * Lokaler In-Memory-Stub mit identischem Interface zu einem künftigen
 * S3-kompatiblen Adapter. Ersetzt NICHT Base64-in-DB (das war Security-Risk
 * #4 im Prototyp) – Dokumente werden hier ausschließlich über eine
 * Referenz-ID angesprochen, wie es ein echter Objektspeicher auch tun würde.
 */
export class MockDocumentStorageAdapter implements DocumentStorageAdapter {
  mode: IntegrationMode = "mock";
  private store = new Map<string, Buffer>();

  async put(fileName: string, content: Buffer) {
    const reference = `mock-storage://${randomUUID()}-${fileName}`;
    this.store.set(reference, content);
    return { reference };
  }

  async get(reference: string) {
    return this.store.get(reference) ?? null;
  }
}

export function createDocumentStorageAdapter(mode: IntegrationMode): DocumentStorageAdapter {
  assertMockOnly(mode, "Document Storage");
  return new MockDocumentStorageAdapter();
}
