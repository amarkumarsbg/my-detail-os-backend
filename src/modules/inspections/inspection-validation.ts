import { z } from "zod";
import { AppError } from "../../lib/app-error.js";

const RATING_VALUES = new Set([
  "GOOD",
  "AVERAGE",
  "BAD",
  "N/A",
  "NA",
  "NOT_APPLICABLE",
  "NOT_CHECKED",
]);
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_SECTIONS = 40;
const MAX_CHECKPOINTS = 500;
const MAX_STRING_LENGTH = 4000;

export const inspectionConditionSchema = z.object({
  overallPreDriveCondition: z.enum(["GOOD", "FAIR", "POOR"]).nullable().optional(),
  vehicleConditions: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    number: z.number().int().positive(),
    type: z.enum(["SCRATCH", "DENT", "CRACK", "PAINT_CHIP", "OTHER"]),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    area: z.string().trim().min(1).max(200),
    notes: z.string().max(4000).optional(),
  })).max(200).superRefine((pins, context) => {
    if (new Set(pins.map((pin) => pin.id)).size !== pins.length ||
        new Set(pins.map((pin) => pin.number)).size !== pins.length) {
      context.addIssue({ code: "custom", message: "Vehicle condition IDs and display numbers must be unique." });
    }
  }).optional(),
});

export function normalizeInspectionConditions(payload: Record<string, unknown>) {
  const condition = inspectionConditionSchema.parse(payload);
  return {
    overallPreDriveCondition: condition.overallPreDriveCondition ?? null,
    vehicleConditions: condition.vehicleConditions ?? [],
  };
}

export const inspectionDraftSchema = z.object({
  branchId: z.string().trim().min(1).max(120).optional(),
  customerId: z.string().trim().min(1).max(120),
  vehicleId: z.string().trim().min(1).max(120),
  sections: z.array(z.unknown()).max(MAX_SECTIONS),
}).extend(inspectionConditionSchema.shape).passthrough();

export const inspectionTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sections: z.array(z.unknown()).min(1).max(MAX_SECTIONS),
  terms: z.union([z.string().max(12000), z.array(z.string().max(2000)).max(100)]),
});

export function validateInspectionPayload(payload: Record<string, unknown>): void {
  inspectionConditionSchema.parse(payload);
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES) {
    throw AppError.validation("Inspection report exceeds the 1 MB limit.");
  }

  let checkpointCount = 0;
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.length > MAX_STRING_LENGTH) {
        throw AppError.validation("Inspection text fields must be 4,000 characters or fewer.");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (["rating", "conditionRating", "severity", "overallRatingOverride"].includes(key) && typeof child === "string") {
        if (!RATING_VALUES.has(child.trim().toUpperCase())) {
          throw AppError.validation(`Invalid inspection rating: ${child}`);
        }
      }
      if (/odometer/i.test(key) && child !== null && child !== undefined &&
        (typeof child !== "number" || !Number.isInteger(child) || child < 0)) {
        throw AppError.validation("Odometer readings must be non-negative whole numbers.");
      }
      if (["checkpoints", "items"].includes(key) && Array.isArray(child)) {
        checkpointCount += child.length;
        if (checkpointCount > MAX_CHECKPOINTS) {
          throw AppError.validation(`Inspection reports may contain at most ${MAX_CHECKPOINTS} checkpoints.`);
        }
      }
      visit(child);
    }
  };

  visit(payload);
}

function ratingForCheckpoint(checkpoint: unknown): string | null {
  if (!checkpoint || typeof checkpoint !== "object") return null;
  const record = checkpoint as Record<string, unknown>;
  for (const key of ["rating", "conditionRating", "severity", "status", "result"]) {
    const value = record[key];
    if (typeof value === "string" && RATING_VALUES.has(value.trim().toUpperCase())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

export function assertInspectionComplete(payload: Record<string, unknown>): void {
  const sections = payload.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw AppError.validation("Add at least one inspection section before finalizing.");
  }

  for (const section of sections) {
    if (!section || typeof section !== "object") {
      throw AppError.validation("Inspection sections must contain checkpoints.");
    }
    const record = section as Record<string, unknown>;
    const checkpoints = Array.isArray(record.checkpoints)
      ? record.checkpoints
      : Array.isArray(record.items)
        ? record.items
        : [];
    if (checkpoints.length === 0) {
      throw AppError.validation("Empty inspection sections cannot be finalized.");
    }
    for (const checkpoint of checkpoints) {
      const rating = ratingForCheckpoint(checkpoint);
      if (!rating || rating === "NOT_CHECKED") {
        throw AppError.validation("Complete every inspection checkpoint before finalizing.");
      }
    }
  }

  if (payload.overallRatingOverride && !String(payload.overrideReason ?? "").trim()) {
    throw AppError.validation("An overall rating override requires a reason.");
  }
}

function checkpointRatings(section: Record<string, unknown>): string[] {
  const checkpoints = Array.isArray(section.checkpoints)
    ? section.checkpoints
    : Array.isArray(section.items)
      ? section.items
      : [];
  return checkpoints.map(ratingForCheckpoint).filter((rating): rating is string => Boolean(rating));
}

function worstRating(ratings: string[]): string {
  const applicable = ratings.filter((rating) => !["N/A", "NA", "NOT_APPLICABLE"].includes(rating));
  if (applicable.length === 0) return "N/A";
  if (applicable.includes("BAD")) return "BAD";
  if (applicable.includes("AVERAGE")) return "AVERAGE";
  return "GOOD";
}

export function snapshotInspectionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const snapshot = structuredClone(payload);
  const sections = snapshot.sections as unknown[];
  const ratedSections = sections.map((value) => {
    const section = value as Record<string, unknown>;
    return { ...section, computedRating: worstRating(checkpointRatings(section)) };
  });
  const computedOverallRating = payload.overallRatingOverride
    ? String(payload.overallRatingOverride).trim().toUpperCase()
    : worstRating(
    ratedSections.map((section) => String(section.computedRating))
    );
  return { ...snapshot, ...normalizeInspectionConditions(snapshot), sections: ratedSections, computedOverallRating };
}