import { z } from "zod";
import {
  getCollectionItem,
  upsertCollectionItem,
} from "../collections/app-json-store.js";

/** Private AppJsonRow — linked workshop staff user ids for workspace switching. */
export const USER_WORKSPACE_LINKS_COLLECTION = "userWorkspaceLinks";

const payloadSchema = z.object({
  id: z.string().min(1),
  linkedUserIds: z.array(z.string().min(1)).max(50),
  updatedAt: z.string().optional(),
});

function normalizeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function getLinkedWorkspaceUserIds(
  userId: string,
  organizationId: string
): Promise<string[]> {
  const raw = await getCollectionItem(
    USER_WORKSPACE_LINKS_COLLECTION,
    userId,
    organizationId
  );
  if (!raw) return [];
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return [];
  return normalizeIds(parsed.data.linkedUserIds).filter((id) => id !== userId);
}

export async function setLinkedWorkspaceUserIds(
  userId: string,
  organizationId: string,
  linkedUserIds: string[]
): Promise<string[]> {
  const next = normalizeIds(linkedUserIds).filter((id) => id !== userId);
  await upsertCollectionItem(
    USER_WORKSPACE_LINKS_COLLECTION,
    userId,
    {
      id: userId,
      linkedUserIds: next,
      updatedAt: new Date().toISOString(),
    },
    organizationId
  );
  return next;
}

/** Bidirectional link so either account can switch to the other. */
export async function linkWorkspaceUsers(a: {
  userId: string;
  organizationId: string;
}, b: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const [aLinks, bLinks] = await Promise.all([
    getLinkedWorkspaceUserIds(a.userId, a.organizationId),
    getLinkedWorkspaceUserIds(b.userId, b.organizationId),
  ]);
  await Promise.all([
    setLinkedWorkspaceUserIds(a.userId, a.organizationId, [...aLinks, b.userId]),
    setLinkedWorkspaceUserIds(b.userId, b.organizationId, [...bLinks, a.userId]),
  ]);
}

export async function unlinkWorkspaceUsers(a: {
  userId: string;
  organizationId: string;
}, b: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const [aLinks, bLinks] = await Promise.all([
    getLinkedWorkspaceUserIds(a.userId, a.organizationId),
    getLinkedWorkspaceUserIds(b.userId, b.organizationId),
  ]);
  await Promise.all([
    setLinkedWorkspaceUserIds(
      a.userId,
      a.organizationId,
      aLinks.filter((id) => id !== b.userId)
    ),
    setLinkedWorkspaceUserIds(
      b.userId,
      b.organizationId,
      bLinks.filter((id) => id !== a.userId)
    ),
  ]);
}
