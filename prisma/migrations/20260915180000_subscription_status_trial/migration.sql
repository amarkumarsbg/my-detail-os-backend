-- Align SubscriptionStatus with rows that already use TRIAL (e.g. self-serve / provision trials).
-- Idempotent: skip if TRIAL already exists on the enum.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'SubscriptionStatus'
      AND e.enumlabel = 'TRIAL'
  ) THEN
    ALTER TYPE "SubscriptionStatus" ADD VALUE 'TRIAL';
  END IF;
END
$$;
