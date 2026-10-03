import type { PlanCode } from "./plan-catalog.js";
import type { PlanLimits } from "./plan-catalog.js";
import type { ResolvedPlatformReferral } from "./platform-referral.js";
import { REFERRAL_CODE_REGEX } from "./platform-referral.js";

export type SubscriptionPricingInput = {
  termMonths: number;
  extraBranches: number;
  extraUsers: number;
  referralCode?: string | null;
};

export type SubscriptionPricingBreakdown = {
  planCode: PlanCode;
  planName: string;
  termMonths: number;
  termLabel: string;
  extraBranches: number;
  extraUsers: number;
  baseAmount: number;
  extraBranchCost: number;
  extraUserCost: number;
  onboardingFee: number;
  onboardingApplied: boolean;
  referralCode: string | null;
  referralDiscount: number;
  referralApplied: boolean;
  referralEligible: boolean;
  referralValidationMessage: string | null;
  referrerOrganizationId: string | null;
  /** Available wallet points at quote time (1 point = ₹1). */
  walletPointsAvailable: number;
  /** Points applied to this quote (reduces taxable before GST). */
  walletPointsApplied: number;
  /** INR discount from wallet points. */
  walletPointsDiscount: number;
  gstPercent: number;
  gstAmount: number;
  subTotalBeforeTax: number;
  finalAmount: number;
  includedBranches: number | null;
  includedUsers: number | null;
  finalAllowedBranches: number | null;
  finalAllowedUsers: number | null;
  currency: string;
  isFirstSubscription: boolean;
};

export type SubscriptionPricingConfig = {
  source: "environment" | "platform_settings";
  currency: string;
  termBasePrices: { 1: number; 3: number; 12: number; 24: number; 36: number; 60: number };
  planMultipliers: Record<PlanCode, number>;
  addOns: {
    extraBranchPrice: number;
    extraUserPrice: number;
    onboardingFee: number;
    referralDiscount: number;
  };
  gstPercent: number;
  /** Fields that admin can edit via PlatformSettings / PUT plans */
  editableViaPlatformPlansApi: readonly string[];
  envKeys: readonly string[];
};

const TERM_LABELS: Record<number, string> = {
  1: "1 month",
  3: "3 months",
  12: "1 year",
  24: "2 years",
  36: "3 years",
  60: "5 years",
};

const ENV_KEYS = [
  "SUBSCRIPTION_BASE_PRICE_1",
  "SUBSCRIPTION_BASE_PRICE_3",
  "SUBSCRIPTION_BASE_PRICE_12",
  "SUBSCRIPTION_BASE_PRICE_24",
  "SUBSCRIPTION_BASE_PRICE_36",
  "SUBSCRIPTION_BASE_PRICE_60",
  "SUBSCRIPTION_PRICE_MULTIPLIER_STARTER",
  "SUBSCRIPTION_PRICE_MULTIPLIER_GROWTH",
  "SUBSCRIPTION_PRICE_MULTIPLIER_BUSINESS",
  "SUBSCRIPTION_PRICE_MULTIPLIER_ENTERPRISE",
  "SUBSCRIPTION_PRICE_MULTIPLIER_CUSTOM",
  "SUBSCRIPTION_EXTRA_BRANCH_PRICE",
  "SUBSCRIPTION_EXTRA_USER_PRICE",
  "SUBSCRIPTION_ONBOARDING_FEE",
  "SUBSCRIPTION_REFERRAL_DISCOUNT",
  "SUBSCRIPTION_GST_PERCENT",
  "SUBSCRIPTION_CURRENCY",
] as const;

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function envNumber(key: string, fallback: number): number {
  return safeNumber(Number(process.env[key] ?? fallback), fallback);
}

/** Env defaults — always the fallback layer. */
export function getSubscriptionPricingConfigFromEnv(): SubscriptionPricingConfig {
  return {
    source: "environment",
    currency: process.env.SUBSCRIPTION_CURRENCY?.trim() || "INR",
    termBasePrices: {
      1: envNumber("SUBSCRIPTION_BASE_PRICE_1", 999),
      3: envNumber("SUBSCRIPTION_BASE_PRICE_3", 2499),
      12: envNumber("SUBSCRIPTION_BASE_PRICE_12", 9999),
      24: envNumber("SUBSCRIPTION_BASE_PRICE_24", 18999),
      36: envNumber("SUBSCRIPTION_BASE_PRICE_36", 26999),
      60: envNumber("SUBSCRIPTION_BASE_PRICE_60", 41999),
    },
    planMultipliers: {
      STARTER: envNumber("SUBSCRIPTION_PRICE_MULTIPLIER_STARTER", 1),
      GROWTH: envNumber("SUBSCRIPTION_PRICE_MULTIPLIER_GROWTH", 1.8),
      BUSINESS: envNumber("SUBSCRIPTION_PRICE_MULTIPLIER_BUSINESS", 3),
      ENTERPRISE: envNumber("SUBSCRIPTION_PRICE_MULTIPLIER_ENTERPRISE", 5),
      CUSTOM: envNumber("SUBSCRIPTION_PRICE_MULTIPLIER_CUSTOM", 1),
    },
    addOns: {
      extraBranchPrice: envNumber("SUBSCRIPTION_EXTRA_BRANCH_PRICE", 2500),
      extraUserPrice: envNumber("SUBSCRIPTION_EXTRA_USER_PRICE", 750),
      onboardingFee: envNumber("SUBSCRIPTION_ONBOARDING_FEE", 1500),
      referralDiscount: envNumber("SUBSCRIPTION_REFERRAL_DISCOUNT", 1000),
    },
    gstPercent: envNumber("SUBSCRIPTION_GST_PERCENT", 18),
    editableViaPlatformPlansApi: [
      "planName",
      "limits",
      "allowedTerms",
      "termBasePrices",
      "planMultipliers",
      "addOns",
      "gstPercent",
      "currency",
      "publicVisible",
    ] as const,
    envKeys: ENV_KEYS,
  };
}

export type SubscriptionPricingPatch = {
  currency?: string;
  termBasePrices?: Partial<{ 1: number; 3: number; 12: number; 24: number; 36: number; 60: number }>;
  planMultipliers?: Partial<Record<PlanCode, number>>;
  addOns?: Partial<{
    extraBranchPrice: number;
    extraUserPrice: number;
    onboardingFee: number;
    referralDiscount: number;
  }>;
  gstPercent?: number;
};

export function mergeSubscriptionPricingConfig(
  base: SubscriptionPricingConfig,
  patch: SubscriptionPricingPatch | null | undefined,
  source: "environment" | "platform_settings" = patch ? "platform_settings" : base.source
): SubscriptionPricingConfig {
  if (!patch) return { ...base, source: base.source };
  return {
    ...base,
    source,
    currency: typeof patch.currency === "string" && patch.currency.trim() ? patch.currency.trim() : base.currency,
    termBasePrices: {
      1: safeNumber(patch.termBasePrices?.[1] ?? base.termBasePrices[1], base.termBasePrices[1]),
      3: safeNumber(patch.termBasePrices?.[3] ?? base.termBasePrices[3], base.termBasePrices[3]),
      12: safeNumber(patch.termBasePrices?.[12] ?? base.termBasePrices[12], base.termBasePrices[12]),
      24: safeNumber(patch.termBasePrices?.[24] ?? base.termBasePrices[24], base.termBasePrices[24]),
      36: safeNumber(patch.termBasePrices?.[36] ?? base.termBasePrices[36], base.termBasePrices[36]),
      60: safeNumber(patch.termBasePrices?.[60] ?? base.termBasePrices[60], base.termBasePrices[60]),
    },
    planMultipliers: (() => {
      const merged: Record<string, number> = { ...base.planMultipliers };
      for (const [code, value] of Object.entries(patch.planMultipliers ?? {})) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          merged[code] = value;
        }
      }
      return merged;
    })(),
    addOns: {
      extraBranchPrice: safeNumber(patch.addOns?.extraBranchPrice ?? base.addOns.extraBranchPrice, 0),
      extraUserPrice: safeNumber(patch.addOns?.extraUserPrice ?? base.addOns.extraUserPrice, 0),
      onboardingFee: safeNumber(patch.addOns?.onboardingFee ?? base.addOns.onboardingFee, 0),
      referralDiscount: safeNumber(patch.addOns?.referralDiscount ?? base.addOns.referralDiscount, 0),
    },
    gstPercent: safeNumber(patch.gstPercent ?? base.gstPercent, 0),
  };
}

function clampNonNegativeInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function validateReferralCode(raw: string | null | undefined): {
  code: string | null;
  message: string | null;
} {
  const code = raw?.trim().toUpperCase() ?? "";
  if (!code) return { code: null, message: null };
  if (!REFERRAL_CODE_REGEX.test(code)) {
    return { code: null, message: "Invalid referral code format." };
  }
  return { code, message: null };
}

function addCapacity(base: number | null | undefined, extra: number): number | null {
  if (base === null) return null;
  const normalized = typeof base === "number" && Number.isFinite(base) ? Math.max(0, Math.floor(base)) : 0;
  return normalized + extra;
}

/** Mid-cycle capacity purchase (no plan base / term / onboarding). */
export type SubscriptionAddOnBreakdown = {
  kind: "ADDON";
  planCode: PlanCode;
  planName: string;
  extraBranches: number;
  extraUsers: number;
  extraBranchCost: number;
  extraUserCost: number;
  walletPointsAvailable: number;
  walletPointsApplied: number;
  walletPointsDiscount: number;
  gstPercent: number;
  gstAmount: number;
  subTotalBeforeTax: number;
  finalAmount: number;
  previousAllowedBranches: number | null;
  previousAllowedUsers: number | null;
  finalAllowedBranches: number | null;
  finalAllowedUsers: number | null;
  currency: string;
  expiresAt: string | null;
};

/** 1 wallet point = ₹1 toward renew / upgrade / add-on taxable amount (before GST). */
export function resolveWalletPointsRedeem(opts: {
  availablePoints: number;
  taxableBeforeWallet: number;
  useWalletPoints?: boolean;
  /** Cap applied points; ignored when useWalletPoints is false. */
  walletPoints?: number | null;
}): { walletPointsAvailable: number; walletPointsApplied: number; walletPointsDiscount: number } {
  const available = Math.max(0, Math.floor(opts.availablePoints || 0));
  const taxable = Math.max(0, round2(opts.taxableBeforeWallet));
  if (!opts.useWalletPoints || available <= 0 || taxable <= 0) {
    return { walletPointsAvailable: available, walletPointsApplied: 0, walletPointsDiscount: 0 };
  }
  const requested =
    opts.walletPoints == null || !Number.isFinite(opts.walletPoints)
      ? available
      : Math.max(0, Math.floor(opts.walletPoints));
  const applied = Math.min(available, requested, Math.floor(taxable));
  return {
    walletPointsAvailable: available,
    walletPointsApplied: applied,
    walletPointsDiscount: round2(applied),
  };
}

export function calculateAddOnPricing(input: {
  planCode: PlanCode;
  planName: string;
  currentAllowedBranches: number | null;
  currentAllowedUsers: number | null;
  extraBranches: number;
  extraUsers: number;
  expiresAt: Date | null;
  pricing?: SubscriptionPricingConfig;
  walletPointsAvailable?: number;
  useWalletPoints?: boolean;
  walletPoints?: number | null;
}): SubscriptionAddOnBreakdown {
  const cfg = input.pricing ?? getSubscriptionPricingConfigFromEnv();
  const extraBranches = clampNonNegativeInt(input.extraBranches);
  const extraUsers = clampNonNegativeInt(input.extraUsers);
  if (extraBranches <= 0 && extraUsers <= 0) {
    throw new Error("Add at least one extra branch or user.");
  }
  if (input.currentAllowedBranches === null && extraBranches > 0) {
    throw new Error("This plan already has unlimited branches.");
  }
  if (input.currentAllowedUsers === null && extraUsers > 0) {
    throw new Error("This plan already has unlimited users.");
  }

  const extraBranchCost = round2(extraBranches * safeNumber(cfg.addOns.extraBranchPrice, 0));
  const extraUserCost = round2(extraUsers * safeNumber(cfg.addOns.extraUserPrice, 0));
  const preWallet = round2(extraBranchCost + extraUserCost);
  const wallet = resolveWalletPointsRedeem({
    availablePoints: input.walletPointsAvailable ?? 0,
    taxableBeforeWallet: preWallet,
    useWalletPoints: input.useWalletPoints,
    walletPoints: input.walletPoints,
  });
  const taxable = Math.max(0, round2(preWallet - wallet.walletPointsDiscount));
  const gstPercent = safeNumber(cfg.gstPercent, 0);
  const gstAmount = round2((taxable * gstPercent) / 100);
  const finalAmount = round2(taxable + gstAmount);

  return {
    kind: "ADDON",
    planCode: input.planCode,
    planName: input.planName,
    extraBranches,
    extraUsers,
    extraBranchCost,
    extraUserCost,
    walletPointsAvailable: wallet.walletPointsAvailable,
    walletPointsApplied: wallet.walletPointsApplied,
    walletPointsDiscount: wallet.walletPointsDiscount,
    gstPercent,
    gstAmount,
    subTotalBeforeTax: taxable,
    finalAmount,
    previousAllowedBranches: input.currentAllowedBranches,
    previousAllowedUsers: input.currentAllowedUsers,
    finalAllowedBranches: addCapacity(input.currentAllowedBranches, extraBranches),
    finalAllowedUsers: addCapacity(input.currentAllowedUsers, extraUsers),
    currency: cfg.currency,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
  };
}

export function calculateSubscriptionPricing(input: {
  planCode: PlanCode;
  planName: string;
  limits: PlanLimits;
  isFirstSubscription: boolean;
  payload: SubscriptionPricingInput;
  pricing?: SubscriptionPricingConfig;
  resolvedReferral?: ResolvedPlatformReferral | null;
  walletPointsAvailable?: number;
  useWalletPoints?: boolean;
  walletPoints?: number | null;
}): SubscriptionPricingBreakdown {
  const cfg = input.pricing ?? getSubscriptionPricingConfigFromEnv();
  const termMonths = input.payload.termMonths;
  const termLabel = TERM_LABELS[termMonths] ?? `${termMonths} months`;
  const extraBranches = clampNonNegativeInt(input.payload.extraBranches);
  const extraUsers = clampNonNegativeInt(input.payload.extraUsers);
  const resolved = input.resolvedReferral;
  const { code: referralCode, message: referralValidationMessage } = resolved
    ? { code: resolved.code, message: resolved.message }
    : validateReferralCode(input.payload.referralCode);
  if (![1, 3, 12, 24, 36, 60].includes(termMonths)) {
    throw new Error("Unsupported term. Allowed: 1, 3, 12, 24, 36, 60 months.");
  }

  const baseTerm = safeNumber(
    (cfg.termBasePrices as Record<number, number>)[termMonths] ?? cfg.termBasePrices[12],
    cfg.termBasePrices[12]
  );
  const multiplier = safeNumber(cfg.planMultipliers[input.planCode], 1);
  const baseAmount = round2(baseTerm * multiplier);
  const extraBranchCost = round2(extraBranches * safeNumber(cfg.addOns.extraBranchPrice, 0));
  const extraUserCost = round2(extraUsers * safeNumber(cfg.addOns.extraUserPrice, 0));
  const onboardingApplied = input.isFirstSubscription;
  const onboardingFee = onboardingApplied ? round2(safeNumber(cfg.addOns.onboardingFee, 0)) : 0;

  const referralEligible =
    input.isFirstSubscription && Boolean(referralCode) && !referralValidationMessage;
  const referralApplied = referralEligible;
  const discountSource =
    resolved && !resolved.message && resolved.discountAmount > 0
      ? resolved.discountAmount
      : cfg.addOns.referralDiscount;
  const referralDiscount = referralApplied ? round2(safeNumber(discountSource, 0)) : 0;

  const preWallet = round2(
    baseAmount + extraBranchCost + extraUserCost + onboardingFee - referralDiscount
  );
  const wallet = resolveWalletPointsRedeem({
    availablePoints: input.walletPointsAvailable ?? 0,
    taxableBeforeWallet: Math.max(0, preWallet),
    useWalletPoints: input.useWalletPoints,
    walletPoints: input.walletPoints,
  });
  const taxable = Math.max(0, round2(Math.max(0, preWallet) - wallet.walletPointsDiscount));
  const gstPercent = safeNumber(cfg.gstPercent, 0);
  const gstAmount = round2((taxable * gstPercent) / 100);
  const finalAmount = round2(taxable + gstAmount);

  const includedBranches = input.limits.maxBranches ?? null;
  const includedUsers = input.limits.maxStaff ?? null;

  return {
    planCode: input.planCode,
    planName: input.planName,
    termMonths,
    termLabel,
    extraBranches,
    extraUsers,
    baseAmount,
    extraBranchCost,
    extraUserCost,
    onboardingFee,
    onboardingApplied,
    referralCode,
    referralDiscount,
    referralApplied,
    referralEligible,
    referralValidationMessage,
    referrerOrganizationId: referralApplied ? (resolved?.referrerOrganizationId ?? null) : null,
    walletPointsAvailable: wallet.walletPointsAvailable,
    walletPointsApplied: wallet.walletPointsApplied,
    walletPointsDiscount: wallet.walletPointsDiscount,
    gstPercent,
    gstAmount,
    subTotalBeforeTax: taxable,
    finalAmount,
    includedBranches,
    includedUsers,
    finalAllowedBranches: addCapacity(includedBranches, extraBranches),
    finalAllowedUsers: addCapacity(includedUsers, extraUsers),
    currency: cfg.currency,
    isFirstSubscription: input.isFirstSubscription,
  };
}
