import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { hasPermissionForMethod, requireAuth } from "../../middleware/auth.js";
import { inspectionPhotoUploadHandler } from "../../middleware/inspection-photo-upload.js";
import type { GranularAction } from "../../constants/permission-keys.js";
import {
  getInspectionAsset,
  getInspectionById,
  deleteInspectionById,
  getInspectionPdf,
  getInspectionSendPdf,
  getInspectionSendHistory,
  getInspectionTemplates,
  getInspections,
  postFinalizeInspection,
  postInspection,
  postInspectionRevision,
  postInspectionSend,
  postInspectionTemplate,
  postInspectionUpload,
  putInspection,
} from "./inspections.controller.js";

function requireInspectionAction(action: GranularAction) {
  const method = action === "VIEW" ? "GET" : action === "CREATE" ? "POST" : action === "EDIT" ? "PUT" : "DELETE";
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ data: null, error: { message: "Unauthorized" } });
      return;
    }
    if (hasPermissionForMethod(req.auth, "JOB_CARDS", method)) {
      next();
      return;
    }
    res.status(403).json({ data: null, error: { message: `Forbidden: Missing permission JOB_CARDS_${action}` } });
  };
}

function requireSettingsEdit(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ data: null, error: { message: "Unauthorized" } });
    return;
  }
  const role = req.auth.role;
  const permissions = req.auth.permissions ?? [];
  if (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "PLATFORM_OWNER" ||
    permissions.includes("SETTINGS") ||
    permissions.includes("SETTINGS_EDIT")
  ) {
    next();
    return;
  }
  res.status(403).json({ data: null, error: { message: "Forbidden: Missing permission SETTINGS_EDIT" } });
}

export const inspectionsRouter = Router();
inspectionsRouter.use(requireAuth);
inspectionsRouter.get("/", requireInspectionAction("VIEW"), getInspections);
inspectionsRouter.get("/send-history", requireInspectionAction("VIEW"), getInspectionSendHistory);
inspectionsRouter.get("/send-history/:sendLogId/pdf", requireInspectionAction("VIEW"), getInspectionSendPdf);
inspectionsRouter.post("/uploads", requireInspectionAction("CREATE"), inspectionPhotoUploadHandler, postInspectionUpload);
inspectionsRouter.get("/assets/:assetId", requireInspectionAction("VIEW"), getInspectionAsset);
inspectionsRouter.post("/", requireInspectionAction("CREATE"), postInspection);
inspectionsRouter.get("/:id/pdf", requireInspectionAction("VIEW"), getInspectionPdf);
inspectionsRouter.delete("/:id", requireInspectionAction("DELETE"), deleteInspectionById);
inspectionsRouter.get("/:id", requireInspectionAction("VIEW"), getInspectionById);
inspectionsRouter.put("/:id", requireInspectionAction("EDIT"), putInspection);
inspectionsRouter.post("/:id/finalize", requireInspectionAction("EDIT"), postFinalizeInspection);
inspectionsRouter.post("/:id/revisions", requireInspectionAction("EDIT"), postInspectionRevision);
inspectionsRouter.post("/:id/send", requireInspectionAction("EDIT"), postInspectionSend);

export const inspectionTemplatesRouter = Router();
inspectionTemplatesRouter.use(requireAuth);
inspectionTemplatesRouter.get("/", requireInspectionAction("VIEW"), getInspectionTemplates);
inspectionTemplatesRouter.post("/", requireInspectionAction("EDIT"), requireSettingsEdit, postInspectionTemplate);