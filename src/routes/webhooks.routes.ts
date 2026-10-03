import { Router, type Request, type Response, type NextFunction } from "express";
import { settleRazorpayOrderFromWebhook } from "../modules/organization/organization-subscription.service.js";
import { verifyRazorpayWebhookSignature, isRazorpayEnabled } from "../lib/razorpay.js";

export const webhooksRouter = Router();

/**
 * Razorpay webhooks — mount with express.raw({ type: "application/json" }).
 * Dashboard: payment.captured / order.paid
 */
webhooksRouter.post(
  "/razorpay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isRazorpayEnabled()) {
        res.status(503).json({ ok: false, error: "Razorpay not configured" });
        return;
      }

      const signature = String(req.headers["x-razorpay-signature"] ?? "");
      const raw = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

      if (!verifyRazorpayWebhookSignature(raw, signature)) {
        res.status(400).json({ ok: false, error: "Invalid webhook signature" });
        return;
      }

      const payload = JSON.parse(raw.toString("utf8")) as {
        event?: string;
        payload?: {
          payment?: {
            entity?: {
              id?: string;
              order_id?: string;
              status?: string;
              notes?: Record<string, string>;
            };
          };
          order?: { entity?: { id?: string; status?: string } };
          payment_link?: {
            entity?: {
              id?: string;
              notes?: Record<string, string>;
            };
          };
        };
      };

      const event = payload.event ?? "";
      const paymentEntity = payload.payload?.payment?.entity;
      const linkEntity = payload.payload?.payment_link?.entity;
      const orderId = paymentEntity?.order_id ?? payload.payload?.order?.entity?.id;
      const paymentId = paymentEntity?.id;
      const paymentLinkId = linkEntity?.id;
      const notesPaymentId =
        linkEntity?.notes?.paymentId ?? paymentEntity?.notes?.paymentId ?? null;

      if (
        (event === "payment.captured" ||
          event === "order.paid" ||
          event === "payment_link.paid") &&
        paymentId
      ) {
        await settleRazorpayOrderFromWebhook({
          orderId,
          paymentId,
          paymentLinkId,
          notesPaymentId,
        });
      } else if (
        (event === "payment_link.expired" ||
          event === "payment_link.cancelled" ||
          event === "payment.failed") &&
        (paymentLinkId || orderId || notesPaymentId)
      ) {
        const { markRazorpayPaymentFailedFromWebhook } = await import(
          "../modules/organization/organization-subscription.service.js"
        );
        await markRazorpayPaymentFailedFromWebhook({
          orderId,
          paymentId: paymentId ?? null,
          paymentLinkId,
          notesPaymentId,
          reason: event,
        });
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);
