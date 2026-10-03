import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppHttpError } from "../../lib/app-http-error.js";
import { writePlatformAuditLog } from "../../lib/platform-audit.js";

function actorFromReq(req: Request): string {
  const auth = (req as Request & { auth?: { id?: string; email?: string } }).auth;
  if (auth?.email) return auth.email;
  if (auth?.id) return `user:${auth.id}`;
  const platformActor = (req as Request & { platformActor?: string }).platformActor;
  return platformActor ?? "platform-api-key";
}

function serializeBanner(b: {
  id: string;
  title: string;
  body: string;
  audience: string;
  enabled: boolean;
  ctaLabel: string;
  ctaUrl: string;
  sortOrder: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    title: b.title,
    body: b.body,
    audience: b.audience,
    enabled: b.enabled,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    sortOrder: b.sortOrder,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(500).default(""),
  audience: z.enum(["TRIAL", "ACTIVE", "ALL"]).default("TRIAL"),
  enabled: z.boolean().optional().default(true),
  ctaLabel: z.string().trim().min(1).max(40).default("Upgrade"),
  ctaUrl: z.string().trim().max(500).default(""),
  sortOrder: z.number().int().optional(),
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().max(500).optional(),
    audience: z.enum(["TRIAL", "ACTIVE", "ALL"]).optional(),
    enabled: z.boolean().optional(),
    ctaLabel: z.string().trim().min(1).max(40).optional(),
    ctaUrl: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field is required." });

export async function listPlatformBanners(_req: Request, res: Response, next: NextFunction) {
  try {
    const banners = await prisma.marketingBanner.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
    res.json({
      data: { banners: banners.map(serializeBanner), total: banners.length },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}

export async function createPlatformBanner(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const maxSort = await prisma.marketingBanner.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.marketingBanner.create({
      data: {
        title: body.title,
        body: body.body,
        audience: body.audience,
        enabled: body.enabled,
        ctaLabel: body.ctaLabel,
        ctaUrl: body.ctaUrl,
        sortOrder: body.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        createdBy: actor,
      },
    });
    await writePlatformAuditLog({
      actor,
      action: "banner.created",
      after: serializeBanner(created),
    });
    res.status(201).json({ data: serializeBanner(created), error: null });
  } catch (e) {
    next(e);
  }
}

export async function patchPlatformBanner(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params["id"] ?? "");
    if (!id) throw new AppHttpError(400, "id is required.", "MISSING_PARAM");
    const body = patchSchema.parse(req.body ?? {});
    const actor = actorFromReq(req);
    const existing = await prisma.marketingBanner.findUnique({ where: { id } });
    if (!existing) throw new AppHttpError(404, "Banner not found.", "NOT_FOUND");

    const updated = await prisma.marketingBanner.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.body !== undefined && { body: body.body }),
        ...(body.audience !== undefined && { audience: body.audience }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.ctaLabel !== undefined && { ctaLabel: body.ctaLabel }),
        ...(body.ctaUrl !== undefined && { ctaUrl: body.ctaUrl }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      },
    });
    await writePlatformAuditLog({
      actor,
      action: body.enabled === false ? "banner.disabled" : "banner.updated",
      before: serializeBanner(existing),
      after: serializeBanner(updated),
    });
    res.json({ data: serializeBanner(updated), error: null });
  } catch (e) {
    next(e);
  }
}

export async function deletePlatformBanner(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params["id"] ?? "");
    if (!id) throw new AppHttpError(400, "id is required.", "MISSING_PARAM");
    const actor = actorFromReq(req);
    const existing = await prisma.marketingBanner.findUnique({ where: { id } });
    if (!existing) throw new AppHttpError(404, "Banner not found.", "NOT_FOUND");
    await prisma.marketingBanner.delete({ where: { id } });
    await writePlatformAuditLog({
      actor,
      action: "banner.deleted",
      before: serializeBanner(existing),
    });
    res.json({ data: { deleted: true, id }, error: null });
  } catch (e) {
    next(e);
  }
}

/** Workshop: enabled banners for this org’s subscription status. */
export async function listStudioBanners(req: Request, res: Response, next: NextFunction) {
  try {
    let organizationId = req.auth?.organizationId?.trim();
    if (!organizationId && req.auth?.id) {
      const row = await prisma.user.findUnique({
        where: { id: req.auth.id },
        select: { organizationId: true },
      });
      organizationId = row?.organizationId?.trim();
    }
    if (!organizationId) {
      throw new AppHttpError(403, "Organization required.", "ORG_REQUIRED");
    }
    const sub = await prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: { status: true },
    });
    const status = sub?.status ?? "ACTIVE";
    const isTrial = status === "TRIAL";
    const isActiveLike = status === "ACTIVE" || status === "PAST_DUE";

    const banners = await prisma.marketingBanner.findMany({
      where: {
        enabled: true,
        OR: [
          { audience: "ALL" },
          ...(isTrial ? [{ audience: "TRIAL" as const }] : []),
          ...(isActiveLike ? [{ audience: "ACTIVE" as const }] : []),
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    res.json({
      data: {
        banners: banners.map((b) => ({
          id: b.id,
          title: b.title,
          body: b.body,
          audience: b.audience,
          ctaLabel: b.ctaLabel,
          ctaUrl: b.ctaUrl,
        })),
      },
      error: null,
    });
  } catch (e) {
    next(e);
  }
}
