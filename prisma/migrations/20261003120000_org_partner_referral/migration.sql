-- AlterTable
ALTER TABLE "PlatformReferralCode" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformReferralCode_organizationId_key" ON "PlatformReferralCode"("organizationId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlatformReferralCode_organizationId_fkey'
  ) THEN
    ALTER TABLE "PlatformReferralCode"
      ADD CONSTRAINT "PlatformReferralCode_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
