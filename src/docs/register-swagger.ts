import type { Express, Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./openapi.js";

/** True when Swagger UI / OpenAPI JSON should be mounted. */
export function isSwaggerEnabled(): boolean {
  const raw = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  // Default: on in non-production, off in production
  return process.env.NODE_ENV !== "production";
}

/**
 * Mounts:
 * - GET /api/docs — Swagger UI
 * - GET /api/docs/openapi.json — raw OpenAPI 3 document
 *
 * No-op when disabled (production default).
 */
export function registerSwagger(app: Express): void {
  if (!isSwaggerEnabled()) return;

  const document = buildOpenApiDocument({ serverUrl: "/" });

  app.get("/api/docs/openapi.json", (_req: Request, res: Response) => {
    res.json(document);
  });

  app.use(
    "/api/docs",
    (_req: Request, res: Response, next: NextFunction) => {
      // Discourage caching of the UI shell in shared environments
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: "MY DETAIL OS API Docs",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        filter: true,
        tryItOutEnabled: true,
      },
    })
  );

  console.info("[swagger] UI available at /api/docs (spec: /api/docs/openapi.json)");
}
