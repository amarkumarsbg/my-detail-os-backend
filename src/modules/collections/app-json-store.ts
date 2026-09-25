/**
 * AppJsonRow storage adapter. Domain services own business rules; this layer persists
 * and enforces tenant (organizationId) scope when provided.
 */
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { sortCollectionPayloads } from "../../lib/sort-collection-payloads.js";
import {
  isArrayCollection,
  isSingletonCollection,
  SINGLETON_ENTITY_ID,
  singletonStorageEntityId,
} from "../../constants/json-collections.js";
import { applyCollectionBranchScope } from "../../lib/data-scope.js";
import { AppError } from "../../lib/app-error.js";
import { normalizeActivityLogPayload } from "../../services/activity-logger.service.js";

function isPickupDropWriteBlocked(): boolean {
  const raw = process.env.BLOCK_PICKUP_DROP_WRITES?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function assertCollectionWriteAllowed(collection: string): void {
  if (collection !== "pickupDropRequests") return;
  if (!isPickupDropWriteBlocked()) return;
  throw AppError.forbidden("Pickup/Drop writes are temporarily blocked.");
}

/** Merge entityId into payload; normalize activityLogs to frontend ActivityLog shape. */
function mapListedPayload(collection: string, entityId: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return collection === "activityLogs"
      ? normalizeActivityLogPayload({}, entityId)
      : payload;
  }
  if (collection === "activityLogs") {
    return normalizeActivityLogPayload(
      { id: entityId, ...(payload as Record<string, unknown>) },
      entityId
    );
  }
  return { id: entityId, ...(payload as Record<string, unknown>) };
}

/**
 * Financial collections whose transaction history must never be silently wiped
 * by an empty snapshot (e.g. when the frontend hasn't loaded the data yet).
 * An empty snapshot against any of these is rejected with 409 when rows exist.
 */
const FINANCIAL_COLLECTIONS = new Set([
  "productPurchases",
  "stockMovements",
  "expenses",
  "walletTransactions",
  "staffRewardLedger",
]);

async function assertNonEmptySnapshotForFinancialCollections(
  collection: string,
  items: { id: string }[],
  organizationId: string
): Promise<void> {
  if (!FINANCIAL_COLLECTIONS.has(collection)) return;
  if (items.length > 0) return; // non-empty → fine
  const existing = await prisma.appJsonRow.count({
    where: { collection, organizationId },
  });
  if (existing === 0) return; // nothing to protect
  throw AppError.conflict(
    `Cannot replace ${collection} with an empty snapshot — ${existing} existing record(s) would be lost. ` +
      `Delete records individually or send the full dataset.`
  );
}

export type ListCollectionOpts = {
  /** When set, only return rows for this organization. */
  organizationId?: string;
  allowedBranchIds?: string[] | null;
  page?: number;
  pageSize?: number;
  /**
   * JSON keys to strip from each payload before returning.
   * Applied at DB level (SQL `payload - 'key'`) for the fast pagination path to reduce
   * network transfer when payloads contain large embedded data (e.g. base64 PDFs).
   * Applied in Node for the general (branch-filtered) path.
   */
  stripPayloadFields?: string[];
};

export async function listCollectionItems(
  collection: string,
  allowedBranchIdsOrOpts?: string[] | null | ListCollectionOpts
): Promise<unknown[] | { items: unknown[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const opts: ListCollectionOpts =
    allowedBranchIdsOrOpts !== null &&
    typeof allowedBranchIdsOrOpts === "object" &&
    !Array.isArray(allowedBranchIdsOrOpts)
      ? allowedBranchIdsOrOpts
      : { allowedBranchIds: allowedBranchIdsOrOpts as string[] | null | undefined };

  let items: unknown[];

  if (isSingletonCollection(collection)) {
    const orgId = opts.organizationId;
    const row = orgId
      ? await prisma.appJsonRow.findFirst({
          where: {
            collection,
            organizationId: orgId,
            OR: [
              { entityId: singletonStorageEntityId(orgId) },
              { entityId: SINGLETON_ENTITY_ID },
            ],
          },
          // Prefer org-scoped id when both legacy + scoped exist
          orderBy: { updatedAt: "desc" },
          select: { payload: true, entityId: true },
        }).then(async (found) => {
          if (!found) return null;
          // If we got legacy but scoped exists, prefer scoped
          if (found.entityId === SINGLETON_ENTITY_ID) {
            const scoped = await prisma.appJsonRow.findUnique({
              where: {
                collection_entityId: {
                  collection,
                  entityId: singletonStorageEntityId(orgId),
                },
              },
              select: { payload: true },
            });
            return scoped ?? found;
          }
          return found;
        })
      : await prisma.appJsonRow.findFirst({
          where: { collection, entityId: SINGLETON_ENTITY_ID },
          select: { payload: true },
        });
    items = row ? [row.payload] : [];
  } else {
    const where = {
      collection,
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
    };

    // Fast path: pagination with no branch filter.
    // Uses a single raw SQL query with COUNT(*) OVER() window function to get both
    // total count and page data in one DB round-trip (critical for high-latency remote DBs).
    // stripPayloadFields removes large embedded fields (e.g. base64 PDFs) at DB level
    // to minimise network transfer.
    // Empty arrays still need branch filtering (caller restricted to no branches).
    // Only skip the fast path when a non-null branch allow-list is present.
    const needsBranchFilter = Array.isArray(opts.allowedBranchIds);
    if (opts.page && opts.pageSize && !needsBranchFilter) {
      const skip = (opts.page - 1) * opts.pageSize;
      const orgFilter = opts.organizationId
        ? Prisma.sql`AND "organizationId" = ${opts.organizationId}`
        : Prisma.empty;

      // Build a SQL expression that strips requested keys from the JSONB payload.
      // e.g. stripPayloadFields=['pdf','photos'] → payload - 'pdf' - 'photos'
      const stripFields = opts.stripPayloadFields ?? [];
      const payloadExpr =
        stripFields.length > 0
          ? Prisma.sql`(${Prisma.join(
              [Prisma.sql`payload`, ...stripFields.map((f) => Prisma.sql`${f}`)],
              " - "
            )})`
          : Prisma.sql`payload`;

      const rows = await prisma.$queryRaw<Array<{ payload: unknown; total_count: bigint; entityId: string }>>`
        SELECT ${payloadExpr} AS payload, "entityId", COUNT(*) OVER() AS total_count
        FROM "AppJsonRow"
        WHERE collection = ${collection}
        ${orgFilter}
        ORDER BY "createdAt" DESC
        LIMIT ${opts.pageSize} OFFSET ${skip}
      `;
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      return {
        items: rows.map((r) => mapListedPayload(collection, r.entityId, r.payload)),
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
      };
    }

    // General path: load all rows for this collection/org, sort in JS.
    // Used when branch filtering is required (non-null allowedBranchIds) or no pagination.
    const rows = await prisma.appJsonRow.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { payload: true, entityId: true },
    });
    items = rows.map((r) => {
      const mapped = mapListedPayload(collection, r.entityId, r.payload);
      // Apply stripPayloadFields in Node for the general (non-fast) path.
      if (opts.stripPayloadFields?.length && mapped && typeof mapped === "object") {
        const copy = { ...(mapped as Record<string, unknown>) };
        for (const f of opts.stripPayloadFields) delete copy[f];
        return copy;
      }
      return mapped;
    });
    // Data is already ordered by createdAt DESC from DB; sortCollectionPayloads re-sorts
    // only when the collection uses a non-createdAt primary sort field (e.g. appointments by date).
    items = sortCollectionPayloads(collection, items);
  }

  if (opts.allowedBranchIds !== undefined) {
    items = applyCollectionBranchScope(collection, items, opts.allowedBranchIds);
  }

  if (opts.page && opts.pageSize) {
    const total = items.length;
    const start = (opts.page - 1) * opts.pageSize;
    return {
      items: items.slice(start, start + opts.pageSize),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.ceil(total / opts.pageSize),
    };
  }

  return items;
}

/**
 * Tenant-scoped get. When organizationId is set, the row must belong to that org.
 * When omitted (public / migration), lookup is by collection + entityId only.
 */
export async function getCollectionItem(
  collection: string,
  entityId: string,
  organizationId?: string
): Promise<unknown | null> {
  // Singleton logical id "default" is stored per-org as `{orgId}::default`.
  if (
    isSingletonCollection(collection) &&
    entityId === SINGLETON_ENTITY_ID &&
    organizationId
  ) {
    const scopedId = singletonStorageEntityId(organizationId);
    const scoped = await prisma.appJsonRow.findUnique({
      where: { collection_entityId: { collection, entityId: scopedId } },
    });
    if (scoped && scoped.organizationId === organizationId) {
      return scoped.payload;
    }
    // Legacy rows created before multi-tenant singleton scoping
    const legacy = await prisma.appJsonRow.findUnique({
      where: { collection_entityId: { collection, entityId: SINGLETON_ENTITY_ID } },
    });
    if (legacy && legacy.organizationId === organizationId) {
      return legacy.payload;
    }
    return null;
  }

  const row = await prisma.appJsonRow.findUnique({
    where: { collection_entityId: { collection, entityId } },
  });
  if (!row) return null;
  if (organizationId && row.organizationId !== organizationId) return null;
  return row.payload;
}

export async function upsertCollectionItem(
  collection: string,
  entityId: string,
  payload: unknown,
  organizationId: string,
  ctx?: import("./collection.dispatcher.js").CollectionWriteContext
): Promise<void> {
  assertCollectionWriteAllowed(collection);

  // Singletons: always persist under org-scoped entityId so tenants do not collide on "default".
  const storageEntityId =
    isSingletonCollection(collection) && entityId === SINGLETON_ENTITY_ID
      ? singletonStorageEntityId(organizationId)
      : entityId;

  const existing = await prisma.appJsonRow.findUnique({
    where: { collection_entityId: { collection, entityId: storageEntityId } },
    select: { organizationId: true, payload: true },
  });
  if (existing && existing.organizationId !== organizationId) {
    throw AppError.conflict("Document id already exists in another organization");
  }

  // If a legacy shared "default" row belongs to this org, migrate it on first scoped write.
  if (
    isSingletonCollection(collection) &&
    entityId === SINGLETON_ENTITY_ID &&
    !existing
  ) {
    const legacy = await prisma.appJsonRow.findUnique({
      where: { collection_entityId: { collection, entityId: SINGLETON_ENTITY_ID } },
      select: { organizationId: true },
    });
    if (legacy && legacy.organizationId === organizationId) {
      await prisma.appJsonRow.delete({
        where: { collection_entityId: { collection, entityId: SINGLETON_ENTITY_ID } },
      });
    }
  }

  // Auto-inject user tracking
  const pObj = (payload && typeof payload === "object") ? { ...payload } as Record<string, unknown> : {};
  if (ctx?.userId) {
    if (!existing) {
      pObj.createdByUserId = ctx.userId;
    } else {
      const eObj = (existing.payload && typeof existing.payload === "object") ? existing.payload as Record<string, unknown> : {};
      if (eObj.createdByUserId) pObj.createdByUserId = eObj.createdByUserId;
    }
    pObj.updatedByUserId = ctx.userId;
  }

  // Extract createdAt from payload for correct ordering. Fall back to now() for new rows.
  let createdAt: Date | undefined;
  if (!existing) {
    const raw = pObj.createdAt;
    if (typeof raw === "string" && raw) {
      const t = new Date(raw);
      if (!isNaN(t.getTime())) createdAt = t;
    }
  }

  await prisma.appJsonRow.upsert({
    where: { collection_entityId: { collection, entityId: storageEntityId } },
    create: {
      collection,
      entityId: storageEntityId,
      organizationId,
      payload: pObj as import("@prisma/client").Prisma.InputJsonObject,
      ...(createdAt ? { createdAt } : {}),
    },
    update: { payload: pObj as import("@prisma/client").Prisma.InputJsonObject, organizationId },
  });

  // Generic activity log (skip if activityLogs collection itself or if explicitly bypassed)
  if (ctx && ctx.userId && collection !== "activityLogs" && !ctx.skipGenericActivityLog) {
    const { logBusinessActivity } = await import("../../services/activity-logger.service.js");
    await logBusinessActivity(ctx, {
      action: existing ? `UPDATE_${collection.toUpperCase()}` : `CREATE_${collection.toUpperCase()}`,
      entityType: collection,
      entityId: isSingletonCollection(collection) ? SINGLETON_ENTITY_ID : entityId,
    });
  }
}

export async function deleteCollectionItem(
  collection: string,
  entityId: string,
  organizationId: string,
  ctx?: import("./collection.dispatcher.js").CollectionWriteContext
): Promise<boolean> {
  const existing = await prisma.appJsonRow.findUnique({
    where: { collection_entityId: { collection, entityId } },
    select: { organizationId: true },
  });
  if (!existing) return false;
  if (existing.organizationId !== organizationId) return false;
  try {
    await prisma.appJsonRow.delete({
      where: { collection_entityId: { collection, entityId } },
    });
    
    if (ctx && ctx.userId && collection !== "activityLogs" && !ctx.skipGenericActivityLog) {
      const { logBusinessActivity } = await import("../../services/activity-logger.service.js");
      await logBusinessActivity(ctx, {
        action: `DELETE_${collection.toUpperCase()}`,
        entityType: collection,
        entityId,
      });
    }
    
    return true;
  } catch {
    return false;
  }
}

export async function replaceCollectionArray(
  collection: string,
  items: { id: string }[],
  organizationId: string,
  ctx?: import("./collection.dispatcher.js").CollectionWriteContext
): Promise<void> {
  assertCollectionWriteAllowed(collection);

  if (!isArrayCollection(collection)) {
    throw new Error("replaceCollectionArray only for array collections");
  }
  const byId = new Map<string, { id: string }>();
  for (const item of items) {
    if (!item || typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id) continue;
    byId.set(id, { ...item, id });
  }
  const uniqueItems = [...byId.values()];

  // Guard: reject empty snapshots for financial collections when data exists.
  await assertNonEmptySnapshotForFinancialCollections(collection, uniqueItems, organizationId);

  // Reject snapshot that would clobber another org's entity ids.
  if (uniqueItems.length > 0) {
    const foreign = await prisma.appJsonRow.findMany({
      where: {
        collection,
        entityId: { in: uniqueItems.map((i) => i.id) },
        NOT: { organizationId },
      },
      select: { entityId: true },
      take: 1,
    });
    if (foreign.length > 0) {
      throw AppError.conflict("Snapshot contains ids owned by another organization");
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appJsonRow:${organizationId}:${collection}`}))`;
      // Fetch existing rows to map createdByUserId across wipe
      const existingRows = await tx.appJsonRow.findMany({
        where: { collection, organizationId },
        select: { entityId: true, payload: true },
      });
      const createdByMap = new Map<string, string>();
      for (const row of existingRows) {
        if (row.payload && typeof row.payload === "object") {
          const cb = (row.payload as Record<string, unknown>).createdByUserId;
          if (typeof cb === "string") createdByMap.set(row.entityId, cb);
        }
      }

      await tx.appJsonRow.deleteMany({ where: { collection, organizationId } });
      if (uniqueItems.length === 0) return;
      await tx.appJsonRow.createMany({
        data: uniqueItems.map((item) => {
          const pObj = { ...item } as Record<string, unknown>;
          
          if (ctx?.userId) {
            const existingCb = createdByMap.get(item.id);
            pObj.createdByUserId = existingCb || ctx.userId;
            pObj.updatedByUserId = ctx.userId;
          } else {
            // Restore even if ctx.userId is missing (e.g. system sync)
            const existingCb = createdByMap.get(item.id);
            if (existingCb) pObj.createdByUserId = existingCb;
          }

          let createdAt: Date | undefined;
          const raw = pObj.createdAt;
          if (typeof raw === "string" && raw) {
            const t = new Date(raw);
            if (!isNaN(t.getTime())) createdAt = t;
          }
          return {
            collection,
            entityId: item.id,
            organizationId,
            payload: pObj as import("@prisma/client").Prisma.InputJsonObject,
            ...(createdAt ? { createdAt } : {}),
          };
        }),
        skipDuplicates: true,
      });
      
      if (ctx && ctx.userId && collection !== "activityLogs" && !ctx.skipGenericActivityLog) {
        const { logBusinessActivity } = await import("../../services/activity-logger.service.js");
        await logBusinessActivity(ctx, {
          action: `REPLACE_${collection.toUpperCase()}`,
          entityType: collection,
          entityId: "BULK",
        });
      }
    },
    { timeout: 30_000 }
  );
}

export async function upsertSingleton(
  collection: string,
  payload: unknown,
  organizationId: string,
  ctx?: import("./collection.dispatcher.js").CollectionWriteContext
): Promise<void> {
  if (!isSingletonCollection(collection)) {
    throw new Error("Not a singleton collection");
  }
  await upsertCollectionItem(collection, SINGLETON_ENTITY_ID, payload, organizationId, ctx);
}
