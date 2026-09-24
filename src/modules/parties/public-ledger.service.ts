import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import { SINGLETON_ENTITY_ID } from "../../constants/json-collections.js";
import { formatPeriodRangeLabel } from "../../lib/report-period.js";
import {
  buildPublicCustomerStatement,
  buildPartySummary,
  invoiceOutstanding,
} from "../../lib/party-ledger.js";
import type { Party } from "../../types/party.js";
import { loadFinanceDocuments } from "./party.service.js";

function customerPartyId(customerId: string) {
  return `c:${customerId}`;
}

function str(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

async function loadPublicBusinessProfile() {
  const row = await prisma.appJsonRow.findUnique({
    where: {
      collection_entityId: { collection: "appSettings", entityId: SINGLETON_ENTITY_ID },
    },
  });
  const raw =
    row?.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};

  return {
    businessName: str(raw, "businessName") || "My Detail OS",
    businessLogo: str(raw, "businessLogo") || str(raw, "logoUrl"),
    businessPhone: str(raw, "businessPhone") || str(raw, "businessWhatsApp"),
    businessAddress: str(raw, "businessAddress"),
  };
}

/**
 * Public-safe customer ledger statement (no auth).
 * Identified by studio customer id (`Customer.id`).
 * Shape mirrors MyBillBook Party Ledger share page / PDF.
 */
export async function getPublicCustomerLedger(customerId: string, period = "last365") {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      organizationId: true,
    },
  });
  if (!customer) {
    throw AppError.notFound("Ledger not found");
  }

  const partyRow = await prisma.party.findFirst({
    where: {
      organizationId: customer.organizationId,
      OR: [{ id: customerPartyId(customer.id) }, { customerId: customer.id }],
    },
  });

  const party: Party = {
    id: partyRow?.id ?? customerPartyId(customer.id),
    kind: "customer",
    name: partyRow?.name ?? customer.name,
    mobile: partyRow?.mobile ?? customer.phone ?? undefined,
    openingBalance: partyRow?.openingBalance ?? 0,
    openingBalanceSide:
      partyRow?.openingBalanceSide === "TO_PAY"
        ? "toPay"
        : partyRow?.openingBalanceSide === "TO_COLLECT"
          ? "toCollect"
          : "toCollect",
    customFields: [],
    customerId: customer.id,
    createdAt: (partyRow?.createdAt ?? new Date()).toISOString(),
    updatedAt: (partyRow?.updatedAt ?? new Date()).toISOString(),
  };

  const { invoices, expenses } = await loadFinanceDocuments(customer.organizationId);
  const statement = buildPublicCustomerStatement(party, invoices, period);
  const summary = buildPartySummary(party, invoices, expenses, period);
  const business = await loadPublicBusinessProfile();

  const customerInvoices = invoices.filter((i) => i.customerId === customer.id);
  const outstanding = Math.round(
    customerInvoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0) * 100
  ) / 100;

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone || party.mobile || "",
    },
    period,
    dateRangeLabel: formatPeriodRangeLabel(period),
    summary: {
      totalReceivableOrPayable: summary.totalReceivableOrPayable,
      overdueAmount: summary.overdueAmount,
      totalSalesOrPurchases: summary.totalSalesOrPurchases,
      totalReceivedOrPaid: summary.totalReceivedOrPaid,
      totalOutstanding: outstanding > 0.01 ? outstanding : summary.totalReceivableOrPayable,
    },
    statement: statement.map((line) => ({
      id: line.id,
      date: line.date,
      voucher: line.voucher,
      serialNo: line.serialNo,
      paymentMode: line.paymentMode,
      credit: line.credit ?? null,
      debit: line.debit ?? null,
      balance: line.balance,
      isSummary: Boolean(line.isSummary),
      dueLabel: line.dueLabel ?? null,
      invoiceDue: line.invoiceDue ?? null,
    })),
    business,
  };
}
