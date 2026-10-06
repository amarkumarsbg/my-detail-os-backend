CREATE TABLE "InspectionReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InspectionReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InspectionReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "documentKey" TEXT,
    "finalizedBy" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InspectionReportVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "terms" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InspectionUpload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reportId" TEXT,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "cleaning" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InspectionUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InspectionSendLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "documentKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerError" TEXT,
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InspectionSendLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InspectionReport_organizationId_reportNumber_key" ON "InspectionReport"("organizationId", "reportNumber");
CREATE INDEX "InspectionReport_organizationId_branchId_updatedAt_idx" ON "InspectionReport"("organizationId", "branchId", "updatedAt" DESC);
CREATE INDEX "InspectionReport_organizationId_status_updatedAt_idx" ON "InspectionReport"("organizationId", "status", "updatedAt" DESC);
CREATE UNIQUE INDEX "InspectionReportVersion_reportId_revision_key" ON "InspectionReportVersion"("reportId", "revision");
CREATE INDEX "InspectionReportVersion_reportId_finalizedAt_idx" ON "InspectionReportVersion"("reportId", "finalizedAt" DESC);
CREATE UNIQUE INDEX "InspectionTemplate_organizationId_name_key" ON "InspectionTemplate"("organizationId", "name");
CREATE INDEX "InspectionTemplate_organizationId_updatedAt_idx" ON "InspectionTemplate"("organizationId", "updatedAt" DESC);
CREATE UNIQUE INDEX "InspectionUpload_objectKey_key" ON "InspectionUpload"("objectKey");
CREATE INDEX "InspectionUpload_organizationId_branchId_reportId_idx" ON "InspectionUpload"("organizationId", "branchId", "reportId");
CREATE INDEX "InspectionUpload_expiresAt_idx" ON "InspectionUpload"("expiresAt");
CREATE UNIQUE INDEX "InspectionSendLog_organizationId_requestId_key" ON "InspectionSendLog"("organizationId", "requestId");
CREATE INDEX "InspectionSendLog_organizationId_sentAt_idx" ON "InspectionSendLog"("organizationId", "sentAt" DESC);
CREATE INDEX "InspectionSendLog_reportId_revision_sentAt_idx" ON "InspectionSendLog"("reportId", "revision", "sentAt" DESC);

ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InspectionReportVersion" ADD CONSTRAINT "InspectionReportVersion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InspectionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectionUpload" ADD CONSTRAINT "InspectionUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectionUpload" ADD CONSTRAINT "InspectionUpload_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InspectionUpload" ADD CONSTRAINT "InspectionUpload_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InspectionReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InspectionSendLog" ADD CONSTRAINT "InspectionSendLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InspectionSendLog" ADD CONSTRAINT "InspectionSendLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InspectionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;