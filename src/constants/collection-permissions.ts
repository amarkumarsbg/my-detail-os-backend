import {
  ARRAY_JSON_COLLECTIONS,
  SINGLETON_COLLECTIONS,
} from "./json-collections.js";

/**
 * Permission required for each AppJsonRow collection.
 * Every array + singleton collection name must appear here (default-deny otherwise).
 */
export const COLLECTION_PERMISSION_MAP: Record<string, string> = {
  jobCards: "JOB_CARDS",
  invoices: "BILLING",
  quotations: "QUOTATIONS",
  appointments: "APPOINTMENTS",
  expenses: "EXPENSES",
  activityLogs: "ACTIVITY",
  serviceReminders: "REMINDERS",
  walletTransactions: "REFERRALS",
  serviceCatalog: "SERVICES",
  parts: "INVENTORY",
  stockMovements: "INVENTORY",
  productPurchases: "INVENTORY",
  branchStocks: "INVENTORY",
  stockTransfers: "INVENTORY",
  partCategories: "INVENTORY",
  followUps: "FOLLOW_UPS",
  offers: "OFFERS",
  supportTickets: "SUPPORT",
  demoRequests: "SUPPORT",
  serviceCategories: "SERVICES",
  notifications: "DASHBOARD",
  pickupDropRequests: "PICKUP_DROP",
  communications: "MESSAGES",
  dashboardStats: "DASHBOARD",
  expenseMeta: "EXPENSES",
  cashBank: "CASH_BANK",
  payroll: "PAYROLL",
  membership: "MEMBERSHIP",
  appSettings: "SETTINGS",
  referralProgram: "REFERRALS",
  balanceSheetManual: "SHARED_LEDGER",
  highEndServices: "SERVICES",
  reportSchedules: "ADVANCED_REPORTS",
  vehicleCatalog: "VEHICLES",
  leaveRequests: "LEAVE",
  leaveConfig: "LEAVE",
  staffRewardLedger: "STAFF_REWARDS",
  staffTargets: "STAFF_REWARDS",
  staffRewardSettings: "STAFF_REWARDS",
  customerRewardSettings: "MEMBERSHIP",
};

/** Returns the permission key for a known collection, or null if unmapped/unknown. */
export function getCollectionPermission(collection: string): string | null {
  return COLLECTION_PERMISSION_MAP[collection] ?? null;
}

/** All registered JSON collection names (arrays + singletons). */
export function allRegisteredCollections(): string[] {
  return [...ARRAY_JSON_COLLECTIONS, ...SINGLETON_COLLECTIONS];
}

/**
 * True when every registered collection has a permission mapping
 * and the map has no orphan keys that are not registered collections.
 */
export function collectionPermissionMapIsComplete(): boolean {
  const registered = new Set(allRegisteredCollections());
  const mapped = Object.keys(COLLECTION_PERMISSION_MAP);
  if (mapped.length !== registered.size) return false;
  for (const name of mapped) {
    if (!registered.has(name)) return false;
    if (!COLLECTION_PERMISSION_MAP[name]) return false;
  }
  for (const name of registered) {
    if (!COLLECTION_PERMISSION_MAP[name]) return false;
  }
  return true;
}
