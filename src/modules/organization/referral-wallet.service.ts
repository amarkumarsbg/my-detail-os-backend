import { prisma } from "../../lib/prisma.js";
import {
  REFERRER_POINTS_ON_PAID,
  resolvePlatformReferral,
} from "../../lib/platform-referral.js";
import type { SubscriptionPricingBreakdown } from "../../lib/subscription-pricing.js";

export async function creditReferrerWalletForPaidSubscription(opts: {
  refereeOrganizationId: string;
  paymentId: string;
  breakdown: SubscriptionPricingBreakdown;
}): Promise<void> {
  const { breakdown, paymentId, refereeOrganizationId } = opts;
  if (!breakdown.referralApplied || !breakdown.referralCode) return;

  let referrerId = breakdown.referrerOrganizationId;
  if (!referrerId) {
    const resolved = await resolvePlatformReferral({
      raw: breakdown.referralCode,
      refereeOrganizationId,
    });
    if (resolved.message) return;
    referrerId = resolved.referrerOrganizationId;
  }
  if (!referrerId || referrerId === refereeOrganizationId) return;

  const existing = await prisma.referralTransaction.findFirst({
    where: { paymentId, type: "REFERRER_POINTS" },
  });
  if (existing) return;

  try {
    await prisma.$transaction(async (tx) => {
    const wallet = await tx.referralWallet.upsert({
      where: { organizationId: referrerId },
      create: { organizationId: referrerId, points: REFERRER_POINTS_ON_PAID },
      update: { points: { increment: REFERRER_POINTS_ON_PAID } },
    });
    await tx.referralTransaction.create({
      data: {
        walletId: wallet.id,
        type: "REFERRER_POINTS",
        points: REFERRER_POINTS_ON_PAID,
        amountInr: 0,
        referralCode: breakdown.referralCode!,
        sourceOrganizationId: refereeOrganizationId,
        paymentId,
        notes: `+${REFERRER_POINTS_ON_PAID} points for referred subscription payment`,
      },
    });
    if (breakdown.referralDiscount > 0) {
      await tx.referralTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REFEREE_DISCOUNT",
          points: 0,
          amountInr: breakdown.referralDiscount,
          referralCode: breakdown.referralCode!,
          sourceOrganizationId: refereeOrganizationId,
          paymentId,
          notes: `Referee discount ₹${breakdown.referralDiscount.toFixed(2)} on first paid plan`,
        },
      });
    }
  });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "P2002") return;
    throw err;
  }
}
