import { prisma } from "./prisma.js";
import { ensureNonReservedSlug } from "./reserved-slugs.js";

function shortSuffix(): string {
  return Date.now().toString(36).slice(-5);
}

/**
 * Guarantee an organization has a public slug (persist if missing).
 * Used on auth success so marketing → workshop handoff never stalls on null slug.
 */
export async function ensureOrganizationHasSlug(organizationId: string): Promise<{
  id: string;
  name: string;
  slug: string;
} | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) return null;

  const existing = (org.slug ?? "").trim().toLowerCase();
  if (existing) {
    return { id: org.id, name: org.name, slug: existing };
  }

  let slug = ensureNonReservedSlug(org.name || organizationId);
  const taken = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (taken && taken.id !== org.id) {
    slug = ensureNonReservedSlug(`${slug}-${shortSuffix()}`);
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { slug },
    select: { id: true, name: true, slug: true },
  });

  return {
    id: updated.id,
    name: updated.name,
    slug: (updated.slug ?? slug).trim().toLowerCase(),
  };
}
