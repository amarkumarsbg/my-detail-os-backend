import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { avatarExtensionForMime } from "../lib/avatar-mimes.js";

function isS3SigningOrAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const code = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  return (
    msg.includes("The request signature we calculated does not match") ||
    msg.includes("SignatureDoesNotMatch") ||
    msg.includes("InvalidAccessKeyId") ||
    msg.includes("AuthorizationHeaderMalformed") ||
    code === "SignatureDoesNotMatch" ||
    code === "InvalidAccessKeyId" ||
    code === "AuthorizationHeaderMalformed"
  );
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    env.S3_BUCKET &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY &&
      env.S3_PUBLIC_BASE_URL
  );
}

function createS3Client(): S3Client {
  const region = env.S3_REGION ?? (env.S3_ENDPOINT ? "auto" : "us-east-1");
  return new S3Client({
    region,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
    ...(env.S3_ENDPOINT
      ? {
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
        }
      : {}),
  });
}

function privateInspectionStorageConfigured(): boolean {
  return Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

async function putPrivateInspectionObject(objectKey: string, buffer: Buffer, contentType: string): Promise<void> {
  const client = createS3Client();
  await client.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET!,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "private, no-store",
  }));
}

/** Private tenant-owned inspection asset. The returned key is never a public URL. */
export async function persistPrivateInspectionAsset(opts: {
  objectKey: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<void> {
  if (privateInspectionStorageConfigured()) {
    await putPrivateInspectionObject(opts.objectKey, opts.buffer, opts.mimeType);
    return;
  }
  const diskPath = path.join(process.cwd(), "private_uploads", ...opts.objectKey.split("/"));
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, opts.buffer, { flag: "wx" });
}

export async function readPrivateInspectionAsset(objectKey: string): Promise<Buffer | null> {
  if (privateInspectionStorageConfigured()) {
    const result = await createS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: objectKey }));
    if (!result.Body) return null;
    return Buffer.from(await result.Body.transformToByteArray());
  }
  try {
    return await fs.readFile(path.join(process.cwd(), "private_uploads", ...objectKey.split("/")));
  } catch {
    return null;
  }
}

export async function deletePrivateInspectionAsset(objectKey: string): Promise<void> {
  if (privateInspectionStorageConfigured()) {
    await createS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: objectKey }));
    return;
  }
  await fs.rm(path.join(process.cwd(), "private_uploads", ...objectKey.split("/")), { force: true });
}

async function putPublicObject(objectKey: string, buffer: Buffer, contentType: string): Promise<string> {
  const client = createS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    })
  );
  const base = env.S3_PUBLIC_BASE_URL!.replace(/\/+$/, "");
  return `${base}/${objectKey}`;
}

async function writeLocalUpload(relativeSegments: string[], filename: string, buffer: Buffer): Promise<string> {
  const diskDir = path.join(process.cwd(), "uploads", ...relativeSegments);
  await fs.mkdir(diskDir, { recursive: true });
  await fs.writeFile(path.join(diskDir, filename), buffer);
  const urlPath = `/uploads/${[...relativeSegments, filename].join("/")}`;
  return urlPath;
}

/**
 * Profile avatar — stored under `avatars/` (cloud or local).
 */
export async function persistAvatarFile(opts: {
  buffer: Buffer;
  mimeType: string;
  userId: string;
}): Promise<string> {
  const ext = avatarExtensionForMime(opts.mimeType);
  const filename = `${opts.userId}-${Date.now()}${ext}`;
  const key = `avatars/${filename}`;
  if (isObjectStorageConfigured()) {
    try {
      return await putPublicObject(key, opts.buffer, opts.mimeType);
    } catch (err) {
      if (!isS3SigningOrAuthError(err)) throw err;
    }
  }
  return writeLocalUpload(["avatars"], filename, opts.buffer);
}

/**
 * Job-card inspection photo — `job-cards/{id}/before|after/`.
 */
export async function persistJobInspectionPhoto(opts: {
  jobCardId: string;
  kind: "before" | "after";
  /** Stable client-generated id (for filenames). */
  photoId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const ext = avatarExtensionForMime(opts.mimeType);
  const safeJobId = opts.jobCardId.replace(/[^\w-]/g, "_").slice(0, 120);
  const filename = `${opts.photoId}-${Date.now()}${ext}`;
  const folder = opts.kind === "before" ? "before" : "after";
  const segments = ["job-cards", safeJobId, folder];
  const objectKey = `${segments.join("/")}/${filename}`;
  if (isObjectStorageConfigured()) {
    try {
      return await putPublicObject(objectKey, opts.buffer, opts.mimeType);
    } catch (err) {
      if (!isS3SigningOrAuthError(err)) throw err;
    }
  }
  return writeLocalUpload(segments, filename, opts.buffer);
}

/**
 * Business/company logo for app branding.
 */
export async function persistBusinessLogoFile(opts: {
  buffer: Buffer;
  mimeType: string;
  uploadedBy: string;
}): Promise<string> {
  const ext = avatarExtensionForMime(opts.mimeType);
  const safeBy = opts.uploadedBy.replace(/[^\w-]/g, "_").slice(0, 80);
  const filename = `logo-${safeBy}-${Date.now()}${ext}`;
  const key = `avatars/branding/${filename}`;
  if (isObjectStorageConfigured()) {
    try {
      return await putPublicObject(key, opts.buffer, opts.mimeType);
    } catch (err) {
      if (!isS3SigningOrAuthError(err)) throw err;
    }
  }
  return writeLocalUpload(["avatars", "branding"], filename, opts.buffer);
}
