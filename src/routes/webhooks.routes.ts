import express, { Router, type Request, type Response, type NextFunction } from "express";
import { Webhook } from "svix";
import { env } from "../config/env.js";
import { settleRazorpayOrderFromWebhook } from "../modules/organization/organization-subscription.service.js";
import { verifyRazorpayWebhookSignature, isRazorpayEnabled } from "../lib/razorpay.js";
import { postInspectionWhatsAppStatus } from "../modules/inspections/inspections.controller.js";
import { updateInspectionEmailStatus } from "../modules/inspections/inspection-delivery.service.js";

export const webhooksRouter = Router();

webhooksRouter.post(
  "/inspection-whatsapp",
  express.urlencoded({ extended: false }),
  postInspectionWhatsAppStatus
);

webhooksRouter.post("/inspection-email", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = env.RESEND_WEBHOOK_SECRET;
    if (!secret || !Buffer.isBuffer(req.body)) {
      res.status(503).json({ data: null, error: { message: "Resend inspection webhook is not configured." } });
      return;
    }
    let event: {
      type?: string;
      data?: {
        email_id?: string;
        id?: string;
        bounce?: { message?: string };
        tags?: Record<string, string> | Array<{ name?: string; value?: string }>;
      };
    };
    try {
      event = new Webhook(secret).verify(req.body.toString("utf8"), {
        "svix-id": String(req.headers["svix-id"] ?? ""),
        "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
        "svix-signature": String(req.headers["svix-signature"] ?? ""),
      }) as unknown as typeof event;
    } catch {
      res.status(403).json({ data: null, error: { message: "Invalid provider webhook signature" } });
      return;
    }
    const providerMessageId = event.data?.email_id ?? event.data?.id;
    if (!event.type || !providerMessageId) {
      res.status(400).json({ data: null, error: { message: "Invalid Resend webhook payload" } });
      return;
    }
    await updateInspectionEmailStatus({
      providerMessageId,
      sendLogId: Array.isArray(event.data?.tags)
        ? event.data.tags.find((tag) => tag.name === "inspection_send_id")?.value
        : event.data?.tags?.inspection_send_id,
      eventType: event.type,
      error: event.data?.bounce?.message,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

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
