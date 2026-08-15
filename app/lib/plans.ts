// Typed view of the catalogue. The data itself lives in plans.mjs so the
// pricing tests — which run on plain node — can read the same numbers the app
// serves, instead of a copy that drifts.
import { freePlan, planCatalog, isPlanId as isPlanIdJs } from "./plans.mjs";

export type PlanId = "starter" | "pro" | "scale";

/** Narrowing wrapper: the .mjs version cannot carry a type predicate. */
export function isPlanId(value: string): value is PlanId {
  return isPlanIdJs(value);
}

export { freePlan, planCatalog };

/** The catalogue as an ordered list, with `id` narrowed back to PlanId. */
export const planList: Array<{
  id: PlanId;
  name: string;
  monthlyUsd: number;
  annualUsd: number;
  available: boolean;
  limits: {
    products: number;
    channelsPerMonth: number;
    contactChecksPerMonth: number;
    aiMessagesPerMonth: number;
    workspaceMembers: number;
  };
}> = Object.values(planCatalog) as never;
