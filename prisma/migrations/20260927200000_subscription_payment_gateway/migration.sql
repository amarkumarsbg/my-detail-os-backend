-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gatewayProvider" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gatewayOrderId" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "gatewayPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPayment_gatewayOrderId_key" ON "SubscriptionPayment"("gatewayOrderId");
