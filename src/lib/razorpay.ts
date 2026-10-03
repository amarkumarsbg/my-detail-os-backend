import crypto from "node:crypto";
import Razorpay from "razorpay";
import { env } from "../config/env.js";

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

export function isRazorpayEnabled(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayKeyId(): string | null {
  return env.RAZORPAY_KEY_ID ?? null;
}

function getClient(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured");
  }
  return new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
}

/** Razorpay amounts are in the smallest currency unit (paise for INR). */
export function toRazorpayAmountPaise(amountInr: number): number {
  return Math.max(100, Math.round(amountInr * 100));
}

export async function createRazorpayOrder(input: {
  amountInr: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!isRazorpayEnabled()) {
    throw new Error("Razorpay is not configured");
  }
  const amount = toRazorpayAmountPaise(input.amountInr);
  if (amount < 100) {
    throw new Error("Amount must be at least 100 paise");
  }
  const currency = (input.currency ?? "INR").toUpperCase();
  const receipt = input.receipt.slice(0, 40);

  try {
    const order = await getClient().orders.create({
      amount,
      currency,
      receipt,
      notes: input.notes ?? {},
    });
    return {
      id: String(order.id),
      amount: Number(order.amount),
      currency: String(order.currency),
      receipt: String(order.receipt ?? receipt),
      status: String(order.status ?? "created"),
    };
  } catch (err) {
    const message =
      err && typeof err === "object" && "error" in err
        ? String(
            (err as { error?: { description?: string; reason?: string } }).error?.description ||
              (err as { error?: { reason?: string } }).error?.reason ||
              "Razorpay order failed"
          )
        : err instanceof Error
          ? err.message
          : "Razorpay order failed";
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : undefined;
    if (statusCode === 401) {
      const e = new Error("Razorpay authentication failed");
      (e as Error & { statusCode?: number }).statusCode = 401;
      throw e;
    }
    throw new Error(message);
  }
}

export type RazorpayGatewayOutcome =
  | { outcome: "PAID"; paymentId: string; status: string }
  | { outcome: "FAILED"; paymentId?: string; status: string }
  | { outcome: "PENDING"; status: string };

/** Returns the latest captured/authorized payment on an order, if any. */
export async function fetchCapturedRazorpayPaymentForOrder(
  orderId: string
): Promise<{ paymentId: string; orderId: string; status: string } | null> {
  const result = await fetchRazorpayOrderPaymentOutcome(orderId);
  if (!result || result.outcome !== "PAID") return null;
  return { paymentId: result.paymentId, orderId, status: result.status };
}

/** Poll Razorpay order payments → PAID / FAILED / PENDING. */
export async function fetchRazorpayOrderPaymentOutcome(
  orderId: string
): Promise<RazorpayGatewayOutcome | null> {
  if (!isRazorpayEnabled()) return null;
  try {
    const result = await getClient().orders.fetchPayments(orderId);
    const items = (result as { items?: Array<{ id?: string; status?: string }> }).items ?? [];
    const paid = items.find(
      (p) => p.id && (p.status === "captured" || p.status === "authorized")
    );
    if (paid?.id) {
      return { outcome: "PAID", paymentId: String(paid.id), status: String(paid.status) };
    }
    const failed = items.find(
      (p) =>
        p.id &&
        (p.status === "failed" || p.status === "cancelled")
    );
    if (failed?.id) {
      return { outcome: "FAILED", paymentId: String(failed.id), status: String(failed.status) };
    }
    try {
      const order = await getClient().orders.fetch(orderId);
      const orderStatus = String((order as { status?: string }).status ?? "");
      if (orderStatus === "paid") {
        return { outcome: "PENDING", status: orderStatus };
      }
    } catch {
      /* ignore order fetch errors */
    }
    return { outcome: "PENDING", status: "created" };
  } catch {
    return null;
  }
}

/** Poll Razorpay Payment Link → PAID / FAILED / PENDING. */
export async function fetchRazorpayPaymentLinkOutcome(
  paymentLinkId: string
): Promise<RazorpayGatewayOutcome | null> {
  if (!isRazorpayEnabled()) return null;
  try {
    const link = await getClient().paymentLink.fetch(paymentLinkId);
    const status = String((link as { status?: string }).status ?? "");
    const paymentsRaw = (link as { payments?: unknown }).payments;
    const payments: Array<{
      payment_id?: string;
      id?: string;
      status?: string;
    }> = Array.isArray(paymentsRaw)
      ? paymentsRaw
      : paymentsRaw && typeof paymentsRaw === "object"
        ? [paymentsRaw as { payment_id?: string; id?: string; status?: string }]
        : [];

    const captured = payments.find(
      (p) => p.status === "captured" || p.status === "authorized"
    );
    const paymentId = String(captured?.payment_id || captured?.id || "");

    if (status === "paid" || captured) {
      if (!paymentId) return { outcome: "PENDING", status: status || "paid" };
      return { outcome: "PAID", paymentId, status: status || String(captured?.status) };
    }
    if (status === "expired" || status === "cancelled") {
      return { outcome: "FAILED", status };
    }
    return { outcome: "PENDING", status: status || "created" };
  } catch {
    return null;
  }
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  if (!input.orderId || !input.paymentId || !input.signature) return false;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
  } catch {
    return false;
  }
}

export function verifyRazorpayWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type RazorpayPaymentLink = {
  id: string;
  shortUrl: string;
  amount: number;
  currency: string;
  status: string;
};

/** Hosted Payment Link (email/SMS-friendly). Amount in INR major units. */
/** Razorpay rejects localhost / invalid callback URLs; omit when unsafe. */
function sanitizePaymentLinkCallbackUrl(url?: string | null): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local")
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function createRazorpayPaymentLink(input: {
  amountInr: number;
  currency?: string;
  description: string;
  referenceId: string;
  customer?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  /** Razorpay native notify (WhatsApp is sent by our Twilio layer). */
  notify?: { email?: boolean; sms?: boolean };
  callbackUrl?: string;
}): Promise<RazorpayPaymentLink> {
  if (!isRazorpayEnabled()) {
    throw new Error("Razorpay is not configured");
  }
  const amount = toRazorpayAmountPaise(input.amountInr);
  const currency = (input.currency ?? "INR").toUpperCase();
  const callbackUrl = sanitizePaymentLinkCallbackUrl(input.callbackUrl);
  try {
    const link = await getClient().paymentLink.create({
      amount,
      currency,
      accept_partial: false,
      description: input.description.slice(0, 255),
      reference_id: input.referenceId.slice(0, 40),
      customer: {
        name: input.customer?.name?.slice(0, 50) || undefined,
        email: input.customer?.email || undefined,
        contact: input.customer?.contact || undefined,
      },
      notify: {
        email: Boolean(input.notify?.email && input.customer?.email),
        sms: Boolean(input.notify?.sms && input.customer?.contact),
      },
      reminder_enable: true,
      notes: input.notes ?? {},
      ...(callbackUrl
        ? { callback_url: callbackUrl, callback_method: "get" as const }
        : {}),
    });
    const shortUrl =
      String((link as { short_url?: string }).short_url ?? (link as { shortUrl?: string }).shortUrl ?? "");
    if (!shortUrl) {
      throw new Error("Razorpay payment link missing short_url");
    }
    return {
      id: String(link.id),
      shortUrl,
      amount: Number(link.amount),
      currency: String(link.currency ?? currency),
      status: String(link.status ?? "created"),
    };
  } catch (err) {
    const message =
      err && typeof err === "object" && "error" in err
        ? String(
            (err as { error?: { description?: string } }).error?.description ||
              "Razorpay payment link failed"
          )
        : err instanceof Error
          ? err.message
          : "Razorpay payment link failed";
    throw new Error(message);
  }
}

export async function notifyRazorpayPaymentLink(
  paymentLinkId: string,
  medium: "email" | "sms"
): Promise<boolean> {
  if (!isRazorpayEnabled()) return false;
  try {
    const res = await getClient().paymentLink.notifyBy(paymentLinkId, medium);
    return Boolean((res as { success?: boolean }).success ?? true);
  } catch {
    return false;
  }
}
