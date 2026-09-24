import { invoiceOutstanding } from "../lib/party-ledger.js";
import type { Invoice } from "../types/finance-documents.js";
import {
  advancePaymentReminderAfterSend,
  markReminderSentForPeriod,
  paymentOutstandingForReminder,
  selectRemindersForAutoWhatsApp,
  type ReminderRecord,
} from "./reminder-auto-whatsapp.js";
import { normalizeReminderKind } from "./reminder-schedule.js";
import {
  buildPaymentPendingReminderWhatsAppMessage,
  buildServiceReminderWhatsAppMessage,
  publicCustomerLedgerShareUrl,
  publicInvoiceShareUrl,
} from "./reminder-whatsapp-messages.js";

export type ReminderJobOrgSettings = {
  whatsappReminderEnabled: boolean;
  reminderLeadDays: number;
  businessName: string;
};

export type ProcessOrgRemindersResult = {
  organizationId: string;
  attempted: number;
  sent: number;
  skippedPaid: number;
  skippedDuplicate: number;
  failed: number;
  advanced: number;
};

export type ProcessOrgRemindersDeps = {
  organizationId: string;
  reminders: ReminderRecord[];
  invoices: Invoice[];
  settings: ReminderJobOrgSettings;
  publicBaseUrl: string;
  sendWhatsApp: (phone: string, message: string) => Promise<void>;
  saveReminder: (reminder: ReminderRecord) => Promise<void>;
  now?: Date;
};

function buildMessage(
  reminder: ReminderRecord,
  settings: ReminderJobOrgSettings,
  publicBaseUrl: string,
  getOutstanding: (invoiceId: string) => number | undefined
): string {
  if (normalizeReminderKind(reminder.kind) === "PAYMENT") {
    const amount = paymentOutstandingForReminder(reminder, getOutstanding);
    return buildPaymentPendingReminderWhatsAppMessage({
      pendingAmount: amount,
      statementUrl: publicCustomerLedgerShareUrl(publicBaseUrl, reminder.customerId),
      businessName: settings.businessName || "My Detail OS",
      invoiceUrl: reminder.invoiceId
        ? publicInvoiceShareUrl(publicBaseUrl, reminder.invoiceId)
        : undefined,
      invoiceNumber: reminder.invoiceNumber,
    });
  }
  return buildServiceReminderWhatsAppMessage(
    reminder,
    settings.businessName || "My Detail OS"
  );
}

/**
 * Idempotent org reminder processor — shared by cron job + authenticated studio trigger.
 */
export async function processOrganizationReminders(
  deps: ProcessOrgRemindersDeps
): Promise<ProcessOrgRemindersResult> {
  const now = deps.now ?? new Date();
  const invoiceById = new Map(deps.invoices.map((i) => [i.id, i]));
  const getOutstanding = (invoiceId: string) => {
    const inv = invoiceById.get(invoiceId);
    return inv ? invoiceOutstanding(inv) : undefined;
  };

  const result: ProcessOrgRemindersResult = {
    organizationId: deps.organizationId,
    attempted: 0,
    sent: 0,
    skippedPaid: 0,
    skippedDuplicate: 0,
    failed: 0,
    advanced: 0,
  };

  if (!deps.settings.whatsappReminderEnabled) {
    return result;
  }

  const candidates = selectRemindersForAutoWhatsApp(deps.reminders, {
    whatsappReminderEnabled: true,
    getOutstanding,
    leadDays: deps.settings.reminderLeadDays,
    now,
  });
  result.attempted = candidates.length;

  for (const reminder of candidates) {
    // Re-read from working map for idempotency within a single run
    const outstanding =
      normalizeReminderKind(reminder.kind) === "PAYMENT"
        ? paymentOutstandingForReminder(reminder, getOutstanding)
        : undefined;
    if (normalizeReminderKind(reminder.kind) === "PAYMENT" && (outstanding ?? 0) <= 0.01) {
      result.skippedPaid += 1;
      continue;
    }
    if (reminder.lastMessageSentAt || reminder.whatsappSent) {
      result.skippedDuplicate += 1;
      continue;
    }

    const message = buildMessage(reminder, deps.settings, deps.publicBaseUrl, getOutstanding);
    try {
      await deps.sendWhatsApp(reminder.customerPhone, message);
      const sentAt = now.toISOString();
      let next = markReminderSentForPeriod(reminder, sentAt);

      if (normalizeReminderKind(reminder.kind) === "PAYMENT") {
        const amt = outstanding ?? 0;
        const advanced = advancePaymentReminderAfterSend(next, {
          leadDays: deps.settings.reminderLeadDays,
          outstanding: amt,
          now,
        });
        if (advanced) {
          next = advanced;
          result.advanced += 1;
        } else if (amt <= 0.01) {
          next = {
            ...next,
            status: "COMPLETED",
            outstandingAmount: 0,
          };
        }
      }

      await deps.saveReminder(next);
      // Update in-memory copy so duplicate candidates in same batch are blocked
      reminder.whatsappSent = true;
      reminder.lastMessageSentAt = sentAt;
      result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

export function parseAppSettingsPayload(raw: unknown): ReminderJobOrgSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    whatsappReminderEnabled: o.whatsappReminderEnabled !== false,
    reminderLeadDays:
      typeof o.reminderLeadDays === "number" && Number.isFinite(o.reminderLeadDays)
        ? Math.max(0, Math.floor(o.reminderLeadDays))
        : 7,
    businessName:
      typeof o.businessName === "string" && o.businessName.trim()
        ? o.businessName.trim()
        : "My Detail OS",
  };
}

export function asReminderRecords(items: unknown[]): ReminderRecord[] {
  return items.filter((x): x is ReminderRecord => {
    if (!x || typeof x !== "object") return false;
    const r = x as ReminderRecord;
    return typeof r.id === "string" && typeof r.dueDate === "string" && typeof r.status === "string";
  });
}
