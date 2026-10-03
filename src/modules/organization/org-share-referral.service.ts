import { prisma } from "../../lib/prisma.js";
import { getResolvedSubscriptionPricing } from "../../lib/platform-settings.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSuffix(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return out;
}

function prefixFromOrg(slug: string | null, name: string): string {
  const raw = (slug ?? name).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefix = (raw.slice(0, 8) || "ORG").padEnd(3, "X");
  return prefix.slice(0, 8);
}

function candidateCode(slug: string | null, name: string): string {
  return `${prefixFromOrg(slug, name)}-${randomSuffix(4)}`;
}

/**
 * Paid / converted orgs get one shareable platform referral code.
 * Trial orgs do not receive a code until they convert.
 */
export async function ensureOrgShareReferralCode(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true, partnerReferral: true },
  });
  if (!org?.subscription) return null;
  if (org.subscription.status === "TRIAL") return org.partnerReferral?.code ?? null;
  if (org.partnerReferral?.code) return org.partnerReferral.code;

  const pricing = await getResolvedSubscriptionPricing();
  const discountAmount = Math.max(0, pricing.addOns.referralDiscount ?? 1000);

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = candidateCode(org.slug, org.name);
    const clash = await prisma.platformReferralCode.findUnique({ where: { code } });
    if (clash) continue;
    try {
      const created = await prisma.platformReferralCode.create({
        data: {
          id: `ref-org-${organizationId.slice(0, 8)}-${randomSuffix(4).toLowerCase()}`,
          code,
          discountAmount,
          isActive: true,
          createdBy: "system:trial-convert",
          notes: `Partner code for ${org.name}`,
          organizationId: org.id,
        },
      });
      return created.code;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unique") || msg.includes("unique")) continue;
      throw err;
    }
  }
  return null;
}
