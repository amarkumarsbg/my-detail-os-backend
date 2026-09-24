import "dotenv/config";
import { z } from "zod";

/** Trim and treat empty string as unset (common .env copy/paste issue). */
function trimOpt(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** Neon CLI/UI sometimes adds `channel_binding=require`, which breaks `pg` in several Linux/container setups (plain-text "Internal Server Error" from the proxy). */
export function sanitizeDatabaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/[?&]channel_binding=require\b/gi, "");
  url = url.replace(/&&+/g, "&").replace(/\?&/g, "?").replace(/\?$/, "").replace(/&$/g, "");

  const hostMatch = url.match(/^postgres(?:ql)?:\/\/[^@]*@([^/:]+)/i);
  const host = hostMatch?.[1] ?? "";
  const isNeonPooler = host.includes("-pooler.");

  if (isNeonPooler && !/[?&]pgbouncer=true\b/i.test(url)) {
    url += url.includes("?") ? "&" : "?";
    url += "pgbouncer=true";
  }
  if (!/[?&]connect_timeout=\d+/i.test(url)) {
    url += url.includes("?") ? "&" : "?";
    url += "connect_timeout=60";
  }
  return url;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  /** Account SID (AC…). Required for SMS when using Twilio. */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  /** Primary auth token — OR use API key SID + secret below (not both required in .env; one path is enough). */
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** API key SID (SK…) + secret — preferred over auth token when using restricted keys. */
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  /** E.164 sender, e.g. +15005550006 (trial) or your Twilio number */
  TWILIO_FROM_NUMBER: z.string().optional(),
  /**
   * WhatsApp-enabled sender from Twilio, e.g. whatsapp:+14155238886 (sandbox) or whatsapp:+91… after approval.
   * Required only for server-side WhatsApp API; SMS OTP still uses TWILIO_FROM_NUMBER.
   */
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  /** Default +91; set +1 etc. if your users are not in India */
  TWILIO_TO_NUMBER_PREFIX: z.string().optional(),
  /**
   * Resend API — password reset emails. https://resend.com
   * Omit in dev to log reset URLs in the API terminal instead (see forgot-password logs).
   */
  RESEND_API_KEY: z.string().optional(),
  /** From address Resend recognizes, e.g. `MY DETAIL OS <onboarding@resend.dev>` */
  MAIL_FROM: z.string().optional(),

  /** S3-compatible bucket for public files (avatars + job-card photos under `avatars/`, `job-cards/`). Omit S3_* to use local `uploads/`. */
  S3_BUCKET: z.string().optional(),
  /** AWS region, or `auto` for Cloudflare R2. Default `us-east-1` when no custom endpoint. */
  S3_REGION: z.string().optional(),
  /** R2 / MinIO API endpoint, e.g. `https://<accountid>.r2.cloudflarestorage.com` */
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public base URL for objects (R2 dev URL, CloudFront, or `https://bucket.s3.region.amazonaws.com`) — no trailing slash. */
  S3_PUBLIC_BASE_URL: z.string().optional(),
  /** With custom `S3_ENDPOINT`, path-style addressing is usually required. Set `false` only if your provider needs virtual-hosted style. */
  S3_FORCE_PATH_STYLE: z.string().optional(),
  /** SaaS vendor platform API key (header X-Platform-Admin-Key). Optional in local if using PLATFORM_OWNER login. */
  PLATFORM_ADMIN_API_KEY: z.string().optional(),
  /**
   * Shared secret for external cron / job endpoints (header `X-Internal-Job-Key`).
   * Required for production scheduled reminder processing.
   */
  INTERNAL_JOB_SECRET: z.string().optional(),
  /** Default Contact Us / Upgrade URLs stored on new subscriptions when not overridden. */
  DEFAULT_CONTACT_US_URL: z.string().optional(),
  DEFAULT_UPGRADE_URL: z.string().optional(),
});

export const env = schema.parse({
  DATABASE_URL: sanitizeDatabaseUrl(process.env.DATABASE_URL ?? ""),
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: process.env.PORT,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  TWILIO_ACCOUNT_SID: trimOpt(process.env.TWILIO_ACCOUNT_SID),
  TWILIO_AUTH_TOKEN: trimOpt(process.env.TWILIO_AUTH_TOKEN),
  TWILIO_API_KEY_SID: trimOpt(process.env.TWILIO_API_KEY_SID),
  TWILIO_API_KEY_SECRET: trimOpt(process.env.TWILIO_API_KEY_SECRET),
  TWILIO_FROM_NUMBER: trimOpt(process.env.TWILIO_FROM_NUMBER),
  TWILIO_WHATSAPP_FROM: trimOpt(process.env.TWILIO_WHATSAPP_FROM),
  TWILIO_TO_NUMBER_PREFIX: trimOpt(process.env.TWILIO_TO_NUMBER_PREFIX),
  RESEND_API_KEY: trimOpt(process.env.RESEND_API_KEY),
  MAIL_FROM: trimOpt(process.env.MAIL_FROM),
  S3_BUCKET: trimOpt(process.env.S3_BUCKET),
  S3_REGION: trimOpt(process.env.S3_REGION),
  S3_ENDPOINT: trimOpt(process.env.S3_ENDPOINT),
  S3_ACCESS_KEY_ID: trimOpt(process.env.S3_ACCESS_KEY_ID),
  S3_SECRET_ACCESS_KEY: trimOpt(process.env.S3_SECRET_ACCESS_KEY),
  S3_PUBLIC_BASE_URL: trimOpt(process.env.S3_PUBLIC_BASE_URL),
  S3_FORCE_PATH_STYLE: trimOpt(process.env.S3_FORCE_PATH_STYLE),
  PLATFORM_ADMIN_API_KEY: trimOpt(process.env.PLATFORM_ADMIN_API_KEY),
  INTERNAL_JOB_SECRET: trimOpt(process.env.INTERNAL_JOB_SECRET),
  DEFAULT_CONTACT_US_URL: trimOpt(process.env.DEFAULT_CONTACT_US_URL),
  DEFAULT_UPGRADE_URL: trimOpt(process.env.DEFAULT_UPGRADE_URL),
});
