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

/** Returns the latest captured/authorized payment on an order, if any. */
export async function fetchCapturedRazorpayPaymentForOrder(
  orderId: string
): Promise<{ paymentId: string; orderId: string; status: string } | null> {
  if (!isRazorpayEnabled()) return null;
  try {
    const result = await getClient().orders.fetchPayments(orderId);
    const items = (result as { items?: Array<{ id?: string; status?: string }> }).items ?? [];
    const paid = items.find(
      (p) => p.id && (p.status === "captured" || p.status === "authorized")
    );
    if (!paid?.id) return null;
    return { paymentId: String(paid.id), orderId, status: String(paid.status) };
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
