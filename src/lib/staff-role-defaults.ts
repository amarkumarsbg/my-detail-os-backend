import type { UserRole } from "@prisma/client";
import {
  permissionsForStaffAccessLevel,
  type StaffAccessLevel,
} from "./staff-access.js";

/**
 * Default module access for newly created accounts (CREATE + VIEW baseline).
 * Applied when POST /api/users omits permissions or sends [].
 * EDIT keys are added when access is "With Edit Access" (see staff-access.ts).
 *
 * Keep aligned with frontend/src/lib/staff-role-defaults.ts.
 *
 * | Role | Modules |
 * |------|---------|
 * | ADMIN / SUPER_ADMIN | [] (role bypass) |
 * | MECHANIC | Workshop + customer-facing ops |
 * | RECEPTIONIST | Front desk + customers/fleet |
 * | SUPERVISOR | RECEPTIONIST + job-card ops, Expenses, Attendance, Staff Rewards |
 * | MANAGER / BRANCH_MANAGER | Full operations set |
 */
const RECEPTIONIST_MODULES = [
  "DASHBOARD",
  "CUSTOMERS",
  "VEHICLES",
  "MEMBERSHIP",
  "BOOKINGS",
  "APPOINTMENTS",
  "JOB_CARDS",
  "REMINDERS",
  "FOLLOW_UPS",
  "OFFERS",
  "SUPPORT",
  "BILLING",
  "REPORTS",
  "CASH_BANK",
  "LEAVE",
] as const;

const SUPERVISOR_EXTRA_MODULES = [
  "JOB_CARD_PRICING",
  "PICKUP_DROP",
  "QUOTATIONS",
  "EXPENSES",
  "ATTENDANCE",
  "STAFF_REWARDS",
] as const;

const OPERATIONS_MANAGER_MODULES = [
  "DASHBOARD",
  "JOB_CARDS",
  "JOB_CARD_PRICING",
  "BOOKINGS",
  "PICKUP_DROP",
  "QUOTATIONS",
  "APPOINTMENTS",
  "CUSTOMERS",
  "MEMBERSHIP",
  "VEHICLES",
  "REMINDERS",
  "FOLLOW_UPS",
  "REFERRALS",
  "OFFERS",
  "SUPPORT",
  "BILLING",
  "REPORTS",
  "CASH_BANK",
  "PARTIES",
  "SHARED_LEDGER",
  "EXPENSES",
  "VENDORS",
  "STAFF",
  "ATTENDANCE",
  "LEAVE",
  "PAYROLL",
  "STAFF_REWARDS",
  "SERVICES",
  "INVENTORY",
  "PERFORMANCE",
  "MECHANICS",
  "ANALYTICS",
] as const;

function mergeModuleKeys(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

const ROLE_DEFAULT_MODULE_KEYS: Partial<Record<UserRole, readonly string[]>> = {
  MECHANIC: [
    "DASHBOARD",
    "JOB_CARDS",
    "JOB_CARD_PRICING",
    "BOOKINGS",
    "PICKUP_DROP",
    "QUOTATIONS",
    "APPOINTMENTS",
    "CUSTOMERS",
    "VEHICLES",
    "BILLING",
    "EXPENSES",
    "REPORTS",
    "ATTENDANCE",
    "LEAVE",
  ],
  RECEPTIONIST: RECEPTIONIST_MODULES,
  SUPERVISOR: mergeModuleKeys(RECEPTIONIST_MODULES, SUPERVISOR_EXTRA_MODULES),
  MANAGER: OPERATIONS_MANAGER_MODULES,
  BRANCH_MANAGER: OPERATIONS_MANAGER_MODULES,
};

function modulesToCreateViewKeys(modules: readonly string[]): string[] {
  const keys: string[] = [];
  for (const mod of modules) {
    keys.push(`${mod}_CREATE`, `${mod}_VIEW`);
  }
  return keys;
}

/** Module keys granted on create before the access-level EDIT toggle is applied. */
export function getDefaultModuleKeysForRole(role: UserRole): readonly string[] {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return [];
  return ROLE_DEFAULT_MODULE_KEYS[role] ?? [];
}

/** Build permissions[] for POST /api/users from role + With/Without Edit Access. */
export function buildInitialPermissions(
  role: UserRole,
  accessLevel: StaffAccessLevel = "withEditAccess"
): string[] {
  const base = modulesToCreateViewKeys(getDefaultModuleKeysForRole(role));
  if (base.length === 0) return [];
  return permissionsForStaffAccessLevel(base, accessLevel);
}

/** When permissions is omitted or empty, apply role defaults + access level. */
export function resolvePermissionsOnCreate(
  role: UserRole,
  permissions?: string[],
  accessLevel?: StaffAccessLevel
): string[] {
  if (permissions !== undefined && permissions.length > 0) {
    return permissions;
  }
  return buildInitialPermissions(role, accessLevel ?? "withEditAccess");
}
