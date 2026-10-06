ALTER TABLE "InspectionReport" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "InspectionReport_organizationId_deletedAt_updatedAt_idx"
ON "InspectionReport"("organizationId", "deletedAt", "updatedAt" DESC);
