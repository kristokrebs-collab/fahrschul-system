/**
 * Which contract page is open (`cancel` = § 312k BGB "Verträge hier kündigen", `withdraw` = § 356a BGB "Vertrag widerrufen") – a
 * tiny store in the main bundle so a footer link, the legal row, the account card and a deep link can open the page; the page
 * itself (`ui/ContractSheet.tsx`) is a lazy chunk. Both pages work WITHOUT a login (the public e-mail path, `docs/RECHT/
 * kuendigung-widerruf.md`). Deep links: `/?kuendigen` · `/?widerruf` (the form) and `/?kuendigen=<token>` · `/?widerruf=<token>`
 * (the link in the confirmation mail) – read once on load and taken out of the address bar.
 */
import { create } from "zustand";
import { cloudEnabled } from "@/cloud/env";
import { hasClaudeRuntime } from "@/store/capability";
import type { ContractKind } from "./contract";

export const useContract = create<{ open: ContractKind | null; token: string | null; loaded: boolean }>(() => ({ open: null, token: null, loaded: false }));

export const openContract = (kind: ContractKind, token: string | null = null): void => useContract.setState({ open: kind, token, loaded: true });
export const closeContract = (): void => useContract.setState({ open: null, token: null });

/** The contract links exist where a contract can: a web build with the cloud, not inside claude.ai (nothing is sold there). */
export const contractLinksShown = (): boolean => cloudEnabled() && !hasClaudeRuntime();

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const PARAM: Record<ContractKind, string> = { cancel: "kuendigen", withdraw: "widerruf" };

/** The contract page a URL asks for (`?kuendigen`, `?widerruf=<token>`), or null. */
export function contractOfUrl(href: string): { kind: ContractKind; token: string | null; param: string } | null {
  try {
    const q = new URL(href).searchParams;
    for (const kind of ["cancel", "withdraw"] as const) {
      const p = PARAM[kind];
      if (!q.has(p)) continue;
      const v = q.get(p) ?? "";
      return { kind, token: TOKEN.test(v) ? v : null, param: p };
    }
  } catch {
    /* not a URL */
  }
  return null;
}
