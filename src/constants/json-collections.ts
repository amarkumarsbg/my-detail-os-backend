/** Array-backed JSON collections (each row entityId = payload.id). */
export const ARRAY_JSON_COLLECTIONS = [
  "jobCards",
  "invoices",
  "quotations",
  "appointments",
  "expenses",
  "activityLogs",
  "serviceReminders",
  "walletTransactions",
  "serviceCatalog",
  "parts",
  "stockMovements",
  "productPurchases",
  "branchStocks",
  "stockTransfers",
  "partCategories",
  "followUps",
  "serviceCategories",
  "notifications",
  "pickupDropRequests",
  "communications",
  "leaveRequests",
  "staffRewardLedger",
  "staffTargets",
] as const;

export type ArrayJsonCollection = (typeof ARRAY_JSON_COLLECTIONS)[number];

/** Single-document collections (fixed entityId). */
export const SINGLETON_COLLECTIONS = [
  "dashboardStats",
  "expenseMeta",
  "cashBank",
  "payroll",
  "membership",
  "appSettings",
  "referralProgram",
  "balanceSheetManual",
  "highEndServices",
  "reportSchedules",
  "vehicleCatalog",
  "leaveConfig",
  "staffRewardSettings",
  "customerRewardSettings",
] as const;

export type SingletonCollection = (typeof SINGLETON_COLLECTIONS)[number];

export const SINGLETON_ENTITY_ID = "default";

export function isArrayCollection(name: string): name is ArrayJsonCollection {
  return (ARRAY_JSON_COLLECTIONS as readonly string[]).includes(name);
}

export function isSingletonCollection(name: string): name is SingletonCollection {
  return (SINGLETON_COLLECTIONS as readonly string[]).includes(name);
}

/**
 * Physical AppJsonRow.entityId for singleton documents.
 * PK is global (collection, entityId), so "default" cannot be shared across orgs.
 * API still uses logical id "default"; storage uses `{organizationId}::default`.
 */
export function singletonStorageEntityId(organizationId: string): string {
  return `${organizationId}::${SINGLETON_ENTITY_ID}`;
}

export function isSingletonStorageEntityIdForOrg(
  entityId: string,
  organizationId: string
): boolean {
  return (
    entityId === singletonStorageEntityId(organizationId) ||
    entityId === SINGLETON_ENTITY_ID
  );
}

