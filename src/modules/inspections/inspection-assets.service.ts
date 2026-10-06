import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import type { BranchScope } from "../../lib/data-scope.js";
import { persistPrivateInspectionAsset } from "../../services/object-storage.service.js";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type SanitizedImage = { buffer: Buffer; mimeType: string; extension: string };

export async function sanitizeInspectionImage(buffer: Buffer, declaredMime: string): Promise<SanitizedImage> {
  const expectedMime: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  try {
    const image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    const mimeType = metadata.format ? expectedMime[metadata.format] : undefined;
    if (!mimeType || declaredMime.toLowerCase() !== mimeType) throw new Error("MIME mismatch");
    const cleaned = await image.rotate().toFormat(metadata.format as "jpeg" | "png" | "webp").toBuffer();
    return { buffer: cleaned, mimeType, extension: EXTENSIONS[mimeType]! };
  } catch {
    throw AppError.validation("Photo contents must be a valid JPEG, PNG, or WebP matching the file type.");
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

export async function uploadInspectionPhoto(input: {
  scope: BranchScope;
  actorId: string;
  branchId: string;
  buffer: Buffer;
  declaredMime: string;
}) {
  if (!input.buffer?.length) throw AppError.validation("Choose a photo to upload.");
  if (input.buffer.length > MAX_PHOTO_BYTES) throw AppError.validation("Photo must be 10 MB or smaller.");
  const image = await sanitizeInspectionImage(input.buffer, input.declaredMime);
  const branch = await prisma.branch.findFirst({
    where: {
      id: input.scope.allowedBranchIds === null
        ? input.branchId
        : { equals: input.branchId, in: input.scope.allowedBranchIds },
      organizationId: input.scope.organizationId,
    },
    select: { id: true },
  });
  if (!branch) throw AppError.forbidden("You do not have access to this branch.");

  const id = randomUUID();
  const objectKey = `inspection-assets/${safePathSegment(input.scope.organizationId)}/${safePathSegment(branch.id)}/${id}.${image.extension}`;
  const upload = await prisma.inspectionUpload.create({
    data: {
      id,
      organizationId: input.scope.organizationId,
      branchId: branch.id,
      objectKey,
      mimeType: image.mimeType,
      byteSize: image.buffer.length,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: input.actorId,
    },
  });
  try {
    await persistPrivateInspectionAsset({ objectKey, buffer: image.buffer, mimeType: image.mimeType });
  } catch (error) {
    await prisma.inspectionUpload.delete({ where: { id } });
    throw error;
  }
  return { id: upload.id, url: `/api/inspections/assets/${upload.id}` };
}