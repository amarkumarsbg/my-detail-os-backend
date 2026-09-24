-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_OWNER';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" "PlanCode" NOT NULL,
    "planName" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "limits" JSONB NOT NULL,
    "maxBranchesOverride" INTEGER,
    "contactUsUrl" TEXT,
    "upgradeUrl" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSubscription_organizationId_key" ON "OrganizationSubscription"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default org + subscription (limit >= existing branch count so demos are not soft-locked)
INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES ('org-default', 'My Detail OS', 'my-detail-os', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "OrganizationSubscription" (
  "id", "organizationId", "planCode", "planName", "status", "limits",
  "maxBranchesOverride", "contactUsUrl", "upgradeUrl", "createdAt", "updatedAt"
)
SELECT
  'sub-default',
  'org-default',
  'STARTER',
  'Starter',
  'ACTIVE',
  jsonb_build_object(
    'maxBranches',
    GREATEST(1, (SELECT COUNT(*)::int FROM "Branch"))
  ),
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP;

-- AlterTable Branch
ALTER TABLE "Branch" ADD COLUMN "organizationId" TEXT;

UPDATE "Branch" SET "organizationId" = 'org-default' WHERE "organizationId" IS NULL;

ALTER TABLE "Branch" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

UPDATE "User" SET "organizationId" = 'org-default' WHERE "organizationId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
