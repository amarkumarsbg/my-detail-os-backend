import type { Expense, Invoice } from "../types/finance-documents.js";
import type {
  Party,
  PartyItemWiseRow,
  PartyKind,
  PartyLedgerSummary,
  PartyStatementLine,
  PartyTransactionRow,
} from "../types/party.js";
import { paymentInDetailPath, salesInvoiceDetailPath } from "./payment-paths.js";
import { dateInPreset } from "./report-period.js";

export function invoicePaidTotal(inv: Invoice): number {
  return inv.payments.reduce((s, p) => s + p.amount, 0) + (inv.walletAmountUsed || 0);
}

export function invoiceOutstanding(inv: Invoice): number {
  return Math.max(0, Math.round((inv.grandTotal - invoicePaidTotal(inv)) * 100) / 100);
}

function invoiceSourceLedgerLabel(inv: Pick<Invoice, "source">): string {
  if (inv.source === "COUNTER_SALE") return "Counter Sale";
  if (inv.source === "MEMBERSHIP") return "Membership";
  return "Sales Invoices";
}

export function expenseOutstanding(e: Expense): number {
  if (e.paymentStatus === "PAID") return 0;
  const paid = e.amountPaid ?? 0;
  return Math.max(0, Math.round((e.amount - paid) * 100) / 100);
}

export function partyDocumentsForParty(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[]
): { invoices: Invoice[]; expenses: Expense[] } {
  if (party.kind === "customer" && party.customerId) {
    return {
      invoices: invoices.filter((i) => i.customerId === party.customerId),
      expenses: [],
    };
  }
  const key = party.vendorKey?.trim();
  if (party.kind === "supplier" && key) {
    return {
      invoices: [],
      expenses: expenses.filter((e) => e.vendorName?.trim() === key),
    };
  }
  return { invoices: [], expenses: [] };
}

/** Signed opening balance for ledger math (receivable +, payable − from business view). */
export function signedOpeningBalance(party: Party): number {
  const amt = Math.max(0, party.openingBalance ?? 0);
  const side =
    party.openingBalanceSide ?? (party.kind === "customer" ? "toCollect" : "toPay");
  if (party.kind === "customer") {
    return side === "toCollect" ? amt : -amt;
  }
  return side === "toPay" ? amt : -amt;
}

export function partyCurrentBalance(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[]
): number {
  const { invoices: invs, expenses: exps } = partyDocumentsForParty(party, invoices, expenses);
  const docBal =
    party.kind === "customer"
      ? invs.reduce((s, i) => s + invoiceOutstanding(i), 0)
      : exps.reduce((s, e) => s + expenseOutstanding(e), 0);
  const open = signedOpeningBalance(party);
  return Math.round((open + docBal) * 100) / 100;
}

export function buildPartyTransactions(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[],
  period: string
): PartyTransactionRow[] {
  const { invoices: invs, expenses: exps } = partyDocumentsForParty(party, invoices, expenses);

  if (party.kind === "customer") {
    const rows: PartyTransactionRow[] = [];
    for (const inv of invs) {
      if (dateInPreset(inv.createdAt, period)) {
        const out = invoiceOutstanding(inv);
        const paid = invoicePaidTotal(inv);
        const status =
          inv.status === "PAID" || out < 0.01
            ? "Paid"
            : paid > 0
              ? "Partially paid"
              : "Outstanding";
        const tone: PartyTransactionRow["statusTone"] =
          status === "Paid" ? "success" : status === "Partially paid" ? "warning" : "muted";
        rows.push({
          id: inv.id,
          at: inv.createdAt,
          typeLabel: invoiceSourceLedgerLabel(inv),
          reference: inv.invoiceNumber,
          amount: inv.grandTotal,
          unpaidAmount: out > 0.01 ? out : undefined,
          status,
          statusTone: tone,
          href: salesInvoiceDetailPath(inv.id),
        });
      }
      for (const p of inv.payments) {
        const paidAt = paymentLedgerTimestamp(p.paidAt, inv.createdAt);
        if (!dateInPreset(paidAt, period)) continue;
        rows.push({
          id: p.id,
          at: paidAt,
          typeLabel: "Payment In",
          reference: inv.invoiceNumber,
          amount: p.amount,
          status: "",
          statusTone: "muted",
          href: paymentInDetailPath(p.id),
        });
      }
    }
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  return exps
    .filter((e) => dateInPreset(e.date, period))
    .map((e) => {
      const out = expenseOutstanding(e);
      const status =
        e.paymentStatus === "PAID" || out < 0.01
          ? "Paid"
          : e.paymentStatus === "PARTIAL"
            ? "Partially paid"
            : "Outstanding";
      const tone: PartyTransactionRow["statusTone"] =
        status === "Paid" ? "success" : status === "Partially paid" ? "warning" : "muted";
      return {
        id: e.id,
        at: e.date,
        typeLabel: "Purchase / expense",
        reference: e.title,
        amount: e.amount,
        status,
        statusTone: tone,
        href: `/expenses`,
      };
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function formatLedgerDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Authoritative ledger timestamp for a payment.
 * Prefer stored `paidAt`; fall back to invoice createdAt for legacy rows missing paidAt.
 */
export function paymentLedgerTimestamp(
  paidAt: string | undefined | null,
  invoiceCreatedAtFallback: string
): string {
  if (typeof paidAt === "string" && paidAt.trim()) return paidAt.trim();
  return invoiceCreatedAtFallback;
}

function paymentModeLabel(method: string): string {
  return method.replace(/_/g, " ");
}

export function buildPartyStatement(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[],
  period: string
): PartyStatementLine[] {
  const lines: PartyStatementLine[] = [];
  let balance = signedOpeningBalance(party);

  lines.push({
    id: "opening",
    date: "—",
    voucher: "Opening Balance",
    serialNo: "—",
    paymentMode: "—",
    balance,
    isSummary: true,
  });

  type Entry = { at: string; line: Omit<PartyStatementLine, "balance"> & { debit?: number; credit?: number } };
  const entries: Entry[] = [];

  const { invoices: invs, expenses: exps } = partyDocumentsForParty(party, invoices, expenses);

  if (party.kind === "customer") {
    for (const inv of invs) {
      // Invoice row keyed by invoice date; payment rows keyed by payment.paidAt independently.
      if (dateInPreset(inv.createdAt, period)) {
        entries.push({
          at: inv.createdAt,
          line: {
            id: `inv-${inv.id}`,
            date: formatLedgerDate(inv.createdAt),
            voucher: invoiceSourceLedgerLabel(inv),
            serialNo: inv.invoiceNumber,
            paymentMode: "—",
            debit: inv.grandTotal,
            dueLabel:
              invoiceOutstanding(inv) > 0.01
                ? `${formatLedgerDate(inv.createdAt)} (unpaid)`
                : undefined,
          },
        });
      }
      for (const p of inv.payments) {
        const paidAt = paymentLedgerTimestamp(p.paidAt, inv.createdAt);
        if (!dateInPreset(paidAt, period)) continue;
        entries.push({
          at: paidAt,
          line: {
            id: `pay-${p.id}`,
            date: formatLedgerDate(paidAt),
            voucher: `Payment In · ${inv.invoiceNumber}`,
            serialNo: inv.invoiceNumber,
            paymentMode:
              paymentModeLabel(p.method) + (p.referenceNumber ? ` (${p.referenceNumber})` : ""),
            credit: p.amount,
          },
        });
      }
    }
  } else {
    for (const e of exps) {
      if (!dateInPreset(e.date, period)) continue;
      entries.push({
        at: e.date,
        line: {
          id: `exp-${e.id}`,
          date: formatLedgerDate(e.date),
          voucher: "Purchase / expense",
          serialNo: e.id.slice(-6),
          paymentMode: paymentModeLabel(e.paymentMethod),
          debit: e.amount,
        },
      });
      if (e.paymentStatus === "PAID" || (e.amountPaid ?? 0) > 0) {
        const paid = e.paymentStatus === "PAID" ? e.amount : (e.amountPaid ?? 0);
        entries.push({
          at: e.date,
          line: {
            id: `exp-pay-${e.id}`,
            date: formatLedgerDate(e.date),
            voucher: "Payment Out",
            serialNo: e.id.slice(-6),
            paymentMode: paymentModeLabel(e.paymentMethod),
            credit: paid,
          },
        });
      }
    }
  }

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  for (const { line } of entries) {
    if (line.debit != null) balance += line.debit;
    if (line.credit != null) balance -= line.credit;
    balance = Math.round(balance * 100) / 100;
    lines.push({ ...line, balance });
  }

  lines.push({
    id: "closing",
    date: "—",
    voucher: "Closing Balance",
    serialNo: "—",
    paymentMode: "—",
    balance,
    isSummary: true,
  });

  return lines;
}

/**
 * Public share/PDF ledger: separate Sales Invoice (invoice date) and Payment In
 * (`payment.paidAt`) rows so payments recorded later appear on the payment date.
 * Wallet usage is emitted as its own credit using the latest related payment date
 * (or invoice createdAt when no payment timestamps exist).
 */
export function buildPublicCustomerStatement(
  party: Party,
  invoices: Invoice[],
  period: string
): PartyStatementLine[] {
  const { invoices: invs } = partyDocumentsForParty(party, invoices, []);
  const lines: PartyStatementLine[] = [];
  let balance = signedOpeningBalance(party);

  lines.push({
    id: "opening",
    date: "—",
    voucher: "Opening Balance",
    serialNo: "—",
    paymentMode: "—",
    debit: 0,
    balance,
    isSummary: true,
  });

  type Entry = {
    at: string;
    line: Omit<PartyStatementLine, "balance"> & { debit?: number; credit?: number };
  };
  const entries: Entry[] = [];

  for (const inv of invs) {
    if (dateInPreset(inv.createdAt, period)) {
      const outstanding = invoiceOutstanding(inv);
      const collected = invoicePaidTotal(inv);
      entries.push({
        at: inv.createdAt,
        line: {
          id: `inv-${inv.id}`,
          date: formatLedgerDate(inv.createdAt),
          voucher:
            inv.source === "COUNTER_SALE"
              ? "Counter Sale"
              : inv.source === "MEMBERSHIP"
                ? "Membership"
                : "Sales Invoice",
          serialNo: inv.invoiceNumber,
          paymentMode: "—",
          debit: Math.round(inv.grandTotal * 100) / 100,
          invoiceDue:
            collected > 0.01 && outstanding > 0.01 ? outstanding : undefined,
          dueLabel: publicDueLabel(
            inv.createdAt,
            outstanding,
            collected,
            party.creditPeriodDays
          ),
        },
      });
    }

    for (const p of inv.payments) {
      const paidAt = paymentLedgerTimestamp(p.paidAt, inv.createdAt);
      if (!dateInPreset(paidAt, period)) continue;
      entries.push({
        at: paidAt,
        line: {
          id: `pay-${p.id}`,
          date: formatLedgerDate(paidAt),
          voucher: `Payment In · ${inv.invoiceNumber}`,
          serialNo: inv.invoiceNumber,
          paymentMode:
            paymentModeLabel(p.method) +
            (p.referenceNumber ? ` (${p.referenceNumber})` : ""),
          credit: Math.round(p.amount * 100) / 100,
        },
      });
    }

    const walletUsed = inv.walletAmountUsed || 0;
    if (walletUsed > 0.01) {
      const latestPaymentAt = inv.payments
        .map((p) => paymentLedgerTimestamp(p.paidAt, inv.createdAt))
        .sort()
        .at(-1);
      const walletAt = latestPaymentAt ?? inv.createdAt;
      if (dateInPreset(walletAt, period)) {
        entries.push({
          at: walletAt,
          line: {
            id: `wallet-${inv.id}`,
            date: formatLedgerDate(walletAt),
            voucher: `Payment In · ${inv.invoiceNumber}`,
            serialNo: inv.invoiceNumber,
            paymentMode: "WALLET",
            credit: Math.round(walletUsed * 100) / 100,
          },
        });
      }
    }
  }

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  for (const { line } of entries) {
    if (line.debit != null) balance += line.debit;
    if (line.credit != null) balance -= line.credit;
    balance = Math.round(balance * 100) / 100;
    lines.push({ ...line, balance });
  }

  lines.push({
    id: "closing",
    date: "—",
    voucher: "Closing Balance",
    serialNo: "—",
    paymentMode: "—",
    debit: balance,
    balance,
    isSummary: true,
  });

  return lines;
}

function publicDueLabel(
  createdAt: string,
  outstanding: number,
  credit: number,
  creditPeriodDays?: number
): string {
  if (outstanding < 0.01) return "Paid";
  const due = new Date(createdAt);
  const days = Number.isFinite(creditPeriodDays) ? Math.max(0, creditPeriodDays ?? 0) : 0;
  due.setDate(due.getDate() + days);
  const dateStr = formatLedgerDate(due.toISOString());
  if (credit > 0.01) return `${dateStr} Partially Paid`;
  return `${dateStr} Unpaid`;
}

export function buildPartySummary(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[],
  period: string
): PartyLedgerSummary {
  const { invoices: invs, expenses: exps } = partyDocumentsForParty(party, invoices, expenses);
  const current = partyCurrentBalance(party, invoices, expenses);

  if (party.kind === "customer") {
    const inPeriod = invs.filter((i) => dateInPreset(i.createdAt, period));
    const totalSales = inPeriod.reduce((s, i) => s + i.grandTotal, 0);
    let totalReceived = 0;
    for (const inv of invs) {
      for (const p of inv.payments) {
        const paidAt = paymentLedgerTimestamp(p.paidAt, inv.createdAt);
        if (dateInPreset(paidAt, period)) totalReceived += p.amount;
      }
    }
    const overdue = invs
      .filter((i) => invoiceOutstanding(i) > 0.01 && i.status !== "PAID")
      .reduce((s, i) => s + invoiceOutstanding(i), 0);
    return {
      totalReceivableOrPayable: current,
      overdueAmount: Math.round(overdue * 100) / 100,
      totalSalesOrPurchases: Math.round(totalSales * 100) / 100,
      totalReceivedOrPaid: Math.round(totalReceived * 100) / 100,
    };
  }

  const inPeriod = exps.filter((e) => dateInPreset(e.date, period));
  const totalPurchases = inPeriod.reduce((s, e) => s + e.amount, 0);
  const totalPaid = inPeriod.reduce((s, e) => {
    if (e.paymentStatus === "PAID") return s + e.amount;
    if (e.paymentStatus === "PARTIAL") return s + (e.amountPaid ?? 0);
    return s;
  }, 0);
  const overdue = exps
    .filter((e) => expenseOutstanding(e) > 0.01)
    .reduce((s, e) => s + expenseOutstanding(e), 0);

  return {
    totalReceivableOrPayable: current,
    overdueAmount: Math.round(overdue * 100) / 100,
    totalSalesOrPurchases: Math.round(totalPurchases * 100) / 100,
    totalReceivedOrPaid: Math.round(totalPaid * 100) / 100,
  };
}

function emptyItemWiseRow(
  itemName: string,
  itemCode: string
): PartyItemWiseRow {
  return {
    itemName,
    itemCode,
    salesQuantity: 0,
    salesUnit: "—",
    salesAmount: 0,
    purchaseQuantity: 0,
    purchaseUnit: "—",
    purchaseAmount: 0,
  };
}

export function buildPartyItemWise(
  party: Party,
  invoices: Invoice[],
  expenses: Expense[],
  period: string
): PartyItemWiseRow[] {
  const map = new Map<string, PartyItemWiseRow>();
  const { invoices: invs, expenses: exps } = partyDocumentsForParty(party, invoices, expenses);

  if (party.kind === "customer" && party.customerId) {
    for (const inv of invs) {
      if (!dateInPreset(inv.createdAt, period)) continue;
      for (const li of inv.lineItems) {
        const key = li.description.trim() || "Item";
        const code = li.hsnSac?.trim() || "—";
        const qty = li.quantity;
        const unit = li.type === "PARTS" ? "PCS" : li.type === "SERVICE" ? "JOB" : "—";
        const existing = map.get(key);
        if (existing) {
          existing.salesQuantity += qty;
          existing.salesAmount += li.total;
          if (existing.itemCode === "—" && code !== "—") existing.itemCode = code;
        } else {
          map.set(key, {
            ...emptyItemWiseRow(key, code),
            salesQuantity: qty,
            salesUnit: unit,
            salesAmount: li.total,
          });
        }
      }
    }
  } else if (party.kind === "supplier") {
    for (const e of exps) {
      if (!dateInPreset(e.date, period)) continue;
      const key = e.title.trim() || e.category || "Expense";
      const code = e.category?.trim() || "—";
      const existing = map.get(key);
      if (existing) {
        existing.purchaseQuantity += 1;
        existing.purchaseAmount += e.amount;
      } else {
        map.set(key, {
          ...emptyItemWiseRow(key, code),
          purchaseQuantity: 1,
          purchaseUnit: "—",
          purchaseAmount: e.amount,
        });
      }
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      b.salesAmount + b.purchaseAmount - (a.salesAmount + a.purchaseAmount)
  );
}

export function balanceFlow(kind: PartyKind, balance: number): "in" | "out" | "zero" {
  if (Math.abs(balance) < 0.01) return "zero";
  if (kind === "customer") return balance > 0 ? "in" : "out";
  return balance > 0 ? "out" : "in";
}
