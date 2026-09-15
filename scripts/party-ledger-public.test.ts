import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPublicCustomerStatement } from "../src/lib/party-ledger.ts";
import type { Invoice } from "../src/types/finance-documents.ts";
import type { Party } from "../src/types/party.ts";

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: "c:cust-1",
    kind: "customer",
    name: "Danish",
    openingBalance: 0,
    openingBalanceSide: "toCollect",
    customFields: [],
    customerId: "cust-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> & Pick<Invoice, "id" | "grandTotal" | "createdAt">): Invoice {
  return {
    invoiceNumber: overrides.invoiceNumber ?? "INV-1",
    jobCardId: "jc-1",
    jobNumber: "JC-1",
    customerId: "cust-1",
    customerName: "Danish",
    customerPhone: "9889574310",
    vehicleRegNumber: "UP16AB1234",
    lineItems: [],
    subtotal: overrides.grandTotal,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 0,
    rewardDiscount: 0,
    walletAmountUsed: 0,
    status: "ISSUED",
    payments: [],
    ...overrides,
  };
}

describe("buildPublicCustomerStatement", () => {
  it("keeps invoice on invoice date and payment on paidAt for later settlement", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "old",
        invoiceNumber: "INV-2026-0025",
        grandTotal: 75000,
        createdAt: "2026-09-01T10:00:00.000Z",
        status: "PAID",
        payments: [
          {
            id: "pay-today",
            invoiceId: "old",
            amount: 75000,
            method: "CASH",
            paidAt: "2026-09-07T12:00:00.000Z",
          },
        ],
      }),
    ];

    const lines = buildPublicCustomerStatement(party(), invoices, "all");
    const sales = lines.filter((l) => !l.isSummary);

    assert.equal(sales.length, 2);
    assert.equal(sales[0]!.voucher, "Sales Invoice");
    assert.equal(sales[0]!.debit, 75000);
    assert.equal(sales[0]!.credit, undefined);
    assert.match(sales[0]!.date, /01/);
    assert.equal(sales[0]!.balance, 75000);

    assert.equal(sales[1]!.voucher.startsWith("Payment In"), true);
    assert.equal(sales[1]!.serialNo, "INV-2026-0025");
    assert.equal(sales[1]!.credit, 75000);
    assert.equal(sales[1]!.debit, undefined);
    assert.match(sales[1]!.date, /07/);
    assert.equal(sales[1]!.balance, 0);

    const closing = lines.find((l) => l.id === "closing");
    assert.equal(closing?.balance, 0);
  });

  it("supports partial and multiple payments on different dates", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "0341",
        invoiceNumber: "INV-2026-0341",
        grandTotal: 1710,
        createdAt: "2026-08-18T10:00:00.000Z",
        status: "PARTIALLY_PAID",
        payments: [
          {
            id: "p-partial",
            invoiceId: "0341",
            amount: 1000,
            method: "CASH",
            paidAt: "2026-08-20T12:00:00.000Z",
          },
          {
            id: "p-rest",
            invoiceId: "0341",
            amount: 710,
            method: "UPI",
            paidAt: "2026-08-22T09:00:00.000Z",
          },
        ],
      }),
    ];
    const lines = buildPublicCustomerStatement(party(), invoices, "all");
    const sales = lines.filter((l) => !l.isSummary);
    assert.equal(sales.length, 3);

    const invRow = sales.find((l) => l.serialNo === "INV-2026-0341");
    assert.equal(invRow?.debit, 1710);
    assert.equal(invRow?.credit, undefined);
    assert.equal(invRow?.dueLabel, "Paid");

    const credits = sales.filter((l) => l.voucher.startsWith("Payment In"));
    assert.equal(credits.length, 2);
    assert.equal(credits[0]!.credit, 1000);
    assert.equal(credits[1]!.credit, 710);
    assert.equal(credits[0]!.serialNo, "INV-2026-0341");
    assert.equal(credits[1]!.serialNo, "INV-2026-0341");
    assert.equal(sales.at(-1)!.balance, 0);
  });

  it("emits separate Payment In rows dated by paidAt", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "a",
        grandTotal: 400,
        createdAt: "2026-04-24T10:00:00.000Z",
        payments: [
          {
            id: "p1",
            invoiceId: "a",
            amount: 400,
            method: "CASH",
            paidAt: "2026-04-24T11:00:00.000Z",
          },
        ],
      }),
    ];
    const lines = buildPublicCustomerStatement(party(), invoices, "all");
    assert.equal(lines.some((l) => l.voucher.startsWith("Payment In")), true);
    assert.equal(lines.filter((l) => !l.isSummary).length, 2);
  });

  it("falls back to invoice createdAt when paidAt is missing", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "legacy",
        grandTotal: 100,
        createdAt: "2026-05-01T10:00:00.000Z",
        payments: [
          {
            id: "p-legacy",
            invoiceId: "legacy",
            amount: 100,
            method: "CASH",
            paidAt: "",
          } as Invoice["payments"][number],
        ],
      }),
    ];
    const lines = buildPublicCustomerStatement(party(), invoices, "all");
    const pay = lines.find((l) => l.voucher.startsWith("Payment In"));
    const inv = lines.find((l) => l.voucher === "Sales Invoice");
    assert.equal(pay?.date, inv?.date);
    assert.equal(pay?.serialNo, inv?.serialNo);
  });
});
