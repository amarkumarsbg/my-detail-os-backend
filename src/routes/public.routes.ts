import { Router } from "express";
import {
  getPublicPlans,
  postPublicContact,
  postPublicPricingQuote,
  postPublicSignup,
} from "../controllers/public.controller.js";

export const publicRouter = Router();

publicRouter.post("/signup", postPublicSignup);
publicRouter.post("/contact", postPublicContact);
publicRouter.get("/plans", getPublicPlans);
publicRouter.post("/pricing/quote", postPublicPricingQuote);
publicRouter.post("/subscription/pricing", postPublicPricingQuote);
