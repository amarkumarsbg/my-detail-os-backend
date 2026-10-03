import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import {
  getCollectionItem,
  upsertCollectionItem,
} from "../collections/app-json-store.js";

const COLLECTION = "supportTickets";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_ON_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type MessageAuthor = "WORKSHOP" | "SUPPORT";

interface SupportTicketMessage {
  id: string;
  author: MessageAuthor;
  authorName: string;
  body: string;
  createdAt: string;
  attachmentIds?: string[];
}

interface SupportTicketAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string;
}

interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  description: string;
  status: TicketStatus;
  createdByUserId?: string;
  createdByName?: string;
  organizationId?: string;
  organizationName?: string;
  attachments: SupportTicketAttachment[];
  messages: SupportTicketMessage[];
  createdAt: string;
  updatedAt: string;
}

interface TicketListItem {
  id: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  organizationId: string | null;
  organizationName: string | null;
  createdByName: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthor: MessageAuthor | null;
  createdAt: string;
  updatedAt: string;
}

const VALID_STATUSES = new Set<TicketStatus>([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_CUSTOMER",
  "RESOLVED",
  "CLOSED",
]);

function actorFromReq(req: Request): string {
  const user = (req as Request & { user?: { email?: string; sub?: string } }).user;
  if (user?.email) return user.email;
  if (user?.sub) return user.sub;
  const platformActor = (req as Request & { platformActor?: string }).platformActor;
  return platformActor ?? "platform-support";
}

function asTicket(raw: unknown): SupportTicket | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id) return null;
  if (typeof t.subject !== "string") return null;
  return {
    id: t.id,
    subject: String(t.subject ?? ""),
    category: String(t.category ?? "OTHER"),
    priority: (String(t.priority ?? "MEDIUM") as TicketPriority),
    description: String(t.description ?? ""),
    status: (String(t.status ?? "OPEN") as TicketStatus),
    createdByUserId: typeof t.createdByUserId === "string" ? t.createdByUserId : undefined,
    createdByName: typeof t.createdByName === "string" ? t.createdByName : undefined,
    organizationId: typeof t.organizationId === "string" ? t.organizationId : undefined,
    organizationName: typeof t.organizationName === "string" ? t.organizationName : undefined,
    attachments: Array.isArray(t.attachments) ? (t.attachments as SupportTicketAttachment[]) : [],
    messages: Array.isArray(t.messages) ? (t.messages as SupportTicketMessage[]) : [],
    createdAt: String(t.createdAt ?? new Date().toISOString()),
    updatedAt: String(t.updatedAt ?? new Date().toISOString()),
  };
}

function toListItem(
  ticket: SupportTicket,
  organizationId: string | null,
  organizationName: string | null
): TicketListItem {
  const messages = ticket.messages ?? [];
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  return {
    id: ticket.id,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    organizationId: ticket.organizationId ?? organizationId,
    organizationName: ticket.organizationName ?? organizationName,
    createdByName: ticket.createdByName ?? null,
    messageCount: messages.length,
    lastMessageAt: last?.createdAt ?? null,
    lastMessagePreview: last?.body ? last.body.slice(0, 160) : null,
    lastMessageAuthor: last?.author ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

async function loadTicketRow(ticketId: string): Promise<{
  ticket: SupportTicket;
  organizationId: string;
}> {
  const row = await prisma.appJsonRow.findUnique({
    where: {
      collection_entityId: { collection: COLLECTION, entityId: ticketId },
    },
    select: { payload: true, organizationId: true },
  });
  if (!row?.organizationId) {
    throw AppError.notFound("Support ticket not found");
  }
  const ticket = asTicket(row.payload);
  if (!ticket) {
    throw AppError.notFound("Support ticket not found");
  }
  return { ticket, organizationId: row.organizationId };
}

/**
 * GET /api/platform/support-tickets
 * Cross-org inbox of workshop support tickets.
 */
export async function listSupportTickets(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId.trim() : "";
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 500) : 200;

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

    let tickets = rows
      .map((row) => {
        const ticket = asTicket(row.payload);
        if (!ticket) return null;
        return toListItem(
          ticket,
          row.organizationId,
          row.organizationId ? orgNameById.get(row.organizationId) ?? null : null
        );
      })
      .filter((t): t is TicketListItem => Boolean(t));

    if (statusFilter && statusFilter !== "ALL") {
      tickets = tickets.filter((t) => t.status === statusFilter);
    }

    if (search) {
      tickets = tickets.filter((t) => {
        const hay = [
          t.subject,
          t.category,
          t.organizationName ?? "",
          t.createdByName ?? "",
          t.lastMessagePreview ?? "",
          t.id,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      });
    }

    tickets.sort((a, b) => {
      const aTime = Date.parse(a.lastMessageAt ?? a.updatedAt) || 0;
      const bTime = Date.parse(b.lastMessageAt ?? b.updatedAt) || 0;
      return bTime - aTime;
    });

    const sliced = tickets.slice(0, limit);
    res.json({
      tickets: sliced,
      total: tickets.length,
      openCount: tickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/platform/support-tickets/:id
 */
export async function getSupportTicket(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ticketId = String(req.params.id ?? "").trim();
    if (!ticketId) throw AppError.validation("Ticket id is required");

    const { ticket, organizationId } = await loadTicketRow(ticketId);
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });

    res.json({
      ticket: {
        ...ticket,
        organizationId: ticket.organizationId ?? organizationId,
        organizationName: ticket.organizationName ?? org?.name ?? null,
      },
      organization: org,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/platform/support-tickets/:id
 * Update status (and optionally priority).
 */
export async function patchSupportTicket(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ticketId = String(req.params.id ?? "").trim();
    if (!ticketId) throw AppError.validation("Ticket id is required");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const nextStatus =
      typeof body.status === "string" ? (body.status.trim().toUpperCase() as TicketStatus) : null;
    const nextPriority =
      typeof body.priority === "string"
        ? (body.priority.trim().toUpperCase() as TicketPriority)
        : null;

    if (nextStatus && !VALID_STATUSES.has(nextStatus)) {
      throw AppError.validation("Invalid status");
    }

    const { ticket, organizationId } = await loadTicketRow(ticketId);
    const now = new Date().toISOString();
    const updated: SupportTicket = {
      ...ticket,
      status: nextStatus ?? ticket.status,
      priority: nextPriority ?? ticket.priority,
      organizationId: ticket.organizationId ?? organizationId,
      updatedAt: now,
    };

    await upsertCollectionItem(COLLECTION, ticketId, updated, organizationId);
    res.json({ ticket: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/platform/support-tickets/:id/reply
 * Platform support reply into the ticket thread (visible in workshop Support).
 */
export async function replySupportTicket(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ticketId = String(req.params.id ?? "").trim();
    if (!ticketId) throw AppError.validation("Ticket id is required");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const messageBody = typeof body.body === "string" ? body.body.trim() : "";
    if (messageBody.length > 8000) {
      throw AppError.validation("Reply is too long (max 8000 characters)");
    }

    const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    const attachments: SupportTicketAttachment[] = [];
    for (const raw of rawAttachments.slice(0, 5)) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as Record<string, unknown>;
      const dataUrl = typeof a.dataUrl === "string" ? a.dataUrl : "";
      if (!dataUrl.startsWith("data:") || dataUrl.length > 2_500_000) continue;
      const id =
        typeof a.id === "string" && a.id
          ? a.id
          : `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      attachments.push({
        id,
        name: typeof a.name === "string" ? a.name.slice(0, 200) : "attachment",
        mimeType: typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream",
        size: typeof a.size === "number" ? a.size : dataUrl.length,
        dataUrl,
        createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString(),
      });
    }

    if (!messageBody && attachments.length === 0) {
      throw AppError.validation("Reply body or attachment is required");
    }

    const nextStatusRaw =
      typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
    const nextStatus =
      nextStatusRaw && VALID_STATUSES.has(nextStatusRaw as TicketStatus)
        ? (nextStatusRaw as TicketStatus)
        : ("IN_PROGRESS" as TicketStatus);

    const { ticket, organizationId } = await loadTicketRow(ticketId);

    // Re-read via collection helper so we merge against latest payload.
    const latestRaw = await getCollectionItem(COLLECTION, ticketId, organizationId);
    const latest = asTicket(latestRaw) ?? ticket;

    const actor = actorFromReq(req);
    const now = new Date().toISOString();
    const message: SupportTicketMessage = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      author: "SUPPORT",
      authorName: "MY DETAIL OS Support",
      body: messageBody || (attachments.some((a) => a.mimeType.startsWith("audio/"))
        ? "🎤 Voice note"
        : "📎 Attachment"),
      createdAt: now,
      attachmentIds: attachments.map((a) => a.id),
    };

    const updated: SupportTicket = {
      ...latest,
      status: nextStatus,
      organizationId: latest.organizationId ?? organizationId,
      attachments: [...(latest.attachments ?? []), ...attachments],
      messages: [...(latest.messages ?? []), message],
      updatedAt: now,
    };

    await upsertCollectionItem(COLLECTION, ticketId, updated, organizationId);

    res.status(201).json({
      ticket: updated,
      message,
      repliedBy: actor,
    });
  } catch (err) {
    next(err);
  }
}
