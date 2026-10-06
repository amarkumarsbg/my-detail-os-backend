import { bearerSecurity, commonErrorResponses, jsonBody, okResponse, type OpenApiPaths } from "../helpers.js";

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const revisionBody = jsonBody({ type: "object", required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } });
const listQuery = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "q", in: "query", schema: { type: "string" } },
  { name: "branchId", in: "query", schema: { type: "string" }, description: "Must be within the caller's server-resolved branch scope." },
  { name: "from", in: "query", schema: { type: "string", format: "date" } },
  { name: "to", in: "query", schema: { type: "string", format: "date" } },
];

export const inspectionPaths: OpenApiPaths = {
  "/api/inspections": {
    get: {
      tags: ["Inspections"], summary: "List vehicle inspections", security: bearerSecurity,
      description: "Requires JOB_CARDS_VIEW. Branch scope is enforced by the server.", parameters: [...listQuery, { name: "status", in: "query", schema: { type: "string" } }],
      responses: { "200": okResponse({ type: "object", properties: { items: { type: "array", items: { type: "object", additionalProperties: true } }, total: { type: "integer" }, totalPages: { type: "integer" } } }), ...commonErrorResponses() },
    },
    post: {
      tags: ["Inspections"], summary: "Create an inspection draft", security: bearerSecurity,
      description: "Requires JOB_CARDS_CREATE. The server assigns ID, report number, revision, and audit fields.",
      requestBody: jsonBody({ type: "object", required: ["customerId", "vehicleId", "sections"], additionalProperties: true }),
      responses: { "201": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() },
    },
  },
  "/api/inspections/send-history": {
    get: {
      tags: ["Inspections"], summary: "List inspection send history", security: bearerSecurity,
      description: "Requires JOB_CARDS_VIEW. Status is QUEUED, SENT, DELIVERED, or FAILED.", parameters: [...listQuery, { name: "status", in: "query", schema: { type: "string", enum: ["QUEUED", "SENT", "DELIVERED", "FAILED"] } }],
      responses: { "200": okResponse({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { inspectionId: { type: "string" }, revision: { type: "integer" }, pdfUrl: { type: "string" } }, additionalProperties: true } }, total: { type: "integer" }, totalPages: { type: "integer" } } }), ...commonErrorResponses() },
    },
  },
  "/api/inspections/send-history/{sendLogId}/pdf": {
    get: {
      tags: ["Inspections"], summary: "Download the exact PDF attached to a send-history entry", security: bearerSecurity,
      description: "Requires JOB_CARDS_VIEW and an unlocked subscription export entitlement. Re-renders the immutable sent-revision snapshot and retained photos in the current PDF layout; the original stored send attachment is unchanged.",
      parameters: [{ name: "sendLogId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "PDF sent for this history entry", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
        ...commonErrorResponses(),
      },
    },
  },
  "/api/inspections/uploads": {
    post: {
      tags: ["Inspections"], summary: "Upload a private inspection photo", security: bearerSecurity,
      description: "Requires JOB_CARDS_CREATE. JPEG, PNG, or WebP, maximum 10 MB. Provide branchId in multipart form data.",
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["photo", "branchId"], properties: { photo: { type: "string", format: "binary" }, branchId: { type: "string" } } } } } },
      responses: { "201": okResponse({ type: "object", properties: { id: { type: "string" }, url: { type: "string" } } }), ...commonErrorResponses() },
    },
  },
  "/api/inspections/assets/{assetId}": {
    get: {
      tags: ["Inspections"], summary: "Read an authorized private inspection photo", security: bearerSecurity,
      description: "Requires JOB_CARDS_VIEW and organization/branch access to the upload or its linked report.",
      parameters: [{ name: "assetId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": {
          description: "Private photo bytes",
          content: {
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
          },
        },
        ...commonErrorResponses(),
      },
    },
  },
  "/api/inspections/{id}": {
    get: { tags: ["Inspections"], summary: "Read an inspection", security: bearerSecurity, description: "Requires JOB_CARDS_VIEW. The item includes revision-specific pdfUrl values for retained finalized versions.", parameters: [idParam], responses: { "200": okResponse({ type: "object", properties: { item: { type: "object", properties: { revision: { type: "integer" }, pdfUrl: { type: "string" }, finalizedRevision: { type: "integer" }, versions: { type: "array", items: { type: "object", properties: { revision: { type: "integer" }, pdfUrl: { type: "string" } }, additionalProperties: true } } }, additionalProperties: true } } }), ...commonErrorResponses() } },
    put: { tags: ["Inspections"], summary: "Update a draft inspection", security: bearerSecurity, description: "Requires JOB_CARDS_EDIT. Body must include expected revision; stale writes return 409.", parameters: [idParam], requestBody: jsonBody({ type: "object", required: ["revision", "customerId", "vehicleId", "sections"], additionalProperties: true }), responses: { "200": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() } },
    delete: { tags: ["Inspections"], summary: "Soft-delete an inspection", security: bearerSecurity, description: "Requires JOB_CARDS_DELETE and organization/branch access. Returns { deleted: true } and retains report versions and send audit history.", parameters: [idParam], responses: { "200": okResponse({ type: "object", properties: { deleted: { type: "boolean", enum: [true] } } }), ...commonErrorResponses() } },
  },
  "/api/inspections/{id}/finalize": { post: { tags: ["Inspections"], summary: "Finalize and freeze an inspection", security: bearerSecurity, description: "Requires JOB_CARDS_EDIT. Validates completeness, stores a canonical PDF, and returns the report with status FINAL.", parameters: [idParam], requestBody: revisionBody, responses: { "200": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() } } },
  "/api/inspections/{id}/revisions": { post: { tags: ["Inspections"], summary: "Start a draft revision", security: bearerSecurity, description: "Requires JOB_CARDS_EDIT. Prior finalized snapshots remain immutable.", parameters: [idParam], requestBody: revisionBody, responses: { "200": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() } } },
  "/api/inspections/{id}/send": { post: { tags: ["Inspections"], summary: "Send a finalized PDF", security: bearerSecurity, description: "Requires JOB_CARDS_EDIT. Uses tenant-scoped requestId idempotency; provider delivery status is updated by authenticated webhooks.", parameters: [idParam], requestBody: jsonBody({ type: "object", required: ["channel", "recipient", "revision", "requestId"], properties: { channel: { type: "string", enum: ["WHATSAPP", "EMAIL"] }, recipient: { type: "string" }, revision: { type: "integer" }, requestId: { type: "string" } } }), responses: { "200": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() } } },
  "/api/inspections/{id}/pdf": { get: { tags: ["Inspections"], summary: "Download a finalized inspection PDF", security: bearerSecurity, description: "Requires JOB_CARDS_VIEW and an unlocked subscription export entitlement.", parameters: [idParam, { name: "revision", in: "query", required: true, schema: { type: "integer", minimum: 1 } }], responses: { "200": { description: "Canonical PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, ...commonErrorResponses() } } },
  "/api/inspection-templates": {
    get: { tags: ["Inspections"], summary: "List organization inspection templates", security: bearerSecurity, description: "Requires JOB_CARDS_VIEW.", responses: { "200": okResponse({ type: "object", properties: { items: { type: "array", items: { type: "object", additionalProperties: true } } } }), ...commonErrorResponses() } },
    post: { tags: ["Inspections"], summary: "Create an organization inspection template", security: bearerSecurity, description: "Requires JOB_CARDS_EDIT and SETTINGS_EDIT.", requestBody: jsonBody({ type: "object", required: ["name", "sections", "terms"], additionalProperties: true }), responses: { "201": okResponse({ type: "object", properties: { item: { type: "object", additionalProperties: true } } }), ...commonErrorResponses() } },
  },
  "/api/public/inspection-documents/{versionId}": {
    get: {
      tags: ["Public"], summary: "Fetch a signed inspection PDF for provider media delivery",
      description: "Short-lived HMAC-signed URL. Not a general report-sharing route.",
      parameters: [
        { name: "versionId", in: "path", required: true, schema: { type: "string" } },
        { name: "expires", in: "query", required: true, schema: { type: "integer" } },
        { name: "signature", in: "query", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Canonical PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
        ...commonErrorResponses(),
      },
    },
  },
};