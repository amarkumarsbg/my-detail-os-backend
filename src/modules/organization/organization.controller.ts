import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  adminMarkSubscriptionPaid,
  getEntitlementForOrg,
  getOrganizationForPlatform,
  getSubscriptionPricingQuote,
  getSubscriptionBill,
  listOrganizationsForPlatform,
  listSubscriptionBills,
  listSubscriptionPayments,
  listSubscriptionRenewalHistory,
  patchOrganizationSubscription,
  requestSubscriptionRenewal,
  verifySubscriptionPayment,
} from "./organization-subscription.service.js";
import { AppHttpError } from "../../lib/app-http-error.js";
import { parsePlanLimits } from "../../lib/plan-catalog.js";
import { prisma } from "../../lib/prisma.js";

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
        termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
        extraBranches: z.number().int().nonnegative().optional(),
        extraUsers: z.number().int().nonnegative().optional(),
        referralCode: z.string().max(32).nullable().optional(),
      })
      .parse(req.body ?? {});
    const result = await requestSubscriptionRenewal(orgId, actorFromReq(req), body);
    res.json({ data: result, error: null });
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
        termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(60)]),
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

export async function listPlatformOrganizations(_req: Request, res: Response, next: NextFunction) {
  try {
    const organizations = await listOrganizationsForPlatform();
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
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
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
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
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
