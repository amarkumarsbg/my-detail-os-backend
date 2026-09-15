/**
 * Platform control-plane handlers:
 * - GET  /api/platform/dashboard
 * - GET  /api/platform/users
 * - GET  /api/platform/branches
 * - GET  /api/platform/renewals|bills|payments|audit
 * - GET/POST/PATCH /api/platform/referrals
 * - GET/PUT/POST /api/platform/plans (+ PATCH/DELETE /plans/:code)
 * - GET/PUT /api/platform/settings
 * - GET  /api/platform/messaging
 * - POST /api/platform/organizations/:orgId/suspend|restore
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppHttpError } from "../../lib/app-http-error.js";
import { writePlatformAuditLog } from "../../lib/platform-audit.js";
import { env } from "../../config/env.js";
import { normalizePlanCode, parsePlanLimits } from "../../lib/plan-catalog.js";
import type { SubscriptionPricingPatch } from "../../lib/subscription-pricing.js";
import {
  createPlatformPlan,
  deletePlatformPlan,
  getEffectivePlanCatalog,
  getPlatformSettings,
  updatePlatformPlan,
  updatePlatformSettings,
  type PlatformSettingsPayload,
} from "../../lib/platform-settings.js";
import {
  isTwilioSmsEnabled,
  isTwilioWhatsAppEnabled,
} from "../../services/twilio-sms.service.js";
import { isResendConfigured } from "../../services/resend-send.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function actorFromReq(req: Request): string {
  const auth = (req as Request & { auth?: { id?: string; email?: string } }).auth;
  if (auth?.email) return auth.email;
  if (auth?.id) return `user:${auth.id}`;
  const platformActor = (req as Request & { platformActor?: string }).platformActor;
  return platformActor ?? "platform-api-key";
}

function parseDateFilter(raw: unknown): Date | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function pageParams(query: Record<string, unknown>): { skip: number; take: number; page: number } {
  const take = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 200);
  const page = Math.max(Number(query.page ?? 1) || 1, 1);
  return { skip: (page - 1) * take, take, page };
}

function parseBoolQuery(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  return undefined;
}

const PLAN_CODE_STRING = z
  .string()
  .min(2)
  .max(24)
  .transform((s) => normalizePlanCode(s))
  .refine((s) => /^[A-Z][A-Z0-9_]{1,23}$/.test(s), "Invalid plan code");

// ─── GET /api/platform/dashboard ─────────────────────────────────────────────

export async function getPlatformDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      orgTotal,
      orgActive,
      orgInactive,
      subsByStatus,
      mtdPaidAgg,
      pendingPayments,
      activeReferrals,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.organization.count({ where: { isActive: false } }),
      prisma.organizationSubscription.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.subscriptionPayment.aggregate({
        where: {
          status: "PAID",
          OR: [
            { verifiedAt: { gte: monthStart } },
            { verifiedAt: null, createdAt: { gte: monthStart } },
          ],
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.subscriptionPayment.count({ where: { status: "PENDING" } }),
      prisma.platformReferralCode.count({ where: { isActive: true } }),
    ]);

    const subscriptionStatusBreakdown: Record<string, number> = {};
    for (const row of subsByStatus) {
      subscriptionStatusBreakdown[row.status] = row._count._all;
    }

    res.json({
      data: {
        organizations: {
          total: orgTotal,
          active: orgActive,
          inactive: orgInactive,
        },
        subscriptionStatusBreakdown,
        revenueMtd: {
          amount: mtdPaidAgg._sum.amount ?? 0,
          paidPaymentCount: mtdPaidAgg._count._all,
          currency: "INR",
          periodStart: monthStart.toISOString(),
        },
        pendingPayments,
        activeReferrals,
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/users ─────────────────────────────────────────────────

export async function listPlatformUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const role = typeof q.role === "string" ? q.role : undefined;
    const isActive = parseBoolQuery(q.isActive);
    const search = typeof q.search === "string" ? q.search.trim() : undefined;
    const includePlatformOwner = parseBoolQuery(q.includePlatformOwner) === true;

    const where: Prisma.UserWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (role) {
      where.role = role as UserRole;
    } else if (!includePlatformOwner) {
      where.role = { not: "PLATFORM_OWNER" };
    }

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          branchId: true,
          organizationId: true,
          lastLoginAt: true,
          organization: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ organizationId: "asc" }, { name: "asc" }],
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    const users = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      branchId: u.branchId,
      branchName: u.branch.name,
      organizationId: u.organizationId,
      organizationName: u.organization.name,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    }));

    res.json({ data: { users, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/branches ──────────────────────────────────────────────

export async function listPlatformBranches(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const isActive = parseBoolQuery(q.isActive);
    const search = typeof q.search === "string" ? q.search.trim() : undefined;

    const where: Prisma.BranchWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
        },
        orderBy: [{ organizationId: "asc" }, { name: "asc" }],
        skip,
        take,
      }),
      prisma.branch.count({ where }),
    ]);

    const branches = rows.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      isActive: b.isActive,
      code: b.code,
      city: b.city,
      state: b.state,
      pincode: b.pincode,
      email: b.email,
      managerName: b.managerName,
      managerPhone: b.managerPhone,
      organizationId: b.organizationId,
      organizationName: b.organization.name,
    }));

    res.json({ data: { branches, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/renewals ───────────────────────────────────────────────

export async function listPlatformRenewals(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const since = parseDateFilter(q.since);
    const until = parseDateFilter(q.until);
    const paymentStatus = typeof q.paymentStatus === "string" ? q.paymentStatus : undefined;

    const where: Prisma.SubscriptionBillWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(since || until
        ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
      ...(paymentStatus ? { payment: { status: paymentStatus as never } } : {}),
    };

    const [bills, total] = await Promise.all([
      prisma.subscriptionBill.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          payment: {
            select: {
              id: true,
              status: true,
              txnReference: true,
              amount: true,
              method: true,
              verifiedAt: true,
              recordedBy: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.subscriptionBill.count({ where }),
    ]);

    const renewals = bills.map((b) => ({
      billId: b.id,
      billNumber: b.billNumber,
      organizationId: b.organizationId,
      organizationName: b.organization.name,
      planName: b.planName,
      termMonths: b.termMonths,
      termLabel: b.termLabel,
      previousExpiry: b.periodStart.toISOString(),
      newExpiry: b.periodEnd.toISOString(),
      baseAmount: b.baseAmount ?? 0,
      referralDiscount: b.referralDiscount ?? 0,
      gstAmount: b.gstAmount ?? 0,
      totalAmount: b.totalAmount ?? b.amount ?? 0,
      currency: b.currency,
      paymentStatus: b.payment?.status ?? null,
      txnReference: b.payment?.txnReference ?? null,
      renewalDate: b.createdAt.toISOString(),
    }));

    res.json({ data: { renewals, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/bills ──────────────────────────────────────────────────

export async function listPlatformBills(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const since = parseDateFilter(q.since);
    const until = parseDateFilter(q.until);
    const paymentStatus = typeof q.paymentStatus === "string" ? q.paymentStatus : undefined;
    const search = typeof q.search === "string" ? q.search.trim() : undefined;

    const where: Prisma.SubscriptionBillWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(search
        ? {
            OR: [
              { billNumber: { contains: search, mode: "insensitive" } },
              { organization: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(since || until
        ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
      ...(paymentStatus ? { payment: { status: paymentStatus as never } } : {}),
    };

    const [bills, total] = await Promise.all([
      prisma.subscriptionBill.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          payment: {
            select: { id: true, status: true, txnReference: true, verifiedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.subscriptionBill.count({ where }),
    ]);

    const result = bills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      organizationId: b.organizationId,
      organizationName: b.organization.name,
      planName: b.planName,
      termMonths: b.termMonths,
      termLabel: b.termLabel,
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
      baseAmount: b.baseAmount ?? 0,
      extraBranchCost: b.extraBranchCost ?? 0,
      extraUserCost: b.extraUserCost ?? 0,
      onboardingFee: b.onboardingFee ?? 0,
      referralDiscount: b.referralDiscount ?? 0,
      gstPercent: b.gstPercent ?? 0,
      gstAmount: b.gstAmount ?? 0,
      totalAmount: b.totalAmount ?? b.amount ?? 0,
      currency: b.currency,
      paymentStatus: b.payment?.status ?? null,
      txnReference: b.payment?.txnReference ?? null,
      verifiedAt: b.payment?.verifiedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    }));

    res.json({ data: { bills: result, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/payments ───────────────────────────────────────────────

export async function listPlatformPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const status = typeof q.status === "string" ? q.status : undefined;
    const since = parseDateFilter(q.since);
    const until = parseDateFilter(q.until);

    const where: Prisma.SubscriptionPaymentWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(since || until
        ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    };

    const [payments, total] = await Promise.all([
      prisma.subscriptionPayment.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          subscription: { select: { planCode: true, planName: true } },
          bill: { select: { billNumber: true, totalAmount: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.subscriptionPayment.count({ where }),
    ]);

    const result = payments.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      organizationName: p.organization.name,
      planCode: p.subscription.planCode,
      planName: p.subscription.planName,
      billNumber: p.bill?.billNumber ?? null,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      txnReference: p.txnReference,
      method: p.method,
      notes: p.notes,
      recordedBy: p.recordedBy,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));

    res.json({ data: { payments: result, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/audit ──────────────────────────────────────────────────

export async function listPlatformAudit(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const { skip, take } = pageParams(q);
    const orgId = typeof q.orgId === "string" ? q.orgId : undefined;
    const action = typeof q.action === "string" ? q.action : undefined;
    const since = parseDateFilter(q.since);
    const until = parseDateFilter(q.until);

    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(orgId ? { organizationId: orgId } : {}),
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
      ...(since || until
        ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.platformAuditLog.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.platformAuditLog.count({ where }),
    ]);

    const result = logs.map((l) => ({
      id: l.id,
      organizationId: l.organizationId,
      organizationName: l.organization?.name ?? null,
      actor: l.actor,
      action: l.action,
      before: l.before,
      after: l.after,
      createdAt: l.createdAt.toISOString(),
    }));

    res.json({ data: { logs: result, total }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/referrals ─────────────────────────────────────────────

export async function listPlatformReferrals(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, unknown>;
    const showInactive = q.showInactive === "true";

    const codes = await prisma.platformReferralCode.findMany({
      where: showInactive ? {} : { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    const result = codes.map((c) => ({
      id: c.id,
      code: c.code,
      discountAmount: c.discountAmount,
      isActive: c.isActive,
      createdBy: c.createdBy,
      notes: c.notes,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));

    res.json({ data: { referralCodes: result, total: result.length }, error: null });
  } catch (e) {
    next(e);
  }
}

const createReferralSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(24)
    .regex(/^[A-Z0-9-]+$/, "Code must be uppercase letters, digits, or hyphens only."),
  discountAmount: z.number().min(0).default(1000),
  notes: z.string().max(500).optional(),
});

// ─── POST /api/platform/referrals ────────────────────────────────────────────

export async function createPlatformReferral(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createReferralSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);

    const existing = await prisma.platformReferralCode.findUnique({
      where: { code: body.code },
    });
    if (existing) {
      throw new AppHttpError(409, `Referral code "${body.code}" already exists.`, "DUPLICATE_CODE");
    }

    const created = await prisma.platformReferralCode.create({
      data: {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        code: body.code,
        discountAmount: body.discountAmount,
        isActive: true,
        createdBy: actor,
        notes: body.notes ?? null,
      },
    });

    await writePlatformAuditLog({
      actor,
      action: "referral.created",
      after: {
        id: created.id,
        code: created.code,
        discountAmount: created.discountAmount,
        isActive: created.isActive,
      },
    });

    res.status(201).json({
      data: {
        id: created.id,
        code: created.code,
        discountAmount: created.discountAmount,
        isActive: created.isActive,
        createdBy: created.createdBy,
        notes: created.notes,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

const patchReferralSchema = z
  .object({
    discountAmount: z.number().min(0).optional(),
    notes: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => b.discountAmount !== undefined || b.notes !== undefined || b.isActive !== undefined, {
    message: "At least one of discountAmount, notes, isActive is required.",
  });

// ─── PATCH /api/platform/referrals/:id ───────────────────────────────────────

export async function patchPlatformReferral(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params["id"] ?? "");
    if (!id) throw new AppHttpError(400, "id is required.", "MISSING_PARAM");
    const body = patchReferralSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);

    const existing = await prisma.platformReferralCode.findUnique({ where: { id } });
    if (!existing) throw new AppHttpError(404, "Referral code not found.", "NOT_FOUND");

    const before = {
      discountAmount: existing.discountAmount,
      notes: existing.notes,
      isActive: existing.isActive,
    };

    const updated = await prisma.platformReferralCode.update({
      where: { id },
      data: {
        ...(body.discountAmount !== undefined ? { discountAmount: body.discountAmount } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await writePlatformAuditLog({
      actor,
      action: body.isActive === false ? "referral.deactivated" : "referral.updated",
      before,
      after: {
        discountAmount: updated.discountAmount,
        notes: updated.notes,
        isActive: updated.isActive,
      },
    });

    res.json({
      data: {
        id: updated.id,
        code: updated.code,
        discountAmount: updated.discountAmount,
        isActive: updated.isActive,
        createdBy: updated.createdBy,
        notes: updated.notes,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/plans ─────────────────────────────────────────────────

export async function getPlatformPlans(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await getPlatformSettings();
    const plans = getEffectivePlanCatalog(settings.planCatalog);
    res.json({
      data: {
        plans,
        overrides: settings.planOverrides,
        pricing: settings.subscriptionPricing,
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

const planLimitsSchema = z.object({
  maxBranches: z.number().int().min(0).nullable().optional(),
  maxStaff: z.number().int().min(0).nullable().optional(),
  maxCustomers: z.number().int().min(0).nullable().optional(),
});

const pricingPatchSchema = z.object({
  currency: z.string().min(1).max(8).optional(),
  gstPercent: z.number().min(0).max(100).optional(),
  termBasePrices: z
    .object({
      12: z.number().min(0).optional(),
      24: z.number().min(0).optional(),
      36: z.number().min(0).optional(),
      60: z.number().min(0).optional(),
    })
    .optional(),
  planMultipliers: z.record(z.string(), z.number().min(0)).optional(),
  addOns: z
    .object({
      extraBranchPrice: z.number().min(0).optional(),
      extraUserPrice: z.number().min(0).optional(),
      onboardingFee: z.number().min(0).optional(),
      referralDiscount: z.number().min(0).optional(),
    })
    .optional(),
}).optional();

const putPlansSchema = z.object({
  planOverrides: z
    .record(
      z.string(),
      z.object({
        planName: z.string().min(1).max(80).optional(),
        limits: planLimitsSchema.optional(),
        publicVisible: z.boolean().optional(),
      })
    )
    .optional()
    .default({}),
  pricing: pricingPatchSchema,
});

function plansResponse(settings: Awaited<ReturnType<typeof getPlatformSettings>>) {
  return {
    plans: getEffectivePlanCatalog(settings.planCatalog),
    overrides: settings.planOverrides,
    pricing: settings.subscriptionPricing,
  };
}

// ─── PUT /api/platform/plans ─────────────────────────────────────────────────

export async function putPlatformPlans(req: Request, res: Response, next: NextFunction) {
  try {
    const body = putPlansSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const before = await getPlatformSettings();
    const known = new Set(before.planCatalog.map((p) => p.planCode));

    const planOverrides: PlatformSettingsPayload["planOverrides"] = {};
    for (const [codeRaw, override] of Object.entries(body.planOverrides ?? {})) {
      const planCode = normalizePlanCode(codeRaw);
      if (!known.has(planCode)) continue;
      const existing = before.planCatalog.find((p) => p.planCode === planCode)!;
      planOverrides[planCode] = {
        ...(override.planName ? { planName: override.planName } : {}),
        ...(override.limits
          ? {
              limits: parsePlanLimits({
                ...existing.limits,
                ...override.limits,
              }),
            }
          : {}),
        ...(override.publicVisible !== undefined ? { publicVisible: override.publicVisible } : {}),
      };
    }

    const pricingPatch: SubscriptionPricingPatch | undefined = body.pricing
      ? {
          ...(body.pricing.currency !== undefined ? { currency: body.pricing.currency } : {}),
          ...(body.pricing.gstPercent !== undefined ? { gstPercent: body.pricing.gstPercent } : {}),
          ...(body.pricing.termBasePrices ? { termBasePrices: body.pricing.termBasePrices } : {}),
          ...(body.pricing.planMultipliers
            ? {
                planMultipliers: Object.fromEntries(
                  Object.entries(body.pricing.planMultipliers).map(([k, v]) => [
                    normalizePlanCode(k),
                    v,
                  ])
                ) as SubscriptionPricingPatch["planMultipliers"],
              }
            : {}),
          ...(body.pricing.addOns ? { addOns: body.pricing.addOns } : {}),
        }
      : undefined;

    const patch: PlatformSettingsPayload = {
      ...(Object.keys(planOverrides).length ? { planOverrides } : {}),
      ...(pricingPatch ? { subscriptionPricing: pricingPatch } : {}),
      ...(pricingPatch?.gstPercent !== undefined
        ? { defaultGstPercent: pricingPatch.gstPercent }
        : {}),
    };

    const settings = await updatePlatformSettings({
      patch,
      updatedBy: actor,
    });

    await writePlatformAuditLog({
      actor,
      action: "plans.updated",
      before: {
        planCatalog: before.planCatalog,
        pricing: before.subscriptionPricing,
      },
      after: {
        planCatalog: settings.planCatalog,
        pricing: settings.subscriptionPricing,
      },
    });

    res.json({ data: plansResponse(settings), error: null });
  } catch (e) {
    next(e);
  }
}

const createPlanSchema = z.object({
  planCode: PLAN_CODE_STRING,
  planName: z.string().min(1).max(80),
  limits: planLimitsSchema.optional(),
  publicVisible: z.boolean().optional().default(true),
  multiplier: z.number().min(0).optional().default(1),
});

// ─── POST /api/platform/plans ────────────────────────────────────────────────

export async function postPlatformPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createPlanSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const before = await getPlatformSettings();
    const settings = await createPlatformPlan(
      {
        planCode: body.planCode,
        planName: body.planName,
        limits: body.limits ? parsePlanLimits(body.limits) : undefined,
        publicVisible: body.publicVisible,
        multiplier: body.multiplier,
      },
      actor
    );
    await writePlatformAuditLog({
      actor,
      action: "plans.created",
      before: { planCatalog: before.planCatalog },
      after: { planCatalog: settings.planCatalog, created: body.planCode },
    });
    res.status(201).json({ data: plansResponse(settings), error: null });
  } catch (e) {
    next(e);
  }
}

const patchPlanSchema = z.object({
  planName: z.string().min(1).max(80).optional(),
  limits: planLimitsSchema.optional(),
  publicVisible: z.boolean().optional(),
  multiplier: z.number().min(0).optional(),
});

// ─── PATCH /api/platform/plans/:code ─────────────────────────────────────────

export async function patchPlatformPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const code = PLAN_CODE_STRING.parse(req.params.code);
    const body = patchPlanSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const before = await getPlatformSettings();
    const settings = await updatePlatformPlan(
      code,
      {
        planName: body.planName,
        limits: body.limits ? parsePlanLimits(body.limits) : undefined,
        publicVisible: body.publicVisible,
        multiplier: body.multiplier,
      },
      actor
    );
    await writePlatformAuditLog({
      actor,
      action: "plans.patched",
      before: { plan: before.planCatalog.find((p) => p.planCode === code) ?? null },
      after: { plan: settings.planCatalog.find((p) => p.planCode === code) ?? null },
    });
    res.json({ data: plansResponse(settings), error: null });
  } catch (e) {
    next(e);
  }
}

// ─── DELETE /api/platform/plans/:code ────────────────────────────────────────

export async function deletePlatformPlanHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const code = PLAN_CODE_STRING.parse(req.params.code);
    const actor = actorFromReq(req);
    const before = await getPlatformSettings();
    const settings = await deletePlatformPlan(code, actor);
    await writePlatformAuditLog({
      actor,
      action: "plans.deleted",
      before: { plan: before.planCatalog.find((p) => p.planCode === code) ?? null },
      after: { planCatalog: settings.planCatalog },
    });
    res.json({ data: plansResponse(settings), error: null });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/settings ──────────────────────────────────────────────

export async function getPlatformSettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await getPlatformSettings();
    res.json({
      data: {
        settings: {
          trialDaysDefault: settings.trialDaysDefault,
          defaultTermMonths: settings.defaultTermMonths,
          defaultGstPercent: settings.defaultGstPercent,
          defaultContactUsUrl: settings.defaultContactUsUrl,
          defaultContactPhone: settings.defaultContactPhone,
          defaultUpgradeUrl: settings.defaultUpgradeUrl,
        },
        meta: {
          updatedAt: settings.updatedAt,
          updatedBy: settings.updatedBy,
          envFallbacks: {
            defaultContactUsUrl: env.DEFAULT_CONTACT_US_URL ?? null,
            defaultUpgradeUrl: env.DEFAULT_UPGRADE_URL ?? null,
            defaultContactPhone: process.env.DEFAULT_CONTACT_PHONE?.trim() || null,
          },
        },
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

const putSettingsSchema = z.object({
  trialDaysDefault: z.number().int().min(1).max(90).optional(),
  defaultTermMonths: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(60)]).optional(),
  defaultGstPercent: z.number().min(0).max(100).optional(),
  defaultContactUsUrl: z.string().max(500).nullable().optional(),
  defaultContactPhone: z.string().max(32).nullable().optional(),
  defaultUpgradeUrl: z.string().max(500).nullable().optional(),
});

// ─── PUT /api/platform/settings ──────────────────────────────────────────────

export async function putPlatformSettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = putSettingsSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const before = await getPlatformSettings();

    // Reject accidental secret fields if a client sends them.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const forbiddenKeys = [
      "twilioAuthToken",
      "twilioApiKeySecret",
      "resendApiKey",
      "RESEND_API_KEY",
      "TWILIO_AUTH_TOKEN",
    ];
    for (const key of forbiddenKeys) {
      if (key in raw) {
        throw new AppHttpError(400, "Provider secrets cannot be stored via platform settings.", "SECRETS_NOT_ALLOWED");
      }
    }

    const settings = await updatePlatformSettings({
      patch: body,
      updatedBy: actor,
    });

    await writePlatformAuditLog({
      actor,
      action: "settings.updated",
      before: {
        trialDaysDefault: before.trialDaysDefault,
        defaultTermMonths: before.defaultTermMonths,
        defaultGstPercent: before.defaultGstPercent,
        defaultContactUsUrl: before.defaultContactUsUrl,
        defaultContactPhone: before.defaultContactPhone,
        defaultUpgradeUrl: before.defaultUpgradeUrl,
      },
      after: {
        trialDaysDefault: settings.trialDaysDefault,
        defaultTermMonths: settings.defaultTermMonths,
        defaultGstPercent: settings.defaultGstPercent,
        defaultContactUsUrl: settings.defaultContactUsUrl,
        defaultContactPhone: settings.defaultContactPhone,
        defaultUpgradeUrl: settings.defaultUpgradeUrl,
      },
    });

    res.json({
      data: {
        settings: {
          trialDaysDefault: settings.trialDaysDefault,
          defaultTermMonths: settings.defaultTermMonths,
          defaultGstPercent: settings.defaultGstPercent,
          defaultContactUsUrl: settings.defaultContactUsUrl,
          defaultContactPhone: settings.defaultContactPhone,
          defaultUpgradeUrl: settings.defaultUpgradeUrl,
        },
        meta: {
          updatedAt: settings.updatedAt,
          updatedBy: settings.updatedBy,
        },
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

// ─── GET /api/platform/messaging ─────────────────────────────────────────────

export async function getPlatformMessagingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      data: {
        smsEnabled: isTwilioSmsEnabled(),
        whatsappEnabled: isTwilioWhatsAppEnabled(),
        emailEnabled: isResendConfigured(),
        mailFromSet: Boolean(env.MAIL_FROM?.trim()),
        twilioFromSet: Boolean(env.TWILIO_FROM_NUMBER?.trim()),
        twilioWhatsappFromSet: Boolean(env.TWILIO_WHATSAPP_FROM?.trim()),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

// ─── POST /api/platform/organizations/:orgId/suspend ─────────────────────────

const suspendSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function suspendOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = String(req.params["orgId"] ?? "");
    if (!orgId) throw new AppHttpError(400, "orgId is required.", "MISSING_PARAM");
    const body = suspendSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);

    const sub = await prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
    });
    if (!sub) throw new AppHttpError(404, "Organization subscription not found.", "NOT_FOUND");
    if (sub.status === "CANCELLED") {
      throw new AppHttpError(409, "Subscription is already suspended/cancelled.", "ALREADY_SUSPENDED");
    }

    const before = { status: sub.status };
    await prisma.organizationSubscription.update({
      where: { organizationId: orgId },
      data: { status: "CANCELLED" },
    });

    await writePlatformAuditLog({
      organizationId: orgId,
      actor,
      action: "subscription.suspended",
      before,
      after: { status: "CANCELLED", reason: body.reason },
    });

    res.json({ data: { suspended: true, reason: body.reason }, error: null });
  } catch (e) {
    next(e);
  }
}

// ─── POST /api/platform/organizations/:orgId/restore ─────────────────────────

const restoreSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export async function restoreOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = String(req.params["orgId"] ?? "");
    if (!orgId) throw new AppHttpError(400, "orgId is required.", "MISSING_PARAM");
    const body = restoreSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);

    const sub = await prisma.organizationSubscription.findUnique({
      where: { organizationId: orgId },
    });
    if (!sub) throw new AppHttpError(404, "Organization subscription not found.", "NOT_FOUND");

    const before = { status: sub.status };
    await prisma.organizationSubscription.update({
      where: { organizationId: orgId },
      data: { status: "ACTIVE" },
    });

    await writePlatformAuditLog({
      organizationId: orgId,
      actor,
      action: "subscription.restored",
      before,
      after: { status: "ACTIVE", reason: body.reason ?? "Restored by platform admin" },
    });

    res.json({ data: { restored: true }, error: null });
  } catch (e) {
    next(e);
  }
}
