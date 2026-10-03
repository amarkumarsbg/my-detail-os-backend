/**
 * Canonical permission keys for RBAC.
 * Keep aligned with frontend/src/lib/permission-keys.ts (no shared package yet).
 */
export const PERMISSION_KEYS = [
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
  "BRANCHES",
  "PERFORMANCE",
  "MECHANICS",
  "ANALYTICS",
  "ADVANCED_REPORTS",
  "ACTIVITY",
  "MESSAGES",
  "SETTINGS",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Modules that support granular action permissions via *_CREATE / *_VIEW / *_EDIT.
 * Base keys (for example JOB_CARDS) remain backward-compatible and imply all actions.
 */
export const GRANULAR_PERMISSION_MODULES = [
  "JOB_CARDS",
  "BOOKINGS",
  "PICKUP_DROP",
  "QUOTATIONS",
  "APPOINTMENTS",
  "CUSTOMERS",
  "VEHICLES",
  "MEMBERSHIP",
  "BILLING",
  "EXPENSES",
  "INVENTORY",
  "STAFF",
  "ATTENDANCE",
  "REFERRALS",
] as const;

export type GranularModuleKey = (typeof GRANULAR_PERMISSION_MODULES)[number];
export type GranularAction = "CREATE" | "VIEW" | "EDIT" | "DELETE";

/**
 * Modules that stay as simple on/off permissions in the UI.
 * Exported for FE/BE parity docs; not used for auth checks directly.
 */
export const SIMPLE_PERMISSIONS_FOR_UI = PERMISSION_KEYS.filter(
  (key) => !(GRANULAR_PERMISSION_MODULES as readonly string[]).includes(key)
) as PermissionKey[];

export function isGranularPermissionModule(permission: string): permission is GranularModuleKey {
  return (GRANULAR_PERMISSION_MODULES as readonly string[]).includes(permission);
}

export function granularPermissionKey(moduleKey: GranularModuleKey, action: GranularAction): string {
  return `${moduleKey}_${action}`;
}
