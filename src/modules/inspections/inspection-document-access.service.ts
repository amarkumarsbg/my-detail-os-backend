import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { readPrivateInspectionAsset } from "../../services/object-storage.service.js";

function signature(versionId: string, expiresAt: number): string {
  return createHmac("sha256", env.JWT_SECRET).update(`${versionId}:${expiresAt}`).digest("hex");
}

export function signedInspectionDocumentUrl(apiOrigin: string, versionId: string, expiresAt: number): string {
  const token = signature(versionId, expiresAt);
  const url = new URL(`/api/public/inspection-documents/${encodeURIComponent(versionId)}`, apiOrigin);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", token);
  return url.toString();
}

export async function getSignedInspectionDocument(input: {
  versionId: string;
  expiresAt: number;
  signature: string;
}): Promise<Buffer | null> {
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const expected = Buffer.from(signature(input.versionId, input.expiresAt));
  const supplied = Buffer.from(input.signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const version = await prisma.inspectionReportVersion.findFirst({
    where: { id: input.versionId },
    select: { documentKey: true },
  });
  if (!version?.documentKey) return null;
  return readPrivateInspectionAsset(version.documentKey);
}