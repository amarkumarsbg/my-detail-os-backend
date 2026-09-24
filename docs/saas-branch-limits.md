# SaaS branch limits & platform owner — support runbook

## Two logins (do not mix)

| Role | Who | Access |
|------|-----|--------|
| `PLATFORM_OWNER` | **You** (software vendor) | `/saas-admin/*` — all customers, plans, branch limits, notes |
| `SUPER_ADMIN` | Customer studio owner | Normal app only — their organization |

Customers must never receive the platform login.

## Ensure your platform login (no Shell needed on Render free)

1. In Render → API → **Environment**, set:

```
PLATFORM_OWNER_EMAIL=platform@mydetailos.local
PLATFORM_OWNER_PASSWORD=ChangeMe!PlatformOwner1
```

(Use your real email/password for production later.)

2. **Redeploy** the API (Manual Deploy → Deploy latest commit that includes boot ensure).

3. Check logs for: `[saas] PLATFORM_OWNER created: …` or `updated`

4. Login on Vercel with that email/password → `/saas-admin/organizations`

### Alternative without waiting for deploy

From your laptop (copy `DATABASE_URL` from Render Environment):

```bash
cd backend
DATABASE_URL="postgresql://…from-render…" npm run saas:ensure-platform-owner
```

Disable boot ensure: `PLATFORM_OWNER_ENSURE_ON_BOOT=false`  
Stop resetting password each boot: `PLATFORM_OWNER_SYNC_PASSWORD=false`

## Raise a studio’s branch limit

1. Customer hits “Branch limit reached” → Contact support.
2. Sign in as platform owner → `/saas-admin/organizations` → open the studio.
3. Set `maxBranchesOverride` (e.g. `2`) and/or change plan → **Save**.
4. Ask the studio to refresh Locations / re-login.

## Automation CLI (optional)

```bash
cd backend
PLATFORM_ADMIN_API_KEY=… npx tsx scripts/saas-set-branch-limit.ts --org org-default --max 3
```

## Force one branch (testing only)

```bash
CONFIRM=YES npm run saas:force-one-branch -- --keep br-main
```

## Demo seed note

`npm run db:seed` sets Starter `maxBranches = 1`, keeps primary branch, and creates platform owner from env. Prefer `saas:ensure-platform-owner` on production instead of full seed.
