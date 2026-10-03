import { prisma } from "../../lib/prisma.js";
import {
  REFERRER_POINTS_ON_PAID,
  resolvePlatformReferral,
} from "../../lib/platform-referral.js";
import type { SubscriptionPricingBreakdown } from "../../lib/subscription-pricing.js";

export async function creditReferrerWalletForPaidSubscription(opts: {
  refereeOrganizationId: string;
  paymentId: string;
  breakdown?: SubscriptionPricingBreakdown | null;
  /** Used when admin mark-paid has no pricing snapshot on the payment notes. */
  referralCodeFallback?: string | null;
}): Promise<void> {
  const { paymentId, refereeOrganizationId } = opts;
  const fromBreakdown =
    opts.breakdown?.referralApplied && opts.breakdown.referralCode
      ? {
          code: opts.breakdown.referralCode,
          discount: opts.breakdown.referralDiscount,
          referrerOrganizationId: opts.breakdown.referrerOrganizationId,
        }
      : null;

  let code = fromBreakdown?.code ?? null;
  let discount = fromBreakdown?.discount ?? 0;
  let referrerId = fromBreakdown?.referrerOrganizationId ?? null;

  if (!code) {
    code = opts.referralCodeFallback?.trim().toUpperCase() || null;
  }
  if (!code) return;

  if (!referrerId || !fromBreakdown) {
    const resolved = await resolvePlatformReferral({
      raw: code,
      refereeOrganizationId,
    });
    if (resolved.message || !resolved.code) return;
    code = resolved.code;
    referrerId = resolved.referrerOrganizationId;
    if (!fromBreakdown) discount = resolved.discountAmount;
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
          referralCode: code!,
          sourceOrganizationId: refereeOrganizationId,
          paymentId,
          notes: `+${REFERRER_POINTS_ON_PAID} points for referred subscription payment`,
        },
      });
      if (discount > 0) {
        await tx.referralTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REFEREE_DISCOUNT",
            points: 0,
            amountInr: discount,
            referralCode: code!,
            sourceOrganizationId: refereeOrganizationId,
            paymentId,
            notes: `Referee discount ₹${discount.toFixed(2)} on first paid plan`,
          },
        });
      }
    });
  } catch (err) {
    const errCode =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (errCode === "P2002") return;
    throw err;
  }
}
