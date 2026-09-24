/**
 * Reserved organization slugs that would collide with platform / app routes.
 * Used at provision and any future slug update.
 */

const RESERVED = new Set(
  [
    "",
    "www",
    "login",
    "signup",
    "register",
    "pricing",
    "features",
    "solutions",
    "about",
    "contact",
    "demo",
    "faq",
    "privacy",
    "terms",
    "forgot-password",
    "reset-password",
    "how-it-works",
    "assets",
    "static",
    "images",
    "favicon.ico",
    "robots.txt",
    "sitemap.xml",
    "sitemap",
    "robots",
    "api",
    "admin",
    "platform",
    "saas-admin",
    "customer",
    "dashboard",
    "job-cards",
    "billing",
    "settings",
    "staff",
    "customers",
    "vehicles",
    "inventory",
    "reports",
    "messages",
    "activity",
    "notifications",
    "profile",
    "change-password",
    "public-invoice",
    "public-ledger",
    "attendance",
    "backend-api",
    "backend-uploads",
    "uploads",
    "_next",
    "health",
  ].map((s) => s.toLowerCase())
);

export function isReservedOrganizationSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return true;
  if (RESERVED.has(normalized)) return true;
  if (normalized.includes(".")) return true;
  return false;
}

export function listReservedOrganizationSlugs(): string[] {
  return [...RESERVED].filter(Boolean).sort();
}

/** Lowercase kebab slug from a display name. */
export function slugifyOrganizationName(raw: string): string {
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "workshop";
}

/**
 * If the candidate is reserved, append a safe suffix (e.g. login → login-workshop).
 */
export function ensureNonReservedSlug(candidate: string): string {
  let slug = slugifyOrganizationName(candidate);
  if (!isReservedOrganizationSlug(slug)) return slug;
  const withSuffix = `${slug}-workshop`.slice(0, 56);
  if (!isReservedOrganizationSlug(withSuffix)) return withSuffix;
  return `org-${Date.now().toString(36)}`.slice(0, 56);
}
