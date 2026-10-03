import { prisma } from "./prisma.js";

export const REFERRAL_CODE_REGEX = /^[A-Z0-9-]{4,24}$/;
export const REFERRER_POINTS_ON_PAID = 500;

export type ResolvedPlatformReferral = {
  code: string | null;
  message: string | null;
  discountAmount: number;
  referrerOrganizationId: string | null;
};

export async function resolvePlatformReferral(opts: {
  raw?: string | null;
  refereeOrganizationId?: string | null;
}): Promise<ResolvedPlatformReferral> {
  const empty: ResolvedPlatformReferral = {
    code: null,
    message: null,
    discountAmount: 0,
    referrerOrganizationId: null,
  };
  const code = opts.raw?.trim().toUpperCase() ?? "";
  if (!code) return empty;
  if (!REFERRAL_CODE_REGEX.test(code)) {
    return { ...empty, message: "Invalid referral code format." };
  }

  const row = await prisma.platformReferralCode.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
  });
  if (!row || !row.isActive) {
    return {
      code,
      message: "Unknown or inactive referral code.",
      discountAmount: 0,
      referrerOrganizationId: null,
    };
  }
  if (opts.refereeOrganizationId && row.organizationId === opts.refereeOrganizationId) {
    return {
      code: row.code,
      message: "You cannot use your own referral code.",
      discountAmount: 0,
      referrerOrganizationId: row.organizationId,
    };
  }
  return {
    code: row.code,
    message: null,
    discountAmount: Math.max(0, row.discountAmount),
    referrerOrganizationId: row.organizationId,
  };
}

export async function inheritedSignupReferralCode(organizationId: string): Promise<string | null> {
  const row = await prisma.platformAuditLog.findFirst({
    where: { organizationId, action: "organization.provisioned" },
    orderBy: { createdAt: "asc" },
    select: { after: true },
  });
  const after = row?.after;
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const code = (after as { referralCode?: unknown }).referralCode;
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}
