-- PlatformSettings singleton + nullable org on platform audit for non-org actions.

ALTER TABLE "PlatformAuditLog" ALTER COLUMN "organizationId" DROP NOT NULL;

CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
