import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { calculateSubscriptionPricing } from "../lib/subscription-pricing.js";
import {
  getEffectivePlanCatalogFromDb,
  getResolvedSubscriptionPricing,
} from "../lib/platform-settings.js";
import { isAllowedTerm } from "../lib/plan-catalog.js";
import { AppHttpError } from "../lib/app-http-error.js";
import { strongPasswordSchema } from "../lib/password-policy.js";
import { provisionOrganization } from "../modules/organization/organization-provision.service.js";

type LimiterState = { count: number; resetAt: number };

const inMemoryLimiter = new Map<string, LimiterState>();

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(fwd) && fwd[0]) return String(fwd[0]);
  return req.ip || "unknown";
}

function enforceRateLimit(req: Request, scope: string, maxPerWindow: number, windowMs: number): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const existing = inMemoryLimiter.get(key);

  if (!existing || now >= existing.resetAt) {
    inMemoryLimiter.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= maxPerWindow) {
    return false;
  }

  existing.count += 1;
  inMemoryLimiter.set(key, existing);
  return true;
}

async function resolveLeadOrganizationId(): Promise<string | null> {
  const byDefaultId = await prisma.organization.findUnique({
    where: { id: "org-default" },
    select: { id: true },
  });
  if (byDefaultId?.id) return byDefaultId.id;

  const first = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Self-serve trial signup — provisions org + owner + HQ + TRIAL. */
const signupSchema = z
  .object({
    // Website fields
    businessName: z.string().min(1).max(160).optional(),
    ownerName: z.string().min(1).max(120).optional(),
    // Legacy lead-capture aliases
    companyName: z.string().min(1).max(160).optional(),
    name: z.string().min(1).max(120).optional(),
    email: z.string().email(),
    phone: z.string().min(7).max(20),
    password: strongPasswordSchema,
    branchName: z.string().min(1).max(120).optional(),
    planCode: z.string().min(2).max(24).optional(),
    referralCode: z.string().max(32).nullable().optional(),
    message: z.string().max(2000).optional(),
    source: z.string().max(80).optional(),
  })
  .superRefine((val, ctx) => {
    const business = (val.businessName ?? val.companyName ?? "").trim();
    const owner = (val.ownerName ?? val.name ?? "").trim();
    if (!business) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business name is required.", path: ["businessName"] });
    }
    if (!owner) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Owner name is required.", path: ["ownerName"] });
    }
  });

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().optional(),
  phone: z.string().min(7).max(20).optional(),
  businessName: z.string().max(160).optional(),
  subject: z.string().max(200).optional(),
  message: z.string().min(1).max(2000),
  source: z.string().max(80).optional(),
});

const publicPricingSchema = z.object({
  planCode: z.string().min(2).max(24).transform((s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_")).default("STARTER"),
  termMonths: z.union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(36), z.literal(60)]),
  extraBranches: z.number().int().nonnegative().default(0),
  extraUsers: z.number().int().nonnegative().default(0),
  referralCode: z.string().max(32).nullable().optional(),
  isFirstSubscription: z.boolean().optional(),
});

export async function postPublicSignup(req: Request, res: Response, next: NextFunction) {
  try {
    if (!enforceRateLimit(req, "public-signup", 5, 10 * 60_000)) {
      res.status(429).json({
        data: null,
        error: { message: "Too many signup requests. Please try again in a few minutes." },
      });
      return;
    }

    const body = signupSchema.parse(req.body ?? {});
    const businessName = (body.businessName ?? body.companyName ?? "").trim();
    const ownerName = (body.ownerName ?? body.name ?? "").trim();

    const provisioned = await provisionOrganization({
      businessName,
      ownerName,
      email: body.email,
      phone: body.phone,
      password: body.password,
      branchName: body.branchName,
      planCode: body.planCode,
      referralCode: body.referralCode ?? null,
      source: body.source ?? "public_website",
      actor: `public:${getClientIp(req)}`,
    });

    // Best-effort CRM lead row (does not block signup if lead org is missing).
    try {
      const leadOrgId = await resolveLeadOrganizationId();
      if (leadOrgId) {
        const id = `signup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        await prisma.appJsonRow.create({
          data: {
            collection: "publicSignups",
            entityId: id,
            organizationId: leadOrgId,
            payload: {
              id,
              organizationId: provisioned.organizationId,
              businessName,
              ownerName,
              email: body.email.trim().toLowerCase(),
              phone: body.phone.trim(),
              message: body.message,
              source: body.source ?? "public_website",
              createdAt: new Date().toISOString(),
              ip: getClientIp(req),
              userAgent: req.headers["user-agent"] ?? null,
            },
          },
        });
      }
    } catch {
      /* non-fatal */
    }

    res.status(201).json({
      data: {
        accessToken: provisioned.accessToken,
        user: provisioned.user,
        organizationId: provisioned.organizationId,
        branch: provisioned.branch,
        subscription: provisioned.subscription,
      },
      error: null,
    });
  } catch (e) {
    if (e instanceof AppHttpError) {
      res.status(e.status).json({
        data: null,
        error: { message: e.message, code: e.code },
      });
      return;
    }
    next(e);
  }
}

export async function postPublicContact(req: Request, res: Response, next: NextFunction) {
  try {
    if (!enforceRateLimit(req, "public-contact", 20, 10 * 60_000)) {
      res.status(429).json({
        data: null,
        error: { message: "Too many contact requests. Please try again in a few minutes." },
      });
      return;
    }

    const body = contactSchema.parse(req.body ?? {});
    const organizationId = await resolveLeadOrganizationId();
    if (!organizationId) {
      res.status(503).json({
        data: null,
        error: { message: "Service is temporarily unavailable." },
      });
      return;
    }

    const id = `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await prisma.appJsonRow.create({
      data: {
        collection: "publicContacts",
        entityId: id,
        organizationId,
        payload: {
          id,
          ...body,
          email: body.email?.trim().toLowerCase(),
          phone: body.phone?.trim(),
          createdAt: new Date().toISOString(),
          ip: getClientIp(req),
          userAgent: req.headers["user-agent"] ?? null,
        },
      },
    });

    res.status(201).json({
      data: {
        ok: true,
        id,
        message: "Thanks for reaching out. Our team will follow up shortly.",
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

export async function postPublicPricingQuote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!enforceRateLimit(req, "public-pricing", 60, 10 * 60_000)) {
      res.status(429).json({
        data: null,
        error: { message: "Too many pricing quote requests. Please try again shortly." },
      });
      return;
    }

    const body = publicPricingSchema.parse(req.body ?? {});
    const [catalog, pricing] = await Promise.all([
      getEffectivePlanCatalogFromDb(),
      getResolvedSubscriptionPricing(),
    ]);
    const plan = catalog.find((p) => p.planCode === body.planCode);
    if (!plan || !plan.publicVisible) {
      res.status(404).json({
        data: null,
        error: { message: "Plan not found or not available.", code: "PLAN_NOT_FOUND" },
      });
      return;
    }
    if (!isAllowedTerm(body.termMonths, plan.allowedTerms)) {
      res.status(400).json({
        data: null,
        error: {
          message: `Term ${body.termMonths} months is not available for this plan.`,
          code: "TERM_NOT_ALLOWED",
        },
      });
      return;
    }
    const breakdown = calculateSubscriptionPricing({
      planCode: plan.planCode,
      planName: plan.planName,
      limits: plan.limits,
      isFirstSubscription: body.isFirstSubscription ?? true,
      pricing,
      payload: {
        termMonths: body.termMonths,
        extraBranches: body.extraBranches,
        extraUsers: body.extraUsers,
        referralCode: body.referralCode ?? null,
      },
    });

    res.json({ data: { breakdown }, error: null });
  } catch (e) {
    next(e);
  }
}


export async function getPublicPlans(_req: Request, res: Response, next: NextFunction) {
  try {
    const [catalog, pricing] = await Promise.all([
      getEffectivePlanCatalogFromDb(),
      getResolvedSubscriptionPricing(),
    ]);
    const plans = catalog
      .filter((p) => p.publicVisible)
      .map((p) => {
        const annualBase = pricing.termBasePrices[12] * (pricing.planMultipliers[p.planCode] ?? 1);
        return {
          planCode: p.planCode,
          planName: p.planName,
          limits: p.limits,
          allowedTerms: p.allowedTerms,
          annualPrice: Math.round(annualBase * 100) / 100,
          currency: pricing.currency,
          gstPercent: pricing.gstPercent,
        };
      });
    res.json({
      data: {
        plans,
        pricing: {
          currency: pricing.currency,
          gstPercent: pricing.gstPercent,
          termBasePrices: pricing.termBasePrices,
          planMultipliers: pricing.planMultipliers,
          addOns: pricing.addOns,
          source: pricing.source,
        },
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}
