/**
 * The management rules of the Positionsrechner (Risiko-Seite): last choice per device (`storageKey("calc-manage")`, a convenience –
 * the Handelsplan keeps its rules in the plan form and in saved plans). Whatever is stored goes through `manageSpecOf`.
 */
import { create } from "zustand";
import { DEFAULT_MANAGE, manageSpecOf, type ManageSpec } from "@/domain/plan";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const CALC_MANAGE_KEY = storageKey("calc-manage");

interface CalcManageState {
  spec: ManageSpec;
  setSpec(spec: ManageSpec): void;
}

export const useCalcManage = create<CalcManageState>((set) => ({
  spec: manageSpecOf(readJson<unknown>(CALC_MANAGE_KEY, DEFAULT_MANAGE)),
  setSpec: (next) => {
    const spec = manageSpecOf(next);
    writeJson(CALC_MANAGE_KEY, spec);
    set({ spec });
  },
}));
