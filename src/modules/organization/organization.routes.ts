import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getStudioSubscriptionRenewals,
  getStudioSubscription,
  getStudioSubscriptionBill,
  getStudioSubscriptionBills,
  getStudioPaymentConfig,
  postStudioAddOnPricing,
  postStudioAddOnRequest,
  postStudioSubscriptionPricing,
  postStudioRenewRequest,
  postStudioConfirmRazorpayPayment,
  postStudioSyncRazorpayPayment,
} from "./organization.controller.js";

export const organizationRouter = Router();

organizationRouter.use(requireAuth);
organizationRouter.get("/subscription", getStudioSubscription);
organizationRouter.get("/subscription/payment-config", getStudioPaymentConfig);
organizationRouter.post("/subscription/pricing", postStudioSubscriptionPricing);
organizationRouter.post("/subscription/addon/pricing", postStudioAddOnPricing);
organizationRouter.post("/subscription/addon", postStudioAddOnRequest);
organizationRouter.post("/subscription/renew", postStudioRenewRequest);
organizationRouter.post("/subscription/confirm-razorpay", postStudioConfirmRazorpayPayment);
organizationRouter.post("/subscription/sync-razorpay", postStudioSyncRazorpayPayment);
organizationRouter.get("/subscription/bills", getStudioSubscriptionBills);
organizationRouter.get("/subscription/bills/:billId", getStudioSubscriptionBill);
organizationRouter.get("/subscription/renewals", getStudioSubscriptionRenewals);
