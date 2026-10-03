import type { User, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ensureOrganizationHasSlug } from "../../lib/ensure-organization-slug.js";
import { getLinkedWorkspaceUserIds } from "./workspace-links.service.js";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function phoneTenDigits(phone: string): string | null {
  const d = digitsOnly(phone);
  if (d.length < 10) return null;
  return d.slice(-10);
}

export type WorkspaceAccount = {
  userId: string;
  userName: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  isCurrent: boolean;
  isActive: boolean;
  subscriptionStatus: string | null;
  /** true when linked via credentials (not only same phone). */
  linkSource: "self" | "phone" | "linked";
};

type UserWithOrg = User & {
  organization: {
    id: string;
    name: string;
    slug: string | null;
    isActive: boolean;
    subscription: { status: string } | null;
  };
};

async function toWorkspaceRow(
  u: UserWithOrg,
  currentUserId: string,
  linkSource: WorkspaceAccount["linkSource"]
): Promise<WorkspaceAccount | null> {
  const existingSlug = u.organization.slug?.trim().toLowerCase() ?? "";
  const org = existingSlug
    ? {
        id: u.organization.id,
        name: u.organization.name,
        slug: existingSlug,
      }
    : await ensureOrganizationHasSlug(u.organizationId);
  if (!org) return null;

  return {
    userId: u.id,
    userName: u.name,
    role: u.role,
    organizationId: u.organizationId,
    organizationName: org.name,
    organizationSlug: org.slug,
    isCurrent: u.id === currentUserId,
    isActive: u.organization.isActive,
    subscriptionStatus: u.organization.subscription?.status ?? null,
    linkSource,
  };
}

/** Associated workspaces: current + same phone + credential-linked accounts. */
export async function listWorkspacesForUser(currentUserId: string): Promise<WorkspaceAccount[]> {
  const current = await prisma.user.findUnique({
    where: { id: currentUserId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          subscription: { select: { status: true } },
        },
      },
    },
  });
  if (!current?.isActive) return [];

  const linkedIds = await getLinkedWorkspaceUserIds(
    current.id,
    current.organizationId
  );
  const ten = phoneTenDigits(current.phone);

  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: "PLATFORM_OWNER" },
      OR: [
        { id: currentUserId },
        ...(linkedIds.length ? [{ id: { in: linkedIds } }] : []),
      ],
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          subscription: { select: { status: true } },
        },
      },
    },
  });

  // Phone matches (may include users not yet in candidates)
  let phoneMatches: UserWithOrg[] = [];
  if (ten) {
    const allActive = await prisma.user.findMany({
      where: { isActive: true, role: { not: "PLATFORM_OWNER" } },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            subscription: { select: { status: true } },
          },
        },
      },
    });
    phoneMatches = allActive.filter((u) => phoneTenDigits(u.phone) === ten);
  }

  const byId = new Map<string, { user: UserWithOrg; source: WorkspaceAccount["linkSource"] }>();

  byId.set(current.id, { user: current, source: "self" });

  for (const u of phoneMatches) {
    if (u.id === current.id) continue;
    byId.set(u.id, { user: u, source: "phone" });
  }

  for (const u of candidates) {
    if (u.id === current.id) continue;
    if (byId.has(u.id)) continue;
    byId.set(u.id, { user: u, source: "linked" });
  }

  const rows: WorkspaceAccount[] = [];
  for (const { user, source } of byId.values()) {
    const row = await toWorkspaceRow(user, currentUserId, source);
    if (row) rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.organizationName.localeCompare(b.organizationName);
  });

  return rows;
}

export async function resolveSwitchableUser(
  currentUserId: string,
  targetUserId: string
): Promise<{ user: User; reason?: string } | { user: null; reason: string }> {
  if (targetUserId === currentUserId) {
    return { user: null, reason: "Already on this workspace" };
  }

  const [current, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: currentUserId } }),
    prisma.user.findUnique({ where: { id: targetUserId } }),
  ]);

  if (!current?.isActive) {
    return { user: null, reason: "Unauthorized" };
  }
  if (!target?.isActive) {
    return { user: null, reason: "That account is inactive" };
  }
  if (target.role === "PLATFORM_OWNER") {
    return { user: null, reason: "Cannot switch to that account" };
  }

  const currentTen = phoneTenDigits(current.phone);
  const targetTen = phoneTenDigits(target.phone);
  const samePhone = Boolean(currentTen && targetTen && currentTen === targetTen);

  const linkedIds = await getLinkedWorkspaceUserIds(
    current.id,
    current.organizationId
  );
  const isLinked = linkedIds.includes(target.id);

  if (!samePhone && !isLinked) {
    return { user: null, reason: "That workspace is not linked to your account" };
  }

  const org = await prisma.organization.findUnique({
    where: { id: target.organizationId },
    include: { subscription: { select: { status: true } } },
  });
  if (!org?.isActive) {
    return { user: null, reason: "That workshop is inactive" };
  }
  if (org.subscription?.status === "CANCELLED") {
    return { user: null, reason: "That workshop subscription is suspended" };
  }

  return { user: target };
}
