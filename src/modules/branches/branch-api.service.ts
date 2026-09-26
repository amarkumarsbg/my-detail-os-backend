import type { Branch } from "@prisma/client";
import { SINGLETON_ENTITY_ID, singletonStorageEntityId } from "../../constants/json-collections.js";
import { AppError } from "../../lib/app-error.js";
import { prisma } from "../../lib/prisma.js";
import { assertCanCreateBranch } from "../organization/organization-subscription.service.js";

export type BranchDeletionBlocker = {
  kind:
    | "employees"
    | "job_cards"
    | "expenses"
    | "pickup_drop"
    | "payroll"
    | "salary_advances"
    | "salary_advance_recoveries"
    | "last_branch"
    | "not_found";
  count: number;
  message: string;
};

/** Prefer an existing tenant; required for Branch.create after multi-org schema. */
async function resolveOrganizationIdForBranchCreate(
  preferredOrganizationId?: string | null
): Promise<string> {
  if (preferredOrganizationId) {
    const preferred = await prisma.organization.findUnique({
      where: { id: preferredOrganizationId },
      select: { id: true },
    });
    if (preferred) return preferred.id;
  }

  const fromBranch = await prisma.branch.findFirst({
    select: { organizationId: true },
    orderBy: { id: "asc" },
  });
  if (fromBranch) return fromBranch.organizationId;

  const org = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (org) return org.id;

  throw AppError.validation("No organization exists to attach this branch to.");
}

async function countJsonCollectionBranchRefs(collection: string, branchId: string): Promise<number> {
  const rows = await prisma.appJsonRow.findMany({
    where: { collection },
    select: { payload: true },
  });
  return rows.filter((row) => {
    const payload = row.payload as Record<string, unknown> | null;
    return payload?.branchId === branchId;
  }).length;
}

async function countPayrollBranchRefs(branchId: string): Promise<{
  payrollRecords: number;
  salaryAdvances: number;
  salaryAdvanceRecoveries: number;
}> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  });
  const orgId = branch?.organizationId;
  const row = orgId
    ? await prisma.appJsonRow.findFirst({
        where: {
          collection: "payroll",
          organizationId: orgId,
          OR: [
            { entityId: singletonStorageEntityId(orgId) },
            { entityId: SINGLETON_ENTITY_ID },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: { payload: true },
      })
    : await prisma.appJsonRow.findUnique({
        where: { collection_entityId: { collection: "payroll", entityId: SINGLETON_ENTITY_ID } },
        select: { payload: true },
      });
  if (!row) {
    return {
      payrollRecords: 0,
      salaryAdvances: 0,
      salaryAdvanceRecoveries: 0,
    };
  }
  const payload = row.payload as {
    payrollRecords?: { branchId?: string }[];
    salaryAdvances?: { id?: string; branchId?: string }[];
    salaryAdvanceRecoveries?: { advanceId?: string }[];
  };

  const payrollRecords = (payload.payrollRecords ?? []).filter(
    (r) => r.branchId === branchId
  ).length;

  const branchAdvances = (payload.salaryAdvances ?? []).filter(
    (a) => a.branchId === branchId
  );
  const salaryAdvances = branchAdvances.length;
  const branchAdvanceIds = new Set(branchAdvances.map((a) => a.id).filter(Boolean));

  const salaryAdvanceRecoveries = (payload.salaryAdvanceRecoveries ?? []).filter((r) =>
    r.advanceId ? branchAdvanceIds.has(r.advanceId) : false
  ).length;

  return {
    payrollRecords,
    salaryAdvances,
    salaryAdvanceRecoveries,
  };
}

export async function getBranchDeletionBlockers(branchId: string): Promise<BranchDeletionBlocker[]> {
  const blockers: BranchDeletionBlocker[] = [];

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) {
    return [{ kind: "not_found", count: 0, message: "Site not found." }];
  }

  const totalBranches = await prisma.branch.count();
  if (totalBranches <= 1) {
    blockers.push({
      kind: "last_branch",
      count: 1,
      message: "Cannot delete the only remaining site.",
    });
  }

  const employeeCount = await prisma.user.count({ where: { branchId } });
  if (employeeCount > 0) {
    blockers.push({
      kind: "employees",
      count: employeeCount,
      message: `${employeeCount} employee${employeeCount === 1 ? "" : "s"} assigned to this site`,
    });
  }

  const jobCardCount = await countJsonCollectionBranchRefs("jobCards", branchId);
  if (jobCardCount > 0) {
    blockers.push({
      kind: "job_cards",
      count: jobCardCount,
      message: `${jobCardCount} job card${jobCardCount === 1 ? "" : "s"} linked to this site`,
    });
  }

  const expenseCount = await countJsonCollectionBranchRefs("expenses", branchId);
  if (expenseCount > 0) {
    blockers.push({
      kind: "expenses",
      count: expenseCount,
      message: `${expenseCount} expense${expenseCount === 1 ? "" : "s"} linked to this site`,
    });
  }

  const pickupCount = await countJsonCollectionBranchRefs("pickupDropRequests", branchId);
  if (pickupCount > 0) {
    blockers.push({
      kind: "pickup_drop",
      count: pickupCount,
      message: `${pickupCount} pickup/drop request${pickupCount === 1 ? "" : "s"} linked to this site`,
    });
  }

  const payrollRefs = await countPayrollBranchRefs(branchId);
  if (payrollRefs.payrollRecords > 0) {
    blockers.push({
      kind: "payroll",
      count: payrollRefs.payrollRecords,
      message: `${payrollRefs.payrollRecords} payroll record${payrollRefs.payrollRecords === 1 ? "" : "s"} linked to this site`,
    });
  }

  if (payrollRefs.salaryAdvances > 0) {
    blockers.push({
      kind: "salary_advances",
      count: payrollRefs.salaryAdvances,
      message: `${payrollRefs.salaryAdvances} salary advance${payrollRefs.salaryAdvances === 1 ? "" : "s"} linked to this site`,
    });
  }

  if (payrollRefs.salaryAdvanceRecoveries > 0) {
    blockers.push({
      kind: "salary_advance_recoveries",
      count: payrollRefs.salaryAdvanceRecoveries,
      message: `${payrollRefs.salaryAdvanceRecoveries} salary advance recover${payrollRefs.salaryAdvanceRecoveries === 1 ? "y" : "ies"} linked to this site`,
    });
  }

  return blockers;
}

export async function deleteBranchApi(branchId: string): Promise<boolean> {
  const blockers = await getBranchDeletionBlockers(branchId);
  if (blockers.length > 0) return false;
  await prisma.branch.delete({ where: { id: branchId } });
  return true;
}

export function toApiBranch(b: Branch) {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    phone: b.phone,
    isActive: b.isActive,
    qrCodeId: b.qrCodeId ?? undefined,
    code: b.code ?? undefined,
    city: b.city ?? undefined,
    state: b.state ?? undefined,
    pincode: b.pincode ?? undefined,
    email: b.email ?? undefined,
    managerName: b.managerName ?? undefined,
    managerPhone: b.managerPhone ?? undefined,
  };
}

export async function listBranchesApi(organizationId?: string | null) {
  const rows = await prisma.branch.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { id: "asc" },
  });
  return rows.map(toApiBranch);
}

export async function upsertBranchApi(
  data: {
    id: string;
    name: string;
    address: string;
    phone: string;
    isActive?: boolean;
    qrCodeId?: string | null;
    code?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    email?: string | null;
    managerName?: string | null;
    managerPhone?: string | null;
    /** Creator's org when available; otherwise resolved from existing tenant data. */
    organizationId?: string | null;
  },
  opts?: {
    /** Platform admin create — bypass plan/status gate (limit may be raised separately). */
    skipLimitCheck?: boolean;
  }
) {
  const organizationId = await resolveOrganizationIdForBranchCreate(data.organizationId);
  const existing = await prisma.branch.findUnique({ where: { id: data.id } });
  if (!existing && !opts?.skipLimitCheck) {
    await assertCanCreateBranch(organizationId);
  }

  const row = await prisma.branch.upsert({
    where: { id: data.id },
    create: {
      id: data.id,
      name: data.name,
      address: data.address,
      phone: data.phone,
      isActive: data.isActive ?? true,
      qrCodeId: data.qrCodeId ?? null,
      code: data.code ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      email: data.email ?? null,
      managerName: data.managerName ?? null,
      managerPhone: data.managerPhone ?? null,
      organizationId,
    },
    update: {
      name: data.name,
      address: data.address,
      phone: data.phone,
      isActive: data.isActive ?? true,
      qrCodeId: data.qrCodeId ?? null,
      code: data.code ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      email: data.email ?? null,
      managerName: data.managerName ?? null,
      managerPhone: data.managerPhone ?? null,
    },
  });
  return toApiBranch(row);
}

export async function patchBranchApi(
  id: string,
  patch: Partial<Omit<Branch, "id">>
): Promise<ReturnType<typeof toApiBranch> | null> {
  try {
    const row = await prisma.branch.update({
      where: { id },
      data: patch,
    });
    return toApiBranch(row);
  } catch {
    return null;
  }
}
