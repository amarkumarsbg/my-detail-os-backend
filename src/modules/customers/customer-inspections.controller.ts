import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../../lib/app-error.js";
import { readPrivateInspectionAsset } from "../../services/object-storage.service.js";
import {
  customerInspectionUploadAccess,
  getCustomerInspection,
  getCustomerInspectionDocument,
  listCustomerInspections,
} from "../inspections/inspection.service.js";

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function entityId(req: Request, name = "id"): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0]! : value!;
}

function requireCustomerIds(req: Request, res: Response): { customerId: string; organizationId: string } | null {
  const customerId = req.auth?.customerId;
  const organizationId = req.auth?.organizationId;
  if (!customerId || !organizationId) {
    res.status(401).json({ data: null, error: { message: "Unauthorized" } });
    return null;
  }
  return { customerId, organizationId };
}

/** GET /api/customer/inspections — finalized reports for the signed-in customer. */
export async function getCustomerInspections(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = requireCustomerIds(req, res);
    if (!ids) return;
    const query = pageQuerySchema.parse(req.query);
    const result = await listCustomerInspections(ids.organizationId, ids.customerId, query);
    res.json({ data: result, error: null });
  } catch (error) {
    next(error);
  }
}

/** GET /api/customer/inspections/:id */
export async function getCustomerInspectionById(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = requireCustomerIds(req, res);
    if (!ids) return;
    const item = await getCustomerInspection(ids.organizationId, ids.customerId, entityId(req));
    if (!item) throw AppError.notFound("Inspection report not found.");
    res.json({ data: { item }, error: null });
  } catch (error) {
    next(error);
  }
}

/** GET /api/customer/inspections/:id/pdf?revision= */
export async function getCustomerInspectionPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = requireCustomerIds(req, res);
    if (!ids) return;
    const revision = z.coerce.number().int().positive().parse(req.query.revision);
    const document = await getCustomerInspectionDocument(
      ids.organizationId,
      ids.customerId,
      entityId(req),
      revision,
    );
    if (!document) throw AppError.notFound("Inspection PDF not found.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(document.buffer.length));
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(document.buffer);
  } catch (error) {
    next(error);
  }
}

/** GET /api/customer/inspections/assets/:assetId */
export async function getCustomerInspectionAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = requireCustomerIds(req, res);
    if (!ids) return;
    const upload = await customerInspectionUploadAccess(
      ids.organizationId,
      ids.customerId,
      entityId(req, "assetId"),
    );
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
