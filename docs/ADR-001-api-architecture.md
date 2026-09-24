# ADR 001 — Production API architecture (studio backend)

**Status:** Accepted (Phase 0 — documentation only)  
**Date:** 2026-08-17  
**Context:** My Detail OS Express API (`backend/`)

## Decision

We will evolve the backend toward a **module-oriented public API** where each major business capability is understandable from one place (routes + service + schemas + OpenAPI), while **preserving current HTTP paths and behavior** during migration.

### Principles

1. **Public API = business modules.** Developers discover Job Cards, Billing, Customers, etc. by module — not only by storage mechanism.
2. **Storage is an implementation detail.** Relational Prisma models and `AppJsonRow` documents both live behind services.
3. **`/api/collections/*` is legacy / shared infrastructure.** It remains supported for the frontend and is documented as such. New domain logic should land in module services; collections become a thin gateway (and later optional aliases), not the long-term mental model.
4. **CRUD only where the product needs it.** Do not invent endpoints to “complete” REST.
5. **Special actions stay explicit** (e.g. convert quotation, upload photos, adjust wallet). Do not hide them inside opaque generic `PUT`s as the only documented API.
6. **Incremental migration, no big-bang rewrite.** Frontend compatibility is a hard gate.
7. **Do not redesign RBAC keys** in this track — keep `PERMISSION_KEYS`, `COLLECTION_PERMISSION_MAP`, existing middleware.

### Request pipeline (target)

```
Request
  → Route
  → Auth (requireAuth | public | platform)
  → Permission
  → Validation (Zod)
  → Controller
  → Service / domain logic
  → Prisma | AppJsonRow
  → Response { data, error: null } | errorHandler
```

### Non-goals (this ADR)

- Changing runtime routes or payloads in Phase 0
- Deduplicating bootstrap fetches (separate fix)
- Adding `organizationId` columns (separate tenant track)
- Inventing report-run / payment / nested payroll HTTP APIs without product + FE need

## Consequences

- **Short term:** Module-oriented API layout (Phases 0–4) plus **hard org isolation columns** on customers, vehicles, parties, and AppJsonRow (Phase 5).
- **Later:** Optional removal of unused collection traffic after telemetry; further multi-tenant hardening (e.g. composite PK if same entity ids per org are required).

## Related docs

| Doc | Purpose |
|-----|---------|
| [MODULE_OWNERSHIP.md](./MODULE_OWNERSHIP.md) | Who owns which paths / collections |
| [CRUD_AND_ACTIONS.md](./CRUD_AND_ACTIONS.md) | CRUD vs special actions matrix |
| [API_CONVENTIONS.md](./API_CONVENTIONS.md) | Response/error/auth/scope conventions |
| [OPENAPI.md](./OPENAPI.md) | How to use / extend Swagger |
| [MIGRATION_PHASES.md](./MIGRATION_PHASES.md) | Phased rollout (Phase 0–5 done) |
