import { randomUUID } from "crypto";
import { type CollectionWriteContext } from "../modules/collections/collection.dispatcher.js";
import { prisma } from "../lib/prisma.js";

/**
 * Aligns with frontend `ActivityEntityType` / `ActivityAction` in
 * my-detail-os-frontend/src/types/activity.ts so workshop Activity Log can render.
 */
export type ActivityAction =
  | "CREATED"
  | "UPDATED"
  | "DELETED"
  | "STATUS_CHANGED"
  | "PAYMENT_RECEIVED"
  | "ASSIGNED"
  | "COMPLETED"
  | "CANCELLED"
  | "STOCK_ADJUSTED"
  | "WHATSAPP_SENT"
  | "EMAIL_SENT"
  | "MECHANIC_SWITCHED"
  | "OWNERSHIP_TRANSFERRED"
  | "WALLET_CREDITED"
  | "WALLET_DEBITED"
  | "LOGIN"
  | "LOGOUT"
  | string;

/** Collection / legacy names → frontend entityType enum values. */
const ENTITY_TYPE_ALIASES: Record<string, string> = {
  jobcard: "JOB_CARD",
  jobcards: "JOB_CARD",
  job_card: "JOB_CARD",
  customer: "CUSTOMER",
  customers: "CUSTOMER",
  vehicle: "VEHICLE",
  vehicles: "VEHICLE",
  invoice: "INVOICE",
  invoices: "INVOICE",
  billing: "INVOICE",
  appointment: "APPOINTMENT",
  appointments: "APPOINTMENT",
  bookings: "APPOINTMENT",
  inventory: "INVENTORY",
  parts: "INVENTORY",
  stockmovements: "INVENTORY",
  productpurchases: "INVENTORY",
  branchstocks: "INVENTORY",
  stocktransfers: "INVENTORY",
  partcategories: "INVENTORY",
  staff: "STAFF",
  leave: "LEAVE",
  leaverequests: "LEAVE",
  leaveconfig: "LEAVE",
  payroll: "PAYROLL",
  staffreward: "STAFF_REWARD",
  staffrewards: "STAFF_REWARD",
  staffrewardledger: "STAFF_REWARD",
  stafftargets: "STAFF_REWARD",
  quotation: "QUOTATION",
  quotations: "QUOTATION",
  expense: "EXPENSE",
  expenses: "EXPENSE",
  notifications: "NOTIFICATION",
  notification: "NOTIFICATION",
  servicereminder: "SERVICE_REMINDER",
  servicereminders: "SERVICE_REMINDER",
  reminder: "SERVICE_REMINDER",
  reminders: "SERVICE_REMINDER",
};

const ENTITY_LABELS: Record<string, string> = {
  JOB_CARD: "Job Card",
  CUSTOMER: "Customer",
  VEHICLE: "Vehicle",
  INVOICE: "Invoice",
  APPOINTMENT: "Appointment",
  INVENTORY: "Inventory",
  STAFF: "Staff",
  LEAVE: "Leave",
  PAYROLL: "Payroll",
  STAFF_REWARD: "Staff Reward",
  QUOTATION: "Quotation",
  EXPENSE: "Expense",
  WALLET: "Wallet",
  NOTIFICATION: "Notification",
  SERVICE_REMINDER: "Service Reminder",
};

export interface LogBusinessActivityParams {
  action: ActivityAction;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  details?: Record<string, unknown> | string;
}

function normalizeKey(raw: string): string {
  return raw.trim().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toUpperCase();
}

/** Map collection names / mixed-case labels to frontend ActivityEntityType. */
export function normalizeActivityEntityType(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const compact = trimmed.replace(/[\s_-]+/g, "").toLowerCase();
  if (ENTITY_TYPE_ALIASES[compact]) return ENTITY_TYPE_ALIASES[compact];
  const upper = normalizeKey(trimmed);
  if (ENTITY_LABELS[upper]) return upper;
  return upper;
}

/**
 * Map backend CREATE_/UPDATE_/DELETE_ verbs (and legacy shorts) to frontend ActivityAction.
 */
export function normalizeActivityAction(raw: string): string {
  const action = raw.trim();
  if (!action) return action;
  const upper = action.toUpperCase();

  if (
    upper === "CREATED" ||
    upper === "UPDATED" ||
    upper === "DELETED" ||
    upper === "STATUS_CHANGED" ||
    upper === "PAYMENT_RECEIVED" ||
    upper === "ASSIGNED" ||
    upper === "COMPLETED" ||
    upper === "CANCELLED" ||
    upper === "STOCK_ADJUSTED" ||
    upper === "WHATSAPP_SENT" ||
    upper === "EMAIL_SENT" ||
    upper === "MECHANIC_SWITCHED" ||
    upper === "OWNERSHIP_TRANSFERRED" ||
    upper === "WALLET_CREDITED" ||
    upper === "WALLET_DEBITED" ||
    upper === "LOGIN" ||
    upper === "LOGOUT"
  ) {
    return upper;
  }

  if (upper === "CREATE" || upper.startsWith("CREATE_")) return "CREATED";
  if (upper === "DELETE" || upper.startsWith("DELETE_")) return "DELETED";
  if (upper === "REPLACE" || upper.startsWith("REPLACE_")) return "UPDATED";
  if (upper === "RECORD_PAYMENT" || upper.includes("PAYMENT")) return "PAYMENT_RECEIVED";
  if (
    upper === "UPDATE_STATUS" ||
    upper === "STATUS_CHANGED" ||
    (upper.startsWith("UPDATE_") && upper.includes("STATUS"))
  ) {
    return "STATUS_CHANGED";
  }
  if (upper === "UPDATE" || upper.startsWith("UPDATE_")) return "UPDATED";

  return upper;
}

function humanEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, " ").toLowerCase();
}

function buildDetailsText(
  action: string,
  entityType: string,
  details?: Record<string, unknown> | string
): string {
  if (typeof details === "string" && details.trim()) return details.trim();

  const detailObj =
    details && typeof details === "object" && !Array.isArray(details) ? details : undefined;
  const label = humanEntityLabel(entityType);

  if (action === "STATUS_CHANGED" && detailObj?.oldStatus && detailObj?.newStatus) {
    return `Status changed from ${detailObj.oldStatus} to ${detailObj.newStatus}`;
  }
  if (action === "CREATED") return `Created new ${label.toLowerCase()}`;
  if (action === "UPDATED") return `Updated ${label.toLowerCase()}`;
  if (action === "DELETED") return `Deleted ${label.toLowerCase()}`;
  if (action === "PAYMENT_RECEIVED") return `Payment received`;
  if (action === "LOGIN") {
    const method =
      detailObj && typeof detailObj.method === "string" ? detailObj.method : undefined;
    if (method === "otp") return "Logged in with OTP";
    if (method === "password") return "Logged in with password";
    return "Logged in";
  }
  if (action === "LOGOUT") return "Logged out";
  return `${action.replace(/_/g, " ")} · ${label}`;
}

/**
 * Staff login / logout into workshop Activity Log (`activityLogs`).
 * Fire-and-forget safe — never throws to callers.
 */
export async function logAuthActivity(params: {
  organizationId: string;
  userId: string;
  userName: string;
  action: "LOGIN" | "LOGOUT";
  method?: "password" | "otp";
}): Promise<void> {
  const { organizationId, userId, userName, action, method } = params;
  if (!organizationId || !userId) return;

  try {
    await logBusinessActivity(
      {
        organizationId,
        userId,
        hasJobCardPricingPermission: false,
      },
      {
        action,
        entityType: "STAFF",
        entityId: userId,
        entityLabel: userName || "Staff",
        details: method ? { method } : undefined,
      }
    );
  } catch (err) {
    console.error("[ActivityLogger] Failed to write auth activity:", err);
  }
}

/**
 * Normalize a stored activity log payload for workshop / platform UIs.
 * Safe to call on already-normalized (frontend-written) rows.
 */
export function normalizeActivityLogPayload(
  payload: unknown,
  entityIdFallback?: string
): Record<string, unknown> {
  const src =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const entityType = normalizeActivityEntityType(
    typeof src.entityType === "string" ? src.entityType : ""
  );
  const action = normalizeActivityAction(typeof src.action === "string" ? src.action : "");
  const entityId =
    typeof src.entityId === "string" && src.entityId
      ? src.entityId
      : entityIdFallback ?? "";
  const id =
    typeof src.id === "string" && src.id
      ? src.id
      : entityIdFallback ?? randomUUID();

  const createdAt =
    typeof src.createdAt === "string" && src.createdAt
      ? src.createdAt
      : typeof src.timestamp === "string" && src.timestamp
        ? src.timestamp
        : new Date().toISOString();

  const entityLabel =
    typeof src.entityLabel === "string" && src.entityLabel.trim()
      ? src.entityLabel.trim()
      : entityId || humanEntityLabel(entityType);

  const details = buildDetailsText(
    action,
    entityType,
    typeof src.details === "string" || (src.details && typeof src.details === "object")
      ? (src.details as string | Record<string, unknown>)
      : undefined
  );

  return {
    ...src,
    id,
    action,
    entityType,
    entityId,
    entityLabel,
    details,
    createdAt,
    timestamp: typeof src.timestamp === "string" ? src.timestamp : createdAt,
  };
}

export async function logBusinessActivity(
  ctx: CollectionWriteContext,
  params: LogBusinessActivityParams
): Promise<void> {
  if (!ctx.userId) return;
  if (!ctx.organizationId) {
    console.error("[ActivityLogger] Skipped write: missing organizationId");
    return;
  }

  const timestamp = new Date().toISOString();
  let userName: string | undefined;

  try {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true },
    });
    if (user?.name) userName = user.name;
  } catch {
    // ignore
  }

  const entityType = normalizeActivityEntityType(params.entityType);
  const action = normalizeActivityAction(params.action);
  const detailsText = buildDetailsText(action, entityType, params.details);
  const activityLogId = randomUUID();

  const payload = normalizeActivityLogPayload({
    id: activityLogId,
    userId: ctx.userId,
    userName,
    action,
    entityType,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    timestamp,
    createdAt: timestamp,
    details: detailsText,
  });

  try {
    await prisma.appJsonRow.upsert({
      where: {
        collection_entityId: { collection: "activityLogs", entityId: activityLogId },
      },
      create: {
        collection: "activityLogs",
        entityId: activityLogId,
        organizationId: ctx.organizationId,
        payload: payload as import("@prisma/client").Prisma.InputJsonObject,
        createdAt: new Date(timestamp),
      },
      update: { payload: payload as import("@prisma/client").Prisma.InputJsonObject },
    });
  } catch (err) {
    // Swallow so primary business writes are not rolled back by audit logging.
    console.error("[ActivityLogger] Failed to write activity log:", err);
  }
}
