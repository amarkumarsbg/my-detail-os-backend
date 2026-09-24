import { openApiComponents } from "./components/index.js";
import { authPaths, healthPaths, publicPaths, attendanceAdminPaths } from "./paths/auth-health-public.paths.js";
import { customerPaths, vehiclePaths } from "./paths/customers-vehicles.paths.js";
import {
  branchPaths,
  partyPaths,
  userPaths,
} from "./paths/users-branches-parties.paths.js";
import {
  collectionPaths,
  jobCardUploadPaths,
  invoiceAliasPaths,
  quotationPaths,
} from "./paths/collections-jobs.paths.js";
import {
  attendancePaths,
  bootstrapPaths,
  jobsPaths,
  messagingPaths,
  organizationPaths,
  platformPaths,
  platformExtPaths,
} from "./paths/messaging-platform.paths.js";
import type { OpenApiPaths } from "./helpers.js";

const tags = [
  { name: "Health", description: "Liveness and service metadata" },
  { name: "Auth", description: "Login, OTP, password reset, and session" },
  { name: "Users", description: "Staff user management" },
  { name: "Staff", description: "Alias tag for staff/user APIs" },
  { name: "Customers", description: "Customer CRM and wallet" },
  { name: "Vehicles", description: "Vehicle registry" },
  { name: "Job Cards", description: "Job cards dedicated API + photo upload (FE primary; collections compat)" },
  { name: "Billing", description: "Invoices dedicated API + public invoice (FE primary; collections compat)" },
  { name: "Quotations", description: "Quotations dedicated API + convert-to-job (FE primary; collections compat)" },
  { name: "Appointments", description: "Appointments via collections/appointments" },
  {
    name: "Bookings",
    description:
      "Customer bookings are Appointment rows with kind=BOOKING (same appointments collection)",
  },
  { name: "Pickup/Drop", description: "pickupDropRequests collection" },
  { name: "Services", description: "serviceCatalog / categories / highEndServices collections" },
  { name: "Inventory", description: "parts / stockMovements / productPurchases / branchStocks / stockTransfers / partCategories collections" },
  { name: "Reports", description: "reportSchedules and reporting-related collections" },
  { name: "Settings", description: "appSettings + logo upload" },
  { name: "Collections", description: "LEGACY gateway: generic AppJsonRow list/upsert/snapshot/delete. Prefer module docs; see backend/docs/ADR-001-api-architecture.md" },
  { name: "Branches", description: "Branch management" },
  { name: "Parties", description: "Customer/supplier parties and ledger" },
  { name: "Messaging", description: "SMS, WhatsApp, email" },
  { name: "Attendance", description: "Public QR punch + dashboard attendance" },
  { name: "Bootstrap", description: "Studio bootstrap payload" },
  { name: "Organization", description: "Studio subscription entitlement" },
  { name: "SaaS Admin", description: "Platform-owner control plane (/api/platform)" },
  { name: "Jobs", description: "Internal cron/job endpoints (/api/jobs). Auth via X-Internal-Job-Key or JWT." },
  { name: "Public", description: "Unauthenticated public invoice/branding" },
];

function mergePaths(...parts: OpenApiPaths[]): OpenApiPaths {
  return Object.assign({}, ...parts);
}

export function buildOpenApiDocument(options?: { serverUrl?: string }) {
  const serverUrl = options?.serverUrl?.replace(/\/$/, "") || "/";
  return {
    openapi: "3.0.3",
    info: {
      title: "My Detail OS API",
      version: "0.1.0",
      description: [
        "Express API for My Detail OS studio and SaaS platform.",
        "",
        "## Authentication",
        "1. Call `POST /api/auth/login` (or OTP verify) to obtain `accessToken`.",
        "2. Click **Authorize** and paste the JWT (without the `Bearer ` prefix).",
        "3. Protected routes send `Authorization: Bearer <token>`.",
        "",
        "## Permissions",
        "Most studio routes require a permission key in the JWT (SUPER_ADMIN bypasses).",
        "Collection routes map collection names → permission keys (default-deny).",
        "",
        "## Architecture",
        "See `backend/docs/ADR-001-api-architecture.md`, module ownership, CRUD vs actions, and API conventions.",
        "`/api/collections/*` is a **legacy** document gateway (AppJsonRow). Dedicated REST exists for customers, vehicles, users, branches, parties, and (Phase 4) studio FE primary paths for job-cards, invoices, and quotations. Matching collection names remain for compatibility.",
        "",
        "## SaaS Admin",
        "`/api/platform/*` accepts PLATFORM_OWNER JWT **or** header `X-Platform-Admin-Key`.",
        "",
        "## Safety",
        "This document never includes real secrets, passwords, or database credentials.",
        "Do not paste production tokens into shared Swagger sessions.",
      ].join("\n"),
    },
    servers: [{ url: serverUrl, description: "API base" }],
    tags,
    paths: mergePaths(
      healthPaths,
      authPaths,
      publicPaths,
      bootstrapPaths,
      customerPaths,
      vehiclePaths,
      userPaths,
      branchPaths,
      partyPaths,
      collectionPaths,
      jobCardUploadPaths,
      invoiceAliasPaths,
      quotationPaths,
      messagingPaths,
      attendancePaths,
      attendanceAdminPaths,
      organizationPaths,
      platformPaths,
      platformExtPaths,
      jobsPaths
    ),
    components: openApiComponents,
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
