/**
 * The form of the Handelsplan (market, timeframe, session, stop and target rule, account …): the last one used, per device
 * (`storageKey("plan-form")`, a convenience – the saved plans carry their own copy in `settings.plan`). Always a valid form:
 * whatever is stored goes through `formOf`. `planId` is the saved plan the page is working on (`plan-open`, also per device: after a
 * reload "Plan aktualisieren" still means that plan, not a second one; an id whose plan is gone behaves like no plan).
 */
import { create } from "zustand";
import { DEFAULT_FORM, formOf, type PlanForm } from "@/domain/plan";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const PLAN_FORM_KEY = storageKey("plan-form");
export const PLAN_OPEN_KEY = storageKey("plan-open");

const openId = (): string | null => {
  const raw = readJson<unknown>(PLAN_OPEN_KEY, null);
  return typeof raw === "string" && raw.length > 0 && raw.length <= 64 ? raw : null;
};

interface PlanFormState {
  form: PlanForm;
  /** the stored form existed when the page first opened (else the page may take the app's market and account) */
  restored: boolean;
  /** the saved plan the page works on, `null` = a plan that is not saved */
  planId: string | null;
  set(patch: Partial<PlanForm>): void;
  /** takes a whole form (a saved plan is opened) */
  replace(form: PlanForm, planId?: string | null): void;
  setPlanId(id: string | null): void;
  /** back to the defaults, keeping market, account and day */
  clear(): void;
}

const stored = readJson<unknown>(PLAN_FORM_KEY, null);

export const usePlanForm = create<PlanFormState>((set, get) => ({
  form: formOf(stored),
  restored: stored != null,
  planId: openId(),
  set: (patch) => {
    const form = formOf({ ...get().form, ...patch });
    writeJson(PLAN_FORM_KEY, form);
    set({ form, restored: true });
  },
  replace: (form, planId = null) => {
    const clean = formOf(form);
    writeJson(PLAN_FORM_KEY, clean);
    writeJson(PLAN_OPEN_KEY, planId);
    set({ form: clean, restored: true, planId });
  },
  setPlanId: (planId) => {
    writeJson(PLAN_OPEN_KEY, planId);
    set({ planId });
  },
  clear: () => {
    const { symbol, account, day } = get().form;
    const form = formOf({ ...DEFAULT_FORM, symbol, account, day });
    writeJson(PLAN_FORM_KEY, form);
    writeJson(PLAN_OPEN_KEY, null);
    set({ form, planId: null });
  },
}));
