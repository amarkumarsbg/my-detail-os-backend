-- Convert PlanCode enum to free-form string for dynamic plan CRUD
ALTER TABLE "OrganizationSubscription" ALTER COLUMN "planCode" TYPE TEXT USING ("planCode"::text);
DROP TYPE IF EXISTS "PlanCode";
