import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticateCustomer, signCustomerAuthToken, setCustomerPassword } from "./customer-auth.service.js";
import { getCustomerById } from "./customer.service.js";
import { customerPasswordSchema } from "../../lib/password-policy.js";
import { getOrganizationBySlug } from "../../services/organization-public.service.js";

const loginSchema = z
  .object({
    phone: z.string().min(1),
    password: z.string().min(1),
    /** Preferred: resolve tenant from public slug (URL). */
    organizationSlug: z.string().min(1).optional(),
    /** Alternate: explicit org id when already resolved server-side. */
    organizationId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.organizationSlug?.trim() || v.organizationId?.trim()), {
    message: "organizationSlug or organizationId is required",
    path: ["organizationSlug"],
  });

const setPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: customerPasswordSchema,
});

/** POST /api/auth/customer/login — tenant-scoped (slug or organizationId required). */
export async function postCustomerLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);
    let organizationId = body.organizationId?.trim() || "";
    if (body.organizationSlug?.trim()) {
      const org = await getOrganizationBySlug(body.organizationSlug.trim());
      if (!org.isActive) {
        res.status(403).json({ data: null, error: { message: "This organization is inactive." } });
        return;
      }
      organizationId = org.id;
    }
    if (!organizationId) {
      res.status(400).json({
        data: null,
        error: { message: "organizationSlug or organizationId is required" },
      });
      return;
    }

    const customer = await authenticateCustomer(body.phone, body.password, organizationId);
    if (!customer) {
      res.status(401).json({ data: null, error: { message: "Invalid phone or password" } });
      return;
    }
    if (customer.organizationId !== organizationId) {
      res.status(401).json({ data: null, error: { message: "Invalid phone or password" } });
      return;
    }

    const accessToken = signCustomerAuthToken(customer);
    const user = await getCustomerById(customer.id, customer.organizationId);

    res.json({ data: { accessToken, user }, error: null });
  } catch (e) {
    next(e);
  }
}

/** GET /api/auth/customer/me */
export async function getCustomerMe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth?.customerId || !req.auth.organizationId) {
      res.status(401).json({ data: null, error: { message: "Unauthorized" } });
      return;
    }
    const user = await getCustomerById(req.auth.customerId, req.auth.organizationId);
    if (!user) {
      res.status(404).json({ data: null, error: { message: "Customer not found" } });
      return;
    }
    res.json({ data: { user }, error: null });
  } catch (e) {
    next(e);
  }
}

/** POST /api/auth/customer/logout — stateless JWT; client discards the token. */
export async function postCustomerLogout(_req: Request, res: Response) {
  res.json({ data: { ok: true }, error: null });
}

/**
 * POST /api/auth/customer/set-password
 * Lets a logged-in customer change their password whenever they want (optional,
 * not forced). Requires their current password to prevent a stolen/expired
 * token from being used to silently take over the account.
 * Note: this endpoint requires an authenticated session (Bearer token). A true
 * unauthenticated "forgot password" flow (no active session) would need OTP/SMS
 * verification, which is not implemented yet.
 */
export async function postCustomerSetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth?.customerId || !req.auth.organizationId) {
      res.status(401).json({ data: null, error: { message: "Unauthorized" } });
      return;
    }
    const body = setPasswordSchema.parse(req.body);
    const updated = await setCustomerPassword(
      req.auth.customerId,
      req.auth.organizationId,
      body.currentPassword,
      body.newPassword
    );
    if (!updated) {
      res.status(401).json({ data: null, error: { message: "Current password is incorrect." } });
      return;
    }
    const user = await getCustomerById(updated.id, updated.organizationId);
    res.json({ data: { user }, error: null });
  } catch (e) {
    next(e);
  }
}
