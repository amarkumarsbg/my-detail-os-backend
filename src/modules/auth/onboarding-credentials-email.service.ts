import { isResendConfigured, sendViaResend } from "../../services/resend-send.js";

export type SendOnboardingCredentialsResult =
  | { ok: true }
  | { ok: false; detail: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Sends login email when Resend is configured (same setup as password reset). */
export async function sendUserCredentialsEmail(params: {
  toEmail: string;
  recipientName: string;
  temporaryPassword: string;
}): Promise<SendOnboardingCredentialsResult> {
  if (!isResendConfigured()) {
    return { ok: false, detail: "RESEND_API_KEY is not set" };
  }
  const emailEsc = escapeHtml(params.toEmail.trim());
  const nameEsc = escapeHtml(params.recipientName.trim());
  const passEsc = escapeHtml(params.temporaryPassword);

  const result = await sendViaResend({
    to: [params.toEmail.trim()],
    subject: "Your MY DETAIL OS account",
    html: `
      <p>Hi ${nameEsc},</p>
      <p>Your account has been created successfully.</p>
      <p><strong>Email:</strong> ${emailEsc}<br/>
      <strong>Temporary password:</strong> <code>${passEsc}</code></p>
      <p>This is a temporary password. Please change your password after first login.</p>
      <p style="font-size:12px;color:#666;">If you did not expect this message, contact your administrator.</p>
    `,
    text: [
      `Hi ${params.recipientName.trim()},`,
      ``,
      `Your account has been created successfully.`,
      ``,
      `Email: ${params.toEmail.trim()}`,
      `Temporary password: ${params.temporaryPassword}`,
      ``,
      `This is a temporary password. Please change your password after first login.`,
    ].join("\n"),
  });
  if (!result.ok) {
    console.error("[onboarding-email] Resend error:", result.detail);
  }
  return result;
}
