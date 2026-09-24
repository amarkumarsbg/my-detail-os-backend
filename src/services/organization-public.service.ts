import { prisma } from "../lib/prisma.js";
import { SINGLETON_ENTITY_ID, singletonStorageEntityId } from "../constants/json-collections.js";
import { isReservedOrganizationSlug } from "../lib/reserved-slugs.js";
import { PLATFORM_BRAND_NAME } from "../constants/platform-brand.js";
import { AppHttpError } from "../lib/app-http-error.js";

export type PublicOrganizationBySlug = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  subscriptionStatus: string | null;
};

export async function getOrganizationBySlug(slugRaw: string): Promise<PublicOrganizationBySlug> {
  const slug = slugRaw.trim().toLowerCase();
  if (!slug || slug.includes(".") || isReservedOrganizationSlug(slug)) {
    throw new AppHttpError(404, "Organization not found.", "ORG_NOT_FOUND");
  }

  const org = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      subscription: { select: { status: true } },
    },
  });

  if (!org || !org.slug) {
    throw new AppHttpError(404, "Organization not found.", "ORG_NOT_FOUND");
  }

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    isActive: org.isActive,
    subscriptionStatus: org.subscription?.status ?? null,
  };
}

export type TenantPublicBranding = {
  businessName: string;
  businessLogo: string;
  brandPrimary: string;
  loginBackgroundImage: string;
  loginHeroHeading: string;
  loginHeroDescription: string;
  businessPhone?: string;
  businessEmail?: string;
  businessWhatsApp?: string;
  organizationId: string;
  organizationSlug: string;
  isActive: boolean;
  subscriptionStatus: string | null;
};

const DEFAULT_BRAND_PRIMARY = "#0D9488";

/** Org-scoped appSettings branding for unauthenticated tenant surfaces. */
export async function getTenantPublicBranding(slugRaw: string): Promise<TenantPublicBranding> {
  const org = await getOrganizationBySlug(slugRaw);

  const row = await prisma.appJsonRow.findFirst({
    where: {
      collection: "appSettings",
      organizationId: org.id,
      OR: [
        { entityId: singletonStorageEntityId(org.id) },
        { entityId: SINGLETON_ENTITY_ID },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { payload: true },
  });

  const raw = (row?.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");

  return {
    businessName: str("businessName") || org.name || PLATFORM_BRAND_NAME,
    businessLogo: str("businessLogo"),
    brandPrimary: str("brandPrimary") || DEFAULT_BRAND_PRIMARY,
    loginBackgroundImage: str("loginBackgroundImage"),
    loginHeroHeading: str("loginHeroHeading") || `Welcome to ${org.name}`,
    loginHeroDescription:
      str("loginHeroDescription") || "Sign in to manage your workshop operations.",
    businessPhone: str("businessPhone") || undefined,
    businessEmail: str("businessEmail") || undefined,
    businessWhatsApp: str("businessWhatsApp") || undefined,
    organizationId: org.id,
    organizationSlug: org.slug,
    isActive: org.isActive,
    subscriptionStatus: org.subscriptionStatus,
  };
}
