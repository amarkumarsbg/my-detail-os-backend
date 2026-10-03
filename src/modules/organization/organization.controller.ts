import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  adminMarkSubscriptionPaid,
  createAdminPaymentLink,
  getAddOnPricingQuote,
  getEntitlementForOrg,
  getOrganizationForPlatform,
  getSubscriptionPricingQuote,
  getSubscriptionBill,
  listOrganizationsForPlatform,
  listSubscriptionBills,
  listSubscriptionPayments,
  listSubscriptionRenewalHistory,
  patchOrganizationSubscription,
  confirmRazorpaySubscriptionPayment,
  requestSubscriptionAddOns,
  requestSubscriptionRenewal,
  resendAdminPaymentLink,
  syncRazorpaySubscriptionPayment,
  verifySubscriptionPayment,
} from "./organization-subscription.service.js";
import { AppHttpError } from "../../lib/app-http-error.js";
import { parsePlanLimits } from "../../lib/plan-catalog.js";
import { prisma } from "../../lib/prisma.js";
import { isRazorpayEnabled } from "../../lib/razorpay.js";

async function resolveOrgId(req: Request): Promise<string | undefined> {
  if (req.auth?.organizationId) return req.auth.organizationId;
  if (!req.auth?.id) return undefined;
  const row = await prisma.user.findUnique({
    where: { id: req.auth.id },
    select: { organizationId: true },
  });
  return row?.organizationId;
}

function actorFromReq(req: Request): string {
  return (
    (req as Request & { platformActor?: string }).platformActor ??
    (req.auth ? `user:${req.auth.id}` : "unknown")
  );
}

export async function getStudioSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      res.status(403).json({
        data: null,
        error: { message: "Organization not found on user", code: "ORG_MISSING" },
      });
      return;
    }
    const entitlement = await getEntitlementForOrg(orgId);
    if (!entitlement) {
      res.status(404).json({
        data: null,
        error: { message: "Subscription not found", code: "SUBSCRIPTION_MISSING" },
      });
      return;
    }
    res.json({ data: entitlement, error: null });
  } catch (e) {
    next(e);
  }
}

export async function postStudioRenewRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const body = z
      .object({
        notes: z.string().max(500).optional(),
        method: z.string().max(64).optional(),
        planCode: z
          .string()
          .min(2)
          .max(24)
          .regex(/^[A-Z][A-Z0-9_]{1,23}$/)
          .optional(),
        termMonths: z.union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
        extraBranches: z.number().int().nonnegative().optional(),
        extraUsers: z.number().int().nonnegative().optional(),
        referralCode: z.string().max(32).nullable().optional(),
        preferOnline: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const user = req.auth?.id
      ? await prisma.user.findUnique({
          where: { id: req.auth.id },
          select: { name: true, email: true, phone: true },
        })
      : null;

    const result = await requestSubscriptionRenewal(orgId, actorFromReq(req), {
      ...body,
      payerName: user?.name,
      payerEmail: user?.email,
      payerPhone: user?.phone,
    });
    res.json({ data: result, error: null });
  } catch (e) {
    next(e);
  }
}

export async function postStudioConfirmRazorpayPayment(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    if (!isRazorpayEnabled()) {
      throw new AppHttpError(503, "Online payments are not configured", "GATEWAY_DISABLED");
    }
    const body = z
      .object({
        paymentId: z.string().min(1),
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1),
        razorpaySignature: z.string().min(1),
      })
      .parse(req.body ?? {});
    const entitlement = await confirmRazorpaySubscriptionPayment(
      orgId,
      body,
      actorFromReq(req)
    );
    res.json({ data: { entitlement }, error: null });
  } catch (e) {
    next(e);
  }
}

/** Recover Checkout success when the browser never posted the signature (modal race). */
export async function postStudioSyncRazorpayPayment(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    if (!isRazorpayEnabled()) {
      throw new AppHttpError(503, "Online payments are not configured", "GATEWAY_DISABLED");
    }
    const body = z
      .object({
        paymentId: z.string().min(1),
        razorpayOrderId: z.string().min(1).optional(),
        abandonIfUnpaid: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const entitlement = await syncRazorpaySubscriptionPayment(
      orgId,
      body,
      actorFromReq(req)
    );
    res.json({ data: { entitlement }, error: null });
  } catch (e) {
    next(e);
  }
}

export async function getStudioPaymentConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      data: {
        provider: isRazorpayEnabled() ? "RAZORPAY" : "MANUAL",
        onlineEnabled: isRazorpayEnabled(),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

export async function postStudioSubscriptionPricing(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const body = z
      .object({
        planCode: z
          .string()
          .min(2)
          .max(24)
          .regex(/^[A-Z][A-Z0-9_]{1,23}$/)
          .optional(),
        termMonths: z.union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(36), z.literal(60)]),
        extraBranches: z.number().int().nonnegative().default(0),
        extraUsers: z.number().int().nonnegative().default(0),
        referralCode: z.string().max(32).nullable().optional(),
      })
      .parse(req.body ?? {});
    const quote = await getSubscriptionPricingQuote(orgId, body);
    res.json({ data: quote, error: null });
  } catch (e) {
    next(e);
  }
}

export async function postStudioAddOnPricing(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const body = z
      .object({
        extraBranches: z.number().int().nonnegative().default(0),
        extraUsers: z.number().int().nonnegative().default(0),
      })
      .parse(req.body ?? {});
    const quote = await getAddOnPricingQuote(orgId, body);
    res.json({ data: quote, error: null });
  } catch (e) {
    next(e);
  }
}

export async function postStudioAddOnRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const body = z
      .object({
        notes: z.string().max(500).optional(),
        method: z.string().max(64).optional(),
        extraBranches: z.number().int().nonnegative().optional(),
        extraUsers: z.number().int().nonnegative().optional(),
        preferOnline: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const user = req.auth?.id
      ? await prisma.user.findUnique({
          where: { id: req.auth.id },
          select: { name: true, email: true, phone: true },
        })
      : null;

    const result = await requestSubscriptionAddOns(orgId, actorFromReq(req), {
      ...body,
      payerName: user?.name,
      payerEmail: user?.email,
      payerPhone: user?.phone,
    });
    res.json({ data: result, error: null });
  } catch (e) {
    next(e);
  }
}

export async function getStudioSubscriptionRenewals(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const renewals = await listSubscriptionRenewalHistory(orgId);
    res.json({ data: { renewals }, error: null });
  } catch (e) {
    next(e);
  }
}

export async function getStudioSubscriptionBills(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const bills = await listSubscriptionBills(orgId);
    res.json({ data: { bills }, error: null });
  } catch (e) {
    next(e);
  }
}

export async function getStudioSubscriptionBill(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) {
      throw new AppHttpError(403, "Organization not found on user", "ORG_MISSING");
    }
    const billId = Array.isArray(req.params.billId) ? req.params.billId[0]! : req.params.billId!;
    const bill = await getSubscriptionBill(orgId, billId);
    if (!bill) {
      throw new AppHttpError(404, "Bill not found", "BILL_NOT_FOUND");
    }
    res.json({ data: bill, error: null });
  } catch (e) {
    next(e);
  }
}

const listOrgsQuerySchema = z.object({
  subscriptionStatus: z
    .enum(["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED", "TRIAL"])
    .optional(),
});

export async function listPlatformOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listOrgsQuerySchema.parse(req.query ?? {});
    const organizations = await listOrganizationsForPlatform({
      subscriptionStatus: query.subscriptionStatus,
    });
    res.json({ data: { organizations }, error: null });
  } catch (e) {
    next(e);
  }
}

function paramOrgId(req: Request): string {
  const raw = req.params.orgId;
  return Array.isArray(raw) ? raw[0]! : raw!;
}

export async function getPlatformOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = paramOrgId(req);
    const entitlement = await getOrganizationForPlatform(orgId);
    if (!entitlement) {
      res.status(404).json({ data: null, error: { message: "Organization not found" } });
      return;
    }
    const [payments, bills] = await Promise.all([
      listSubscriptionPayments(orgId),
      listSubscriptionBills(orgId),
    ]);
    res.json({ data: { ...entitlement, payments, bills }, error: null });
  } catch (e) {
    next(e);
  }
}

const patchSchema = z.object({
  planCode: z.string().min(2).max(24).regex(/^[A-Z][A-Z0-9_]{1,23}$/).optional(),
  planName: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED", "TRIAL"]).optional(),
  limits: z
    .object({
      maxBranches: z.number().int().nonnegative().nullable(),
      maxStaff: z.number().int().nonnegative().nullable().optional(),
      maxCustomers: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
  maxBranchesOverride: z.number().int().nonnegative().nullable().optional(),
  maxUsersOverride: z.number().int().nonnegative().nullable().optional(),
  contactUsUrl: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  upgradeUrl: z.string().nullable().optional(),
  termMonths: z.union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  paymentStatus: z.enum(["PAID", "PENDING", "PROCESSING", "FAILED"]).optional(),
  lastPaymentTxnId: z.string().nullable().optional(),
});

export async function patchPlatformOrganizationSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const orgId = paramOrgId(req);
    const body = patchSchema.parse(req.body);
    const entitlement = await patchOrganizationSubscription(
      orgId,
      {
        ...body,
        limits: body.limits ? parsePlanLimits(body.limits) : undefined,
        startsAt: body.startsAt === undefined ? undefined : body.startsAt ? new Date(body.startsAt) : null,
        expiresAt:
          body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt) : null,
      },
      actorFromReq(req)
    );
    res.json({ data: entitlement, error: null });
  } catch (e) {
    if (e instanceof AppHttpError) {
      next(e);
      return;
    }
    next(e);
  }
}

const verifySchema = z.object({
  paymentId: z.string().min(1),
  outcome: z.enum(["PAID", "FAILED"]),
  txnReference: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function postPlatformVerifyPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = paramOrgId(req);
    const body = verifySchema.parse(req.body);
    const entitlement = await verifySubscriptionPayment(orgId, body, actorFromReq(req));
    res.json({ data: entitlement, error: null });
  } catch (e) {
    next(e);
  }
}

const markPaidSchema = z.object({
  txnReference: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  termMonths: z.union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
  notes: z.string().nullable().optional(),
});

export async function postPlatformMarkPaid(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = paramOrgId(req);
    const body = markPaidSchema.parse(req.body ?? {});
    const entitlement = await adminMarkSubscriptionPaid(orgId, actorFromReq(req), body);
    res.json({ data: entitlement, error: null });
  } catch (e) {
    next(e);
  }
}

const paymentLinkSchema = z.object({
  planCode: z.string().min(1).max(64),
  termMonths: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(12),
    z.literal(24),
    z.literal(36),
    z.literal(60),
  ]),
  extraBranches: z.number().int().min(0).optional(),
  extraUsers: z.number().int().min(0).optional(),
  referralCode: z.string().max(32).nullable().optional(),
  discountType: z.enum(["NONE", "FLAT", "PERCENTAGE", "CODE"]).optional(),
  discountValue: z.number().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sendVia: z.array(z.enum(["email", "sms", "whatsapp"])).optional(),
  customerEmail: z.string().email().nullable().optional(),
  customerPhone: z.string().max(32).nullable().optional(),
});

export async function postPlatformPaymentLink(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = paramOrgId(req);
    const body = paymentLinkSchema.parse(req.body ?? {});
    const data = await createAdminPaymentLink(orgId, actorFromReq(req), body);
    res.json({ data, error: null });
  } catch (e) {
    next(e);
  }
}

const paymentLinkResendSchema = z.object({
  medium: z.enum(["email", "sms", "whatsapp"]),
});

export async function postPlatformPaymentLinkResend(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = paramOrgId(req);
    const paymentId = Array.isArray(req.params.paymentId)
      ? req.params.paymentId[0]!
      : req.params.paymentId!;
    const body = paymentLinkResendSchema.parse(req.body ?? {});
    const data = await resendAdminPaymentLink(orgId, paymentId, body.medium, actorFromReq(req));
    res.json({ data, error: null });
  } catch (e) {
    next(e);
  }
}
