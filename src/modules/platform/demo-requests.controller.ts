import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import {
  getCollectionItem,
  upsertCollectionItem,
} from "../collections/app-json-store.js";

const COLLECTION = "demoRequests";

type DemoStatus = "SCHEDULED" | "CANCELLED" | "COMPLETED";

interface DemoRequest {
  id: string;
  fullName: string;
  mobile: string;
  workshopName: string;
  city: string;
  interests: string;
  slotDate: string;
  slotLabel: string;
  status: DemoStatus;
  createdByUserId?: string;
  organizationId?: string;
  organizationName?: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
}

interface DemoListItem {
  id: string;
  fullName: string;
  mobile: string;
  workshopName: string;
  city: string;
  interests: string;
  slotDate: string;
  slotLabel: string;
  status: DemoStatus;
  organizationId: string | null;
  organizationName: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const VALID_STATUSES = new Set<DemoStatus>(["SCHEDULED", "CANCELLED", "COMPLETED"]);

function asDemo(raw: unknown): DemoRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || !d.id) return null;
  return {
    id: d.id,
    fullName: String(d.fullName ?? ""),
    mobile: String(d.mobile ?? ""),
    workshopName: String(d.workshopName ?? ""),
    city: String(d.city ?? ""),
    interests: String(d.interests ?? ""),
    slotDate: String(d.slotDate ?? ""),
    slotLabel: String(d.slotLabel ?? ""),
    status: (String(d.status ?? "SCHEDULED").toUpperCase() as DemoStatus),
    createdByUserId: typeof d.createdByUserId === "string" ? d.createdByUserId : undefined,
    organizationId: typeof d.organizationId === "string" ? d.organizationId : undefined,
    organizationName: typeof d.organizationName === "string" ? d.organizationName : undefined,
    createdAt: String(d.createdAt ?? new Date().toISOString()),
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : undefined,
    notes: typeof d.notes === "string" ? d.notes : undefined,
  };
}

function toListItem(
  demo: DemoRequest,
  organizationId: string | null,
  organizationName: string | null
): DemoListItem {
  return {
    id: demo.id,
    fullName: demo.fullName,
    mobile: demo.mobile,
    workshopName: demo.workshopName,
    city: demo.city,
    interests: demo.interests,
    slotDate: demo.slotDate,
    slotLabel: demo.slotLabel,
    status: VALID_STATUSES.has(demo.status) ? demo.status : "SCHEDULED",
    organizationId: demo.organizationId ?? organizationId,
    organizationName: demo.organizationName ?? organizationName,
    createdAt: demo.createdAt,
    updatedAt: demo.updatedAt ?? null,
  };
}

async function loadDemoRow(demoId: string): Promise<{
  demo: DemoRequest;
  organizationId: string;
}> {
  const row = await prisma.appJsonRow.findUnique({
    where: {
      collection_entityId: { collection: COLLECTION, entityId: demoId },
    },
    select: { payload: true, organizationId: true },
  });
  if (!row?.organizationId) {
    throw AppError.notFound("Demo request not found");
  }
  const demo = asDemo(row.payload);
  if (!demo) {
    throw AppError.notFound("Demo request not found");
  }
  return { demo, organizationId: row.organizationId };
}

/**
 * GET /api/platform/demo-requests
 */
export async function listDemoRequests(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const statusFilter =
      typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const search =
      typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const orgId =
      typeof req.query.organizationId === "string" ? req.query.organizationId.trim() : "";
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.floor(limitRaw)), 500)
      : 200;

    const rows = await prisma.appJsonRow.findMany({
      where: {
        collection: COLLECTION,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: {
        entityId: true,
        organizationId: true,
        payload: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit * 3, 1500),
    });

    const orgIds = [
      ...new Set(rows.map((r) => r.organizationId).filter((id): id is string => Boolean(id))),
    ];
    const orgs = orgIds.length
      ? await prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

    let demos = rows
      .map((row) => {
        const demo = asDemo(row.payload);
        if (!demo) return null;
        return toListItem(
          demo,
          row.organizationId,
          row.organizationId ? orgNameById.get(row.organizationId) ?? null : null
        );
      })
      .filter((d): d is DemoListItem => Boolean(d));

    if (statusFilter && statusFilter !== "ALL") {
      demos = demos.filter((d) => d.status === statusFilter);
    }

    if (search) {
      demos = demos.filter((d) => {
        const hay = [
          d.fullName,
          d.mobile,
          d.workshopName,
          d.city,
          d.interests,
          d.slotDate,
          d.slotLabel,
          d.organizationName ?? "",
          d.id,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      });
    }

    demos.sort((a, b) => {
      const aSlot = Date.parse(`${a.slotDate}T00:00:00`) || Date.parse(a.createdAt) || 0;
      const bSlot = Date.parse(`${b.slotDate}T00:00:00`) || Date.parse(b.createdAt) || 0;
      if (a.status === "SCHEDULED" && b.status !== "SCHEDULED") return -1;
      if (b.status === "SCHEDULED" && a.status !== "SCHEDULED") return 1;
      return bSlot - aSlot;
    });

    const sliced = demos.slice(0, limit);
    res.json({
      demos: sliced,
      total: demos.length,
      scheduledCount: demos.filter((d) => d.status === "SCHEDULED").length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/platform/demo-requests/:id
 */
export async function getDemoRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const demoId = String(req.params.id ?? "").trim();
    if (!demoId) throw AppError.validation("Demo id is required");

    const { demo, organizationId } = await loadDemoRow(demoId);
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });

    res.json({
      demo: {
        ...demo,
        organizationId: demo.organizationId ?? organizationId,
        organizationName: demo.organizationName ?? org?.name ?? null,
      },
      organization: org,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/platform/demo-requests/:id
 */
export async function patchDemoRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const demoId = String(req.params.id ?? "").trim();
    if (!demoId) throw AppError.validation("Demo id is required");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const nextStatus =
      typeof body.status === "string"
        ? (body.status.trim().toUpperCase() as DemoStatus)
        : null;
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : undefined;

    if (nextStatus && !VALID_STATUSES.has(nextStatus)) {
      throw AppError.validation("Invalid status");
    }

    const { demo, organizationId } = await loadDemoRow(demoId);
    const latestRaw = await getCollectionItem(COLLECTION, demoId, organizationId);
    const latest = asDemo(latestRaw) ?? demo;
    const now = new Date().toISOString();

    const updated: DemoRequest = {
      ...latest,
      status: nextStatus ?? latest.status,
      notes: notes !== undefined ? notes : latest.notes,
      organizationId: latest.organizationId ?? organizationId,
      updatedAt: now,
    };

    await upsertCollectionItem(COLLECTION, demoId, updated, organizationId);
    res.json({ demo: updated });
  } catch (err) {
    next(err);
  }
}
