-- CreateEnum
CREATE TYPE "MarketingBannerAudience" AS ENUM ('TRIAL', 'ACTIVE', 'ALL');

-- CreateTable
CREATE TABLE "MarketingBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "audience" "MarketingBannerAudience" NOT NULL DEFAULT 'TRIAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Upgrade',
    "ctaUrl" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingBanner_enabled_audience_sortOrder_idx" ON "MarketingBanner"("enabled", "audience", "sortOrder");
