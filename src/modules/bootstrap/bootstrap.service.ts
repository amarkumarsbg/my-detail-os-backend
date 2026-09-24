import { prisma } from "../../lib/prisma.js";
import { SINGLETON_ENTITY_ID, singletonStorageEntityId } from "../../constants/json-collections.js";
import { listBranchesApi } from "../branches/branch-api.service.js";
import { getEntitlementForOrg } from "../organization/organization-subscription.service.js";
import {
  extractBranding,
  type BrandingPayload,
} from "../../lib/data-scope.js";
import { SimpleCache } from "../../lib/simple-cache.js";
import type { AuthUser } from "../../middleware/auth.js";

export type ThinBootstrapPayload = {
  branches: Awaited<ReturnType<typeof listBranchesApi>>;
  branding: BrandingPayload;
  entitlement: Awaited<ReturnType<typeof getEntitlementForOrg>> | null;
};

/** Cache branding per org for 60 seconds — it changes rarely. */
const brandingCache = new SimpleCache<BrandingPayload>(60_000);

async function resolveOrganizationId(auth?: AuthUser): Promise<string | undefined> {
  let organizationId = auth?.organizationId;
  if (!organizationId && auth?.id) {
    const row = await prisma.user.findUnique({
      where: { id: auth.id },
      select: { organizationId: true },
    });
    organizationId = row?.organizationId;
  }
  return organizationId;
}

async function loadBranding(organizationId?: string): Promise<BrandingPayload> {
  const cacheKey = organizationId ?? "__global__";
  return brandingCache.getOrLoad(cacheKey, async () => {
    const row = organizationId
      ? await prisma.appJsonRow.findFirst({
          where: {
            collection: "appSettings",
            organizationId,
            OR: [
              { entityId: singletonStorageEntityId(organizationId) },
              { entityId: SINGLETON_ENTITY_ID },
            ],
          },
          orderBy: { updatedAt: "desc" },
          select: { payload: true },
        })
      : await prisma.appJsonRow.findUnique({
          where: {
            collection_entityId: { collection: "appSettings", entityId: SINGLETON_ENTITY_ID },
          },
          select: { payload: true },
        });
    return extractBranding(row?.payload ?? null);
  });
}

/**
 * Shell-only bootstrap: org branches, public branding, entitlement.
 * Domain collections/entities are loaded via permission-scoped APIs.
 */
export async function getBootstrapPayload(auth?: AuthUser): Promise<ThinBootstrapPayload> {
  const organizationId = await resolveOrganizationId(auth);

  const [branches, branding, entitlement] = await Promise.all([
    listBranchesApi(organizationId),
    loadBranding(organizationId),
    organizationId ? getEntitlementForOrg(organizationId) : Promise.resolve(null),
  ]);

  return {
    branches,
    branding,
    entitlement,
  };
}
