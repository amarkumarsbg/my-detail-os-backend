-- CreateEnum
CREATE TYPE "ReferralTransactionType" AS ENUM ('REFERRER_POINTS', 'REFEREE_DISCOUNT');

-- CreateTable
CREATE TABLE "ReferralWallet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "ReferralTransactionType" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amountInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referralCode" TEXT NOT NULL,
    "sourceOrganizationId" TEXT,
    "paymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralWallet_organizationId_key" ON "ReferralWallet"("organizationId");
CREATE UNIQUE INDEX "ReferralTransaction_paymentId_type_key" ON "ReferralTransaction"("paymentId", "type");
CREATE INDEX "ReferralTransaction_walletId_createdAt_idx" ON "ReferralTransaction"("walletId", "createdAt");

ALTER TABLE "ReferralWallet" ADD CONSTRAINT "ReferralWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralTransaction" ADD CONSTRAINT "ReferralTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ReferralWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
