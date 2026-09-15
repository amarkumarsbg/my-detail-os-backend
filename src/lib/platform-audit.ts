import { prisma } from "./prisma.js";

interface AuditEntry {
  /** Null/omit for platform-wide actions not tied to a tenant. */
  organizationId?: string | null;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function writePlatformAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.platformAuditLog.create({
    data: {
      id: `pal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: entry.organizationId ?? null,
      actor: entry.actor,
      action: entry.action,
      before: (entry.before ?? undefined) as never,
      after: (entry.after ?? undefined) as never,
    },
  });
}
