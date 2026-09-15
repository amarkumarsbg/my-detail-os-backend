export type PlanLimits = {
  maxBranches: number | null;
  maxStaff?: number | null;
  maxCustomers?: number | null;
};

/** Dynamic plan code (was Prisma enum; now free-form string). */
export type PlanCode = string;

export type PlanTemplate = {
  planCode: PlanCode;
  planName: string;
  limits: PlanLimits;
};

export type DynamicPlanDefinition = PlanTemplate & {
  publicVisible: boolean;
  /** Built-in seed plans can still be deleted if unused. */
  isBuiltIn?: boolean;
};

/** Seed catalog used when PlatformSettings has no planCatalog yet. */
export const DEFAULT_PLAN_CATALOG: DynamicPlanDefinition[] = [
  {
    planCode: "STARTER",
    planName: "Starter",
    limits: { maxBranches: 1, maxStaff: 3 },
    publicVisible: true,
    isBuiltIn: true,
  },
  {
    planCode: "GROWTH",
    planName: "Growth",
    limits: { maxBranches: 3, maxStaff: 10 },
    publicVisible: true,
    isBuiltIn: true,
  },
  {
    planCode: "BUSINESS",
    planName: "Business",
    limits: { maxBranches: 10, maxStaff: 25 },
    publicVisible: true,
    isBuiltIn: true,
  },
  {
    planCode: "ENTERPRISE",
    planName: "Enterprise",
    limits: { maxBranches: null, maxStaff: null },
    publicVisible: true,
    isBuiltIn: true,
  },
  {
    planCode: "CUSTOM",
    planName: "Custom",
    limits: { maxBranches: 1, maxStaff: 3 },
    publicVisible: false,
    isBuiltIn: true,
  },
];

/** @deprecated Use getEffectivePlanCatalogFromDb / DEFAULT_PLAN_CATALOG */
export const PLAN_CATALOG: Record<string, PlanTemplate> = Object.fromEntries(
  DEFAULT_PLAN_CATALOG.map((p) => [
    p.planCode,
    { planCode: p.planCode, planName: p.planName, limits: p.limits },
  ])
);

export const PLAN_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,23}$/;

export function normalizePlanCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function parsePlanLimits(raw: unknown): PlanLimits {
  if (!raw || typeof raw !== "object") {
    return { maxBranches: 1 };
  }
  const obj = raw as Record<string, unknown>;
  const maxBranches =
    obj.maxBranches === null
      ? null
      : typeof obj.maxBranches === "number" && Number.isFinite(obj.maxBranches)
        ? Math.max(0, Math.floor(obj.maxBranches))
        : 1;
  return {
    maxBranches,
    maxStaff:
      obj.maxStaff === null
        ? null
        : typeof obj.maxStaff === "number"
          ? Math.floor(obj.maxStaff)
          : undefined,
    maxCustomers:
      obj.maxCustomers === null
        ? null
        : typeof obj.maxCustomers === "number"
          ? Math.floor(obj.maxCustomers)
          : undefined,
  };
}

export function effectiveMaxBranches(
  limits: PlanLimits,
  maxBranchesOverride: number | null | undefined
): number | null {
  if (maxBranchesOverride !== null && maxBranchesOverride !== undefined) {
    return Math.max(0, Math.floor(maxBranchesOverride));
  }
  return limits.maxBranches;
}

export function effectiveMaxUsers(
  limits: PlanLimits,
  maxUsersOverride: number | null | undefined
): number | null {
  if (maxUsersOverride !== null && maxUsersOverride !== undefined) {
    return Math.max(0, Math.floor(maxUsersOverride));
  }
  return limits.maxStaff ?? null;
}

export function isUnlimited(max: number | null): boolean {
  return max === null;
}

export function canCreateWithLimit(used: number, max: number | null): boolean {
  if (isUnlimited(max)) return true;
  return used < (max as number);
}
