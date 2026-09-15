import { Router } from "express";
import { requirePlatformAuth } from "../../middleware/platform-auth.js";
import {
  getPlatformOrganization,
  listPlatformOrganizations,
  patchPlatformOrganizationSubscription,
  postPlatformMarkPaid,
  postPlatformVerifyPayment,
} from "../organization/organization.controller.js";
import {
  getPlatformDashboard,
  listPlatformUsers,
  listPlatformBranches,
  listPlatformRenewals,
  listPlatformBills,
  listPlatformPayments,
  listPlatformAudit,
  listPlatformReferrals,
  createPlatformReferral,
  patchPlatformReferral,
  getPlatformPlans,
  putPlatformPlans,
  postPlatformPlan,
  patchPlatformPlan,
  deletePlatformPlanHandler,
  getPlatformSettingsHandler,
  putPlatformSettingsHandler,
  getPlatformMessagingStatus,
  suspendOrganization,
  restoreOrganization,
} from "./platform.controller.js";

export const platformRouter = Router();

platformRouter.use(requirePlatformAuth);

platformRouter.get("/dashboard", getPlatformDashboard);

platformRouter.get("/users", listPlatformUsers);
platformRouter.get("/branches", listPlatformBranches);

// Existing org endpoints
platformRouter.get("/organizations", listPlatformOrganizations);
platformRouter.get("/organizations/:orgId", getPlatformOrganization);
platformRouter.patch("/organizations/:orgId/subscription", patchPlatformOrganizationSubscription);
platformRouter.post("/organizations/:orgId/subscription/verify-payment", postPlatformVerifyPayment);
platformRouter.post("/organizations/:orgId/subscription/mark-paid", postPlatformMarkPaid);

// Suspend / restore
platformRouter.post("/organizations/:orgId/suspend", suspendOrganization);
platformRouter.post("/organizations/:orgId/restore", restoreOrganization);

// Cross-org data endpoints
platformRouter.get("/renewals", listPlatformRenewals);
platformRouter.get("/bills", listPlatformBills);
platformRouter.get("/payments", listPlatformPayments);
platformRouter.get("/audit", listPlatformAudit);
platformRouter.get("/referrals", listPlatformReferrals);
platformRouter.post("/referrals", createPlatformReferral);
platformRouter.patch("/referrals/:id", patchPlatformReferral);

platformRouter.get("/plans", getPlatformPlans);
platformRouter.put("/plans", putPlatformPlans);
platformRouter.post("/plans", postPlatformPlan);
platformRouter.patch("/plans/:code", patchPlatformPlan);
platformRouter.delete("/plans/:code", deletePlatformPlanHandler);

platformRouter.get("/settings", getPlatformSettingsHandler);
platformRouter.put("/settings", putPlatformSettingsHandler);

platformRouter.get("/messaging", getPlatformMessagingStatus);
