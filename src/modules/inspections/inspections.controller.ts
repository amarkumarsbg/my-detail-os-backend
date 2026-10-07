import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/app-error.js";
import { readPrivateInspectionAsset } from "../../services/object-storage.service.js";
import { normalizePhoneToE164, verifyTwilioWebhookSignature } from "../../services/twilio-sms.service.js";
import { requireDocumentOrg } from "../collections/alias-http.js";
import { inspectionConditionSchema, inspectionTemplateSchema, inspectionDraftSchema } from "./inspection-validation.js";
import {
  createInspection,
  createInspectionRevision,
  createInspectionTemplate,
  cleanupExpiredInspectionUploads,
  finalizeInspection,
  getInspectionDocument,
  getInspectionSendDocument,
  getInspection,
  inspectionUploadAccess,
  listInspectionSendHistory,
  listInspectionTemplates,
  listInspections,
  softDeleteInspection,
  updateInspection,
} from "./inspection.service.js";
import { uploadInspectionPhoto } from "./inspection-assets.service.js";
import { sendInspectionReport, updateInspectionWhatsAppStatus } from "./inspection-delivery.service.js";
import { getSignedInspectionDocument } from "./inspection-document-access.service.js";

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(300).optional(),
  branchId: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const revisionSchema = z.object({ revision: z.number().int().positive() });
const sendSchema = z.object({
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  recipient: z.string().trim().min(3).max(320),
  revision: z.number().int().positive(),
  requestId: z.string().trim().min(1).max(180),
});

function entityId(req: Request, name = "id"): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0]! : value!;
}

async function getScope(req: Request, res: Response) {
  const scope = await requireDocumentOrg(req);
  if (!scope) {
    res.status(401).json({ data: null, error: { message: "Unauthorized" } });
    return null;
  }
  return scope;
}

export async function getInspections(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const query = pageQuerySchema.parse(req.query);
    const result = await listInspections(scope, query);
    res.json({ data: result, error: null });
  } catch (error) {
    next(error);
  }
}

export async function getInspectionSendHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const query = pageQuerySchema.extend({
      status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]).optional(),
    }).parse(req.query);
    res.json({ data: await listInspectionSendHistory(scope, query), error: null });
  } catch (error) {
    next(error);
  }
}

export async function getInspectionById(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const item = await getInspection(scope, entityId(req));
    if (!item) throw AppError.notFound("Inspection report not found.");
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function deleteInspectionById(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const deleted = await softDeleteInspection(scope, req.auth!.id, entityId(req));
    if (!deleted) throw AppError.notFound("Inspection report not found.");
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function getInspectionPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const revision = z.coerce.number().int().positive().parse(req.query.revision);
    const document = await getInspectionDocument(scope, entityId(req), revision);
    if (!document) throw AppError.notFound("Inspection PDF not found.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(document.buffer.length));
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(document.buffer);
  } catch (error) {
    next(error);
  }
}

export async function getInspectionSendPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const document = await getInspectionSendDocument(scope, entityId(req, "sendLogId"));
    if (!document) throw AppError.notFound("Sent inspection PDF not found.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(document.buffer.length));
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(document.buffer);
  } catch (error) {
    next(error);
  }
}

export async function postInspection(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const payload = inspectionDraftSchema.parse(req.body);
    const item = await createInspection(scope, req.auth!.id, payload);
    res.status(201).json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function putInspection(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const payload = inspectionDraftSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
    const { revision, ...data } = payload;
    const item = await updateInspection(scope, req.auth!.id, entityId(req), revision, data);
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postFinalizeInspection(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const body = revisionSchema.extend(inspectionConditionSchema.shape).parse(req.body);
    const { revision, ...conditions } = body;
    const item = await finalizeInspection(scope, req.auth!.id, entityId(req), revision, conditions);
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postInspectionRevision(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const body = revisionSchema.parse(req.body);
    const item = await createInspectionRevision(scope, req.auth!.id, entityId(req), body.revision);
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postInspectionUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const branchId = typeof req.body?.branchId === "string" ? req.body.branchId : req.auth?.branchId;
    const file = req.file;
    const result = await uploadInspectionPhoto({
      scope,
      actorId: req.auth!.id,
      branchId: branchId ?? "",
      buffer: file?.buffer ?? Buffer.alloc(0),
      declaredMime: file?.mimetype ?? "",
    });
    res.status(201).json({ data: result, error: null });
  } catch (error) {
    next(error);
  }
}

export async function getInspectionAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const upload = await inspectionUploadAccess(scope, req.auth!.id, entityId(req, "assetId"));
    if (!upload) throw AppError.notFound("Inspection asset not found.");
    const buffer = await readPrivateInspectionAsset(upload.objectKey);
    if (!buffer) throw AppError.notFound("Inspection asset not found.");
    res.setHeader("Content-Type", upload.mimeType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function getPublicInspectionDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const expiresAt = z.coerce.number().int().positive().parse(req.query.expires);
    const signature = z.string().min(1).parse(req.query.signature);
    const buffer = await getSignedInspectionDocument({
      versionId: entityId(req, "versionId"),
      expiresAt,
      signature,
    });
    if (!buffer) throw AppError.notFound("Inspection document not found or link expired.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function postInspectionWhatsAppStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const apiOrigin = env.API_PUBLIC_ORIGIN?.replace(/\/+$/, "");
    const signature = String(req.headers["x-twilio-signature"] ?? "");
    const fields = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const params = Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
      if (typeof value === "string") return [[key, value]];
      if (typeof value === "number" || typeof value === "boolean") return [[key, String(value)]];
      return [];
    }));
    const requestUrl = `${apiOrigin ?? ""}${req.originalUrl}`;
    if (!apiOrigin || !verifyTwilioWebhookSignature(requestUrl, params, signature)) {
      res.status(403).json({ data: null, error: { message: "Invalid provider webhook signature" } });
      return;
    }
    const sendLogId = z.string().min(1).parse(req.query.sendLogId);
    const providerMessageId = z.string().min(1).parse(fields.MessageSid);
    const providerStatus = z.string().min(1).parse(fields.MessageStatus);
    const updated = await updateInspectionWhatsAppStatus({
      sendLogId,
      providerMessageId,
      providerStatus,
      providerError: typeof fields.ErrorMessage === "string" ? fields.ErrorMessage : undefined,
    });
    if (!updated) {
      res.status(404).json({ data: null, error: { message: "Send record not found" } });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function getInspectionTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    res.json({ data: { items: await listInspectionTemplates(scope.organizationId) }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postInspectionTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const body = inspectionTemplateSchema.parse(req.body);
    const item = await createInspectionTemplate(scope.organizationId, req.auth!.id, body);
    res.status(201).json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postInspectionSend(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const body = sendSchema.parse(req.body);
    let recipient: string;
    if (body.channel === "EMAIL") {
      recipient = body.recipient.toLowerCase();
      if (!z.email().safeParse(recipient).success) throw AppError.validation("Enter a valid email address.");
    } else {
      if (!/^[+\d\s().-]+$/.test(body.recipient)) throw AppError.validation("Enter a valid phone number.");
      recipient = normalizePhoneToE164(body.recipient);
      if (!/^\+[1-9]\d{7,14}$/.test(recipient)) throw AppError.validation("Enter a phone number in E.164 format.");
    }
    const item = await sendInspectionReport({
      scope,
      reportId: entityId(req),
      revision: body.revision,
      requestId: body.requestId,
      channel: body.channel,
      recipient,
      actorId: req.auth!.id,
    });
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

export async function postCleanupExpiredInspectionUploads(_req: Request, res: Response, next: NextFunction) {
  try {
    const removed = await cleanupExpiredInspectionUploads();
    res.json({ data: { removed }, error: null });
  } catch (error) {
    next(error);
  }
}