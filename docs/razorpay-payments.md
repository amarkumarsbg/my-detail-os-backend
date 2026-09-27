# Razorpay SaaS subscription payments

Online checkout for workshop renewals / trial upgrades. When Razorpay is **not** configured, renewals stay **MANUAL** (admin verify / mark paid).

## Env (API)

```bash
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...   # optional but recommended
```

## Flow

1. Studio: Plan & Billing → Renew / Upgrade (or banner **Pay now**)
2. `POST /api/organization/subscription/renew` creates `SubscriptionPayment` + Razorpay order
3. Razorpay Checkout opens in the browser
4. On success: `POST /api/organization/subscription/confirm-razorpay` (signature verified)
5. Existing `verifySubscriptionPayment` extends term + creates `SubscriptionBill`
6. Optional webhook: `POST /api/webhooks/razorpay` (`payment.captured` / `order.paid`)

## Webhook setup

Razorpay Dashboard → Webhooks → URL:

`https://<your-api-host>/api/webhooks/razorpay`

Events: `payment.captured`, `order.paid`

## Fallback

Admin Portal → Payments / Org detail → **Mark paid** / **Verify payment** still works for offline transfers.
