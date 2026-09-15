/**
 * Platform control-plane settings singleton (PlatformSettings id=default).
 * Merges DB payload with env fallbacks; plan overrides layer on PLAN_CATALOG.
 */

import type { PlanCode, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import {
  PLAN_CATALOG,
  parsePlanLimits,
  type PlanLimits,
  type PlanTemplate,
} from "./plan-catalog.js";

export const PLATFORM_SETTINGS_ID = "default";

export type PlanOverride = {
  planName?: string;
  limits?: PlanLimits;
};

export type PlatformSettingsPayload = {
  trialDaysDefault?: number;
  defaultTermMonths?: number;
  defaultGstPercent?: number;
  defaultContactUsUrl?: string | null;
  defaultContactPhone?: string | null;
  defaultUpgradeUrl?: string | null;
  planOverrides?: Partial<Record<PlanCode, PlanOverride>>;
};

const PLAN_CODES = Object.keys(PLAN_CATALOG) as PlanCode[];

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function parsePlatformSettingsPayload(raw: unknown): PlatformSettingsPayload {
  const obj = asRecord(raw);
  const planOverridesRaw = asRecord(obj.planOverrides);
  const planOverrides: Partial<Record<PlanCode, PlanOverride>> = {};
  for (const code of PLAN_CODES) {
    const entry = asRecord(planOverridesRaw[code]);
    if (Object.keys(entry).length === 0) continue;
    const override: PlanOverride = {};
    if (typeof entry.planName === "string" && entry.planName.trim()) {
      override.planName = entry.planName.trim();
    }
    if (entry.limits !== undefined) {
      override.limits = parsePlanLimits(entry.limits);
    }
    if (override.planName !== undefined || override.limits !== undefined) {
      planOverrides[code] = override;
    }
  }

  const trialDaysDefault =
    typeof obj.trialDaysDefault === "number" && Number.isFinite(obj.trialDaysDefault)
      ? Math.min(90, Math.max(1, Math.floor(obj.trialDaysDefault)))
      : undefined;
  const defaultTermMonths =
    typeof obj.defaultTermMonths === "number" && [12, 24, 36, 60].includes(obj.defaultTermMonths)
      ? obj.defaultTermMonths
      : undefined;
  const defaultGstPercent =
    typeof obj.defaultGstPercent === "number" && Number.isFinite(obj.defaultGstPercent)
      ? Math.max(0, obj.defaultGstPercent)
      : undefined;

  return {
    trialDaysDefault,
    defaultTermMonths,
    defaultGstPercent,
    defaultContactUsUrl:
      obj.defaultContactUsUrl === null
        ? null
        : typeof obj.defaultContactUsUrl === "string"
          ? obj.defaultContactUsUrl
          : undefined,
    defaultContactPhone:
      obj.defaultContactPhone === null
        ? null
        : typeof obj.defaultContactPhone === "string"
          ? obj.defaultContactPhone
          : undefined,
    defaultUpgradeUrl:
      obj.defaultUpgradeUrl === null
        ? null
        : typeof obj.defaultUpgradeUrl === "string"
          ? obj.defaultUpgradeUrl
          : undefined,
    planOverrides: Object.keys(planOverrides).length ? planOverrides : undefined,
  };
}

export type ResolvedPlatformSettings = {
  trialDaysDefault: number;
  defaultTermMonths: number;
  defaultGstPercent: number;
  defaultContactUsUrl: string | null;
  defaultContactPhone: string | null;
  defaultUpgradeUrl: string | null;
  planOverrides: Partial<Record<PlanCode, PlanOverride>>;
  updatedAt: string | null;
  updatedBy: string | null;
};

function envContactPhone(): string | null {
  const v = process.env.DEFAULT_CONTACT_PHONE?.trim();
  return v || null;
}

export function resolvePlatformSettings(
  payload: PlatformSettingsPayload,
  meta?: { updatedAt?: Date | null; updatedBy?: string | null }
): ResolvedPlatformSettings {
  return {
    trialDaysDefault: payload.trialDaysDefault ?? 14,
    defaultTermMonths: payload.defaultTermMonths ?? 12,
    defaultGstPercent: payload.defaultGstPercent ?? 18,
    defaultContactUsUrl:
      payload.defaultContactUsUrl !== undefined
        ? payload.defaultContactUsUrl
        : env.DEFAULT_CONTACT_US_URL ?? null,
    defaultContactPhone:
      payload.defaultContactPhone !== undefined
        ? payload.defaultContactPhone
        : envContactPhone(),
    defaultUpgradeUrl:
      payload.defaultUpgradeUrl !== undefined
        ? payload.defaultUpgradeUrl
        : env.DEFAULT_UPGRADE_URL ?? null,
    planOverrides: payload.planOverrides ?? {},
    updatedAt: meta?.updatedAt?.toISOString() ?? null,
    updatedBy: meta?.updatedBy ?? null,
  };
}

export async function getPlatformSettings(): Promise<ResolvedPlatformSettings> {
  const row = await prisma.platformSettings.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
  });
  const payload = parsePlatformSettingsPayload(row?.payload ?? {});
  return resolvePlatformSettings(payload, {
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  });
}

export async function updatePlatformSettings(input: {
  patch: PlatformSettingsPayload;
  updatedBy: string;
}): Promise<ResolvedPlatformSettings> {
  const current = await prisma.platformSettings.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
  });
  const currentPayload = parsePlatformSettingsPayload(current?.payload ?? {});
  const next: PlatformSettingsPayload = {
    ...currentPayload,
    ...input.patch,
  };
  if (input.patch.planOverrides) {
    next.planOverrides = {
      ...(currentPayload.planOverrides ?? {}),
      ...input.patch.planOverrides,
    };
  }

  const row = await prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    create: {
      id: PLATFORM_SETTINGS_ID,
      payload: next as Prisma.InputJsonValue,
      updatedBy: input.updatedBy,
    },
    update: {
      payload: next as Prisma.InputJsonValue,
      updatedBy: input.updatedBy,
    },
  });

  return resolvePlatformSettings(parsePlatformSettingsPayload(row.payload), {
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  });
}

export function getEffectivePlanCatalog(
  planOverrides: Partial<Record<PlanCode, PlanOverride>> = {}
): PlanTemplate[] {
  return PLAN_CODES.map((code) => {
    const base = PLAN_CATALOG[code];
    const override = planOverrides[code];
    return {
      planCode: code,
      planName: override?.planName?.trim() || base.planName,
      limits: override?.limits
        ? { ...base.limits, ...override.limits }
        : { ...base.limits },
    };
  });
}

export async function getEffectivePlanCatalogFromDb(): Promise<PlanTemplate[]> {
  const settings = await getPlatformSettings();
  return getEffectivePlanCatalog(settings.planOverrides);
}
