/** Sort JSON collection payloads newest-first for list UIs. */

const COLLECTION_DATE_FIELD: Record<string, string> = {
  jobCards: "createdAt",
  invoices: "createdAt",
  quotations: "createdAt",
  appointments: "date",
  expenses: "date",
  activityLogs: "createdAt",
  serviceReminders: "dueDate",
  walletTransactions: "createdAt",
  serviceCatalog: "createdAt",
  parts: "createdAt",
  stockMovements: "createdAt",
  productPurchases: "purchasedAt",
  branchStocks: "updatedAt",
  stockTransfers: "createdAt",
  partCategories: "name",
  followUps: "lastVisitDate",
  offers: "createdAt",
  supportTickets: "updatedAt",
  demoRequests: "createdAt",
  serviceCategories: "createdAt",
  notifications: "createdAt",
  pickupDropRequests: "createdAt",
};

function dateMs(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function payloadField(payload: unknown, field: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as Record<string, unknown>)[field];
}

function comparePayloadsDesc(
  a: unknown,
  b: unknown,
  primary: string,
  secondary?: string
): number {
  const av = dateMs(payloadField(a, primary));
  const bv = dateMs(payloadField(b, primary));
  if (av !== bv) return bv - av;
  if (secondary) {
    const as = dateMs(payloadField(a, secondary));
    const bs = dateMs(payloadField(b, secondary));
    if (as !== bs) return bs - as;
  }
  const aid = payloadField(a, "id");
  const bid = payloadField(b, "id");
  if (typeof aid === "string" && typeof bid === "string") {
    return bid.localeCompare(aid);
  }
  return 0;
}

export function sortCollectionPayloads(collection: string, payloads: unknown[]): unknown[] {
  const primary = COLLECTION_DATE_FIELD[collection] ?? "createdAt";
  const secondary =
    collection === "appointments"
      ? "time"
      : collection === "followUps"
        ? "createdAt"
        : undefined;
  return [...payloads].sort((a, b) => comparePayloadsDesc(a, b, primary, secondary));
}
