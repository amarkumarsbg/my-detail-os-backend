import { Router } from "express";
import { requireAuth, requireCustomerAuth } from "../../middleware/auth.js";
import {
  getCustomerInspectionAsset,
  getCustomerInspectionById,
  getCustomerInspectionPdf,
  getCustomerInspections,
} from "./customer-inspections.controller.js";

export const customerInspectionsRouter = Router();

customerInspectionsRouter.use(requireAuth, requireCustomerAuth);

customerInspectionsRouter.get("/", getCustomerInspections);
customerInspectionsRouter.get("/assets/:assetId", getCustomerInspectionAsset);
customerInspectionsRouter.get("/:id/pdf", getCustomerInspectionPdf);
customerInspectionsRouter.get("/:id", getCustomerInspectionById);
