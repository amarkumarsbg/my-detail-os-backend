import { isResendConfigured, sendViaResend } from "../../services/resend-send.js";

export function isPasswordResetEmailConfigured(): boolean {
  return isResendConfigured();
}

export type SendPasswordResetEmailResult =
  | { ok: true }
  | { ok: false; detail: string };

/** Sends via Resend; returns why it failed when not ok (for operator/dev messages). */
export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string
): Promise<SendPasswordResetEmailResult> {
  const safeUrl = resetUrl.trim();
  const hrefAttr = safeUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

  const result = await sendViaResend({
    to: [toEmail],
    subject: "Reset your MY DETAIL OS password",
    html: `
          <p>You requested to reset your password for MY DETAIL OS.</p>
          <p><a href="${hrefAttr}">Choose a new password</a></p>
          <p>If you didn't request this, you can safely ignore this message.</p>
          <p style="font-size:12px;color:#666;">This link expires in about one hour.</p>
        `,
    text: `Choose a new password (${safeUrl})\nIf you didn't request this, ignore this email. This link expires in about one hour.`,
  });
  if (!result.ok) {
    console.error("[password-reset-email] Resend error:", result.detail);
  }
  return result;
}
