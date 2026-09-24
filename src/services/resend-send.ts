import { env } from "../config/env.js";

export type ResendSendResult = { ok: true } | { ok: false; detail: string };

/** Resend-allowed test From until your domain is verified at resend.com/domains */
export const RESEND_TEST_FROM = "My Detail OS <onboarding@resend.dev>";

export function isResendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

function summarizeResendError(status: number, bodyText: string): string {
  const snippet = bodyText.trim().slice(0, 400);
  try {
    const j = JSON.parse(bodyText) as { message?: unknown };
    if (typeof j.message === "string" && j.message.length > 0) {
      return `${status}: ${j.message}`;
    }
  } catch {
    /* plain text body */
  }
  return snippet ? `${status}: ${snippet}` : `${status}: empty response from Resend`;
}

function isResendDomainUnverifiedError(detail: string): boolean {
  const d = detail.toLowerCase();
  return d.includes("domain is not verified") || d.includes("verify your domain");
}

export type ResendAttachment = {
  filename: string;
  /** Base64-encoded file content (Resend API). */
  content: string;
};

async function sendResendOnce(
  key: string,
  from: string,
  params: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: ResendAttachment[];
  }
): Promise<ResendSendResult> {
  try {
    const attachments =
      params.attachments?.filter((a) => a.filename.trim() && a.content.trim()) ?? [];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text?.trim() ? { text: params.text.trim() } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      const detail = summarizeResendError(res.status, txt);
      console.error("[resend] send error:", detail);
      return { ok: false, detail };
    }
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[resend] fetch failed:", e);
    return { ok: false, detail };
  }
}

/**
 * Sends via Resend REST API (password reset, invoice email, etc.).
 * In development, if MAIL_FROM uses an unverified domain, retries once with
 * onboarding@resend.dev so local testing keeps working. Production always uses MAIL_FROM only.
 */
export async function sendViaResend(params: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: ResendAttachment[];
}): Promise<ResendSendResult> {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, detail: "RESEND_API_KEY is not set" };

  const configuredFrom = env.MAIL_FROM ?? RESEND_TEST_FROM;
  let result = await sendResendOnce(key, configuredFrom, params);

  const devFallback =
    process.env.NODE_ENV !== "production" &&
    !result.ok &&
    isResendDomainUnverifiedError(result.detail) &&
    configuredFrom.trim() !== RESEND_TEST_FROM;

  if (devFallback) {
    console.warn(
      "[resend] MAIL_FROM domain not verified — retrying with onboarding@resend.dev (dev only). Add DNS at resend.com/domains or set MAIL_FROM to match RESEND_TEST_FROM."
    );
    result = await sendResendOnce(key, RESEND_TEST_FROM, params);
  }

  return result;
}
