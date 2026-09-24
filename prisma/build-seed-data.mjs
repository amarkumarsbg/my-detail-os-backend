/**
 * One-off / regen: node prisma/build-seed-data.mjs
 * Writes prisma/seed-data.json with 5 rows per entity for local testing.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iso = (d = new Date()) => d.toISOString();
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const branches = [
  {
    id: "br-main",
    name: "Main workshop",
    code: "MAIN",
    address: "100 Industrial Area, Bengaluru",
    city: "Bengaluru",
    state: "KA",
    pincode: "560001",
    phone: "+918000000001",
    email: "main@mydetailos.test",
    isActive: true,
    qrCodeId: "qr-main",
    managerName: "Branch Manager One",
    managerPhone: "+918000000011",
  },
  ...[2, 3, 4, 5].map((n) => ({
    id: `br-00${n}`,
    name: `Workshop ${n - 1}`,
    code: `WS0${n - 1}`,
    address: `${n * 20} MG Road, City ${n}`,
    city: "Mumbai",
    state: "MH",
    pincode: `40000${n}`,
    phone: `+91800000000${n}`,
    email: `branch${n}@mydetailos.test`,
    isActive: true,
    qrCodeId: `qr-br-00${n}`,
    managerName: `Manager ${n}`,
    managerPhone: `+9180000000${n}0`,
  })),
];

const staff = [
  {
    id: "usr-admin",
    name: "Administrator",
    email: "admin@local.dev",
    phone: "+1000000000",
    role: "SUPER_ADMIN",
    branchId: "br-main",
    isActive: true,
    attendancePin: "1000",
    emailVerified: true,
    totalJobsCompleted: 120,
    totalIncentiveEarned: 45000,
  },
  {
    id: "usr-002",
    name: "Priya Sharma",
    email: "priya.manager@mydetailos.test",
    phone: "+918000000102",
    role: "BRANCH_MANAGER",
    branchId: "br-002",
    isActive: true,
    emailVerified: true,
    attendancePin: "2000",
  },
  {
    id: "usr-003",
    name: "Ravi Mechanic",
    email: "ravi.mech@mydetailos.test",
    phone: "+918000000103",
    role: "MECHANIC",
    branchId: "br-main",
    isActive: true,
    emailVerified: true,
    attendancePin: "3000",
    totalJobsCompleted: 89,
    totalIncentiveEarned: 12000,
  },
  {
    id: "usr-004",
    name: "Sunil Mechanic",
    email: "sunil.mech@mydetailos.test",
    phone: "+918000000104",
    role: "MECHANIC",
    branchId: "br-main",
    isActive: true,
    attendancePin: "4000",
    totalJobsCompleted: 64,
    totalIncentiveEarned: 8900,
  },
  {
    id: "usr-005",
    name: "Neha Reception",
    email: "neha.recv@mydetailos.test",
    phone: "+918000000105",
    role: "RECEPTIONIST",
    branchId: "br-main",
    isActive: true,
    emailVerified: true,
    attendancePin: "5000",
  },
];

const customers = [1, 2, 3, 4, 5].map((n) => ({
  id: `cust-00${n}`,
  name: `Test Customer ${n}`,
  phone: `+91987654320${n}`,
  email: `customer${n}@example.test`,
  address: `${n * 5} Residency Road, Bengaluru`,
  referralCode: `REF2026${n}`,
  referredBy: n > 2 ? "cust-001" : undefined,
  totalVisits: n + 1,
  rewardPoints: n * 100,
  walletBalance: n * 250.5,
  lastVisitDate: day(-n * 3),
  isInactive: false,
  emailVerified: n % 2 === 0,
  createdAt: iso(new Date(Date.UTC(2026, 3, n, 10, 0, 0))),
}));

const segments = ["HATCHBACK", "SEDAN", "SUV", "COMPACT_SUV", "LUXURY"];
const vehicles = [1, 2, 3, 4, 5].map((n) => ({
  id: `veh-00${n}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  registrationNumber: `KA01AB${1000 + n}`,
  make: ["Maruti", "Hyundai", "Honda", "Tata", "Toyota"][n - 1],
  model: ["Swift", "i20", "City", "Nexon", "Innova"][n - 1],
  segment: segments[n - 1],
  variant: "VX",
  fuelType: n % 2 === 0 ? "DIESEL" : "PETROL",
  color: ["White", "Silver", "Grey", "Blue", "Black"][n - 1],
  year: 2019 + n,
  notes: `Seed vehicle ${n}`,
}));

const segPrice = (base) => ({
  HATCHBACK: base,
  SEDAN: Math.round(base * 1.15),
  SUV: Math.round(base * 1.35),
  LUXURY: Math.round(base * 1.8),
  MUV: Math.round(base * 1.25),
  COMPACT_SUV: Math.round(base * 1.28),
  BIKE: Math.round(base * 0.55),
});

const serviceCategories = [1, 2, 3, 4, 5].map((n) => ({
  id: `cat-00${n}`,
  name: ["Wash & foam", "Interior care", "Paint protection", "Engine bay", "Ceramic coating"][n - 1],
  slug: ["wash", "interior", "ppf", "engine", "ceramic"][n - 1],
  order: n,
  bikeOnly: false,
}));

/** 5 main services (Service selection + trending); not add-ons */
const mainServices = [1, 2, 3, 4, 5].map((n) => {
  const base = 800 + n * 150;
  const consumptionByN =
    n <= 3
      ? [
          {
            partId: "part-002",
            partName: "Engine oil 5W30",
            quantityPerCar: [0.5, 0.35, 0.25][n - 1],
            unit: "L",
          },
        ]
      : undefined;
  return {
    id: `srv-00${n}`,
    name: ["Exterior wash", "Full interior detail", "AC refresh", "Paint correction", "Ceramic coat"][n - 1],
    description: `Seed main service ${n} (wizard: Select service).`,
    defaultPrice: base,
    segmentPricing: segPrice(base),
    category: `cat-00${((n - 1) % 5) + 1}`,
    isAddon: false,
    scope: "GLOBAL",
    isActive: true,
    isHighEnd: n >= 4,
    incentivePercent: 8 + n,
    durationMinutes: 30 + n * 10,
    maxDurationMinutes: 40 + n * 12,
    gstApplicable: true,
    gstPercent: 18,
    ...(consumptionByN ? { consumptionProfile: consumptionByN } : {}),
  };
});

/** 5 add-on services (wizard: Add-ons optional) */
const addonServices = [1, 2, 3, 4, 5].map((n) => {
  const base = 299 + n * 75;
  return {
    id: `srv-a0${n}`,
    name: ["Engine flush add-on", "Tire shine", "Odour treatment", "Underbody rinse", "Glass sealant add-on"][n - 1],
    description: `Seed add-on ${n}.`,
    defaultPrice: base,
    segmentPricing: segPrice(base),
    category: `cat-00${((n + 1) % 5) + 1}`,
    isAddon: true,
    scope: "GLOBAL",
    isActive: true,
    isHighEnd: false,
    incentivePercent: 5,
    durationMinutes: 15 + n * 5,
    gstApplicable: true,
    gstPercent: 18,
  };
});

const serviceCatalog = [...mainServices, ...addonServices];

const jobStatuses = ["RECEIVED", "INSPECTION", "AWAITING_SERVICE", "QUALITY_CHECK", "DELIVERED"];
const branchRot = ["br-main", "br-002", "br-003", "br-004", "br-005"];

const jobCards = [1, 2, 3, 4, 5].map((n) => {
  const id = `jc-00${n}`;
  const jcN = `JC-2026-${String(100 + n)}`;
  const services =
    n === 1
      ? [1, 2, 3, 4, 5].map((i) => ({
          id: `si-${id}-${i}`,
          jobCardId: id,
          serviceCatalogId: `srv-00${i}`,
          name: mainServices[i - 1].name,
          price: mainServices[i - 1].defaultPrice,
          isCompleted: i <= 3,
          completedAt:
            i <= 3 ? iso(new Date(Date.UTC(2026, 3, 8 + i, 11, 0, 0))) : undefined,
          durationMinutes: 40 + i * 5,
        }))
      : [
          {
            id: `si-${id}-1`,
            jobCardId: id,
            serviceCatalogId: `srv-00${n}`,
            name: mainServices[n - 1].name,
            price: mainServices[n - 1].defaultPrice,
            isCompleted: n === 5,
            completedAt: n === 5 ? iso(new Date(Date.UTC(2026, 3, 15, 16, 0, 0))) : undefined,
            durationMinutes: 45,
          },
        ];
  const estimatedAmount = Math.round(services.reduce((s, line) => s + line.price, 0) * 100) / 100;
  return {
    id,
    jobNumber: jcN,
    branchId: branchRot[n - 1],
    customerId: `cust-00${n}`,
    customerName: `Test Customer ${n}`,
    customerPhone: `+91987654320${n}`,
    vehicleId: `veh-00${n}`,
    vehicleRegNumber: `KA01AB${1000 + n}`,
    vehicleMakeModel: `${vehicles[n - 1].make} ${vehicles[n - 1].model}`,
    vehicleSegment: segments[n - 1],
    mechanicId: n % 2 === 0 ? "usr-004" : "usr-003",
    mechanicName: n % 2 === 0 ? "Sunil Mechanic" : "Ravi Mechanic",
    status: jobStatuses[n - 1],
    reportedIssues: n === 1 ? "Minor scratches on bumper" : "Routine service",
    odometerReading: 12000 + n * 500,
    expectedDelivery: iso(new Date(Date.UTC(2026, 3, 16 + n, 18, 0, 0))),
    actualDelivery: n === 5 ? iso(new Date(Date.UTC(2026, 3, 15, 17, 0, 0))) : undefined,
    services,
    estimatedAmount,
    incentivePercent: 10,
    incentiveAmount: Math.round(estimatedAmount * 0.1),
    termsAndConditions: "Standard workshop T&C apply.",
    notes: `Seed job ${n}`,
    createdBy: "usr-admin",
    createdAt: iso(new Date(Date.UTC(2026, 3, 10 + n, 9, 0, 0))),
    updatedAt: iso(new Date(Date.UTC(2026, 3, 14 + n, 11, 0, 0))),
  };
});

const quotations = [1, 2, 3, 4, 5].map((n) => ({
  id: `qt-00${n}`,
  quotationNumber: `QT-2026-${200 + n}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  customerPhone: `+91987654320${n}`,
  vehicleId: `veh-00${n}`,
  vehicleRegNumber: `KA01AB${1000 + n}`,
  vehicleMakeModel: `${vehicles[n - 1].make} ${vehicles[n - 1].model}`,
  vehicleSegment: segments[n - 1],
  services: [
    {
      serviceCatalogId: `srv-00${n}`,
      name: mainServices[n - 1].name,
      price: mainServices[n - 1].defaultPrice,
    },
  ],
  subtotal: 4000 + n * 600,
  taxRate: 18,
  taxAmount: Math.round((4000 + n * 600) * 0.18),
  grandTotal: Math.round((4000 + n * 600) * 1.18),
  status: n === 5 ? "CONVERTED" : "SENT",
  sentViaWhatsApp: n % 2 === 0,
  customerApproved: n === 3,
  convertedToJobCardId: n === 5 ? "jc-005" : undefined,
  validUntil: day(30),
  createdBy: "usr-admin",
  createdAt: iso(new Date(Date.UTC(2026, 3, 5 + n, 10, 0, 0))),
  updatedAt: iso(new Date(Date.UTC(2026, 3, 8 + n, 10, 0, 0))),
}));

const invoices = [1, 2, 3, 4, 5].map((n) => {
  const sub = 4500 + n * 700;
  const tax = Math.round(sub * 0.18);
  const grand = sub + tax;
  return {
    id: `inv-00${n}`,
    invoiceNumber: `INV-2026-${300 + n}`,
    jobCardId: `jc-00${n}`,
    jobNumber: jobCards[n - 1].jobNumber,
    customerId: `cust-00${n}`,
    customerName: `Test Customer ${n}`,
    customerPhone: `+91987654320${n}`,
    vehicleRegNumber: `KA01AB${1000 + n}`,
    lineItems: [
      {
        id: `li-inv-${n}-1`,
        description: mainServices[n - 1].name,
        type: "SERVICE",
        quantity: 1,
        unitPrice: sub,
        total: sub,
      },
    ],
    subtotal: sub,
    taxRate: 18,
    taxAmount: tax,
    discountAmount: 0,
    rewardDiscount: n === 2 ? 100 : 0,
    walletAmountUsed: 0,
    grandTotal: grand - (n === 2 ? 100 : 0),
    status: n <= 2 ? "PAID" : n === 3 ? "PARTIALLY_PAID" : "ISSUED",
    payments:
      n <= 2
        ? [
            {
              id: `pay-${n}-1`,
              invoiceId: `inv-00${n}`,
              amount: grand - (n === 2 ? 100 : 0),
              method: "UPI",
              referenceNumber: `UPI${n}REF`,
              paidAt: iso(new Date(Date.UTC(2026, 3, 12 + n, 14, 0, 0))),
            },
          ]
        : n === 3
          ? [
              {
                id: `pay-${n}-1`,
                invoiceId: `inv-00${n}`,
                amount: Math.round(grand * 0.4),
                method: "CASH",
                paidAt: iso(new Date(Date.UTC(2026, 3, 13, 12, 0, 0))),
              },
            ]
          : [],
    mechanicName: n % 2 === 0 ? "Sunil Mechanic" : "Ravi Mechanic",
    createdAt: iso(new Date(Date.UTC(2026, 3, 11 + n, 15, 0, 0))),
  };
});

const appointments = [1, 2, 3, 4, 5].map((n) => ({
  id: `apt-00${n}`,
  bookingId: `bk-00${n}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  customerPhone: `+91987654320${n}`,
  vehicleId: `veh-00${n}`,
  vehicleRegNumber: `KA01AB${1000 + n}`,
  vehicleMakeModel: `${vehicles[n - 1].make} ${vehicles[n - 1].model}`,
  serviceType: mainServices[n - 1].name,
  mechanicId: "usr-003",
  mechanicName: "Ravi Mechanic",
  date: day(n),
  time: `${9 + n}:00`,
  status: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "SCHEDULED"][n - 1],
  notes: `Appointment seed ${n}`,
  whatsappSent: true,
  createdAt: iso(new Date(Date.UTC(2026, 3, 1 + n, 8, 0, 0))),
  customerFirstName: `Customer${n}`,
  priceSubtotalExGst: 3000 + n * 400,
  priceGstAmount: Math.round((3000 + n * 400) * 0.18),
  priceGrandTotal: Math.round((3000 + n * 400) * 1.18),
}));

const expenses = [1, 2, 3, 4, 5].map((n) => ({
  id: `exp-00${n}`,
  title: ["Rent April", "Consumables", "Power bill", "Marketing", "Tooling"][n - 1],
  category: ["RENT", "SUPPLIES", "UTILITIES", "MARKETING", "MAINTENANCE"][n - 1],
  description: `Seed expense ${n}`,
  amount: 5000 + n * 1200,
  amountPaid: n === 4 ? 2000 : undefined,
  date: day(-n * 2),
  vendorName: `Vendor Seed ${n}`,
  paymentStatus: n === 4 ? "PARTIAL" : "PAID",
  paymentMethod: "BANK_TRANSFER",
  createdBy: "usr-admin",
  createdByName: "Administrator",
  branchId: branchRot[n - 1],
  createdAt: iso(new Date(Date.UTC(2026, 3, 2 + n, 9, 0, 0))),
}));

const activityLogs = [1, 2, 3, 4, 5].map((n) => ({
  id: `log-00${n}`,
  action: ["CREATED", "UPDATED", "STATUS_CHANGED", "PAYMENT_RECEIVED", "COMPLETED"][n - 1],
  entityType: ["JOB_CARD", "CUSTOMER", "JOB_CARD", "INVOICE", "JOB_CARD"][n - 1],
  entityId: n % 2 === 1 ? `jc-00${n}` : `cust-00${n}`,
  entityLabel: n % 2 === 1 ? jobCards[n - 1].jobNumber : `Test Customer ${n}`,
  userId: "usr-admin",
  userName: "Administrator",
  details: `Seed activity ${n}`,
  createdAt: iso(new Date(Date.UTC(2026, 3, 3 + n, 10, 30, 0))),
}));

const serviceReminders = [1, 2, 3, 4, 5].map((n) => ({
  id: `rem-00${n}`,
  vehicleId: `veh-00${n}`,
  vehicleRegNumber: `KA01AB${1000 + n}`,
  vehicleMakeModel: `${vehicles[n - 1].make} ${vehicles[n - 1].model}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  customerPhone: `+91987654320${n}`,
  type: ["GENERAL_SERVICE", "OIL_CHANGE", "AC_SERVICE", "TIRE_ROTATION", "INSURANCE"][n - 1],
  frequency: "YEARLY",
  dueDate: day(20 + n * 5),
  lastServiceDate: day(-60 - n * 10),
  lastJobCardId: `jc-00${n}`,
  status: ["UPCOMING", "DUE", "UPCOMING", "OVERDUE", "UPCOMING"][n - 1],
  isHighEndService: n === 5,
  notes: `Seed reminder ${n}`,
}));

const walletTransactions = [1, 2, 3, 4, 5].map((n) => ({
  id: `wtx-00${n}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  type: n % 2 === 0 ? "DEBIT" : "CREDIT",
  amount: 100 * n,
  source: ["REFERRAL_REWARD", "INVOICE_PAYMENT", "LOYALTY_POINTS", "ADMIN_CREDIT", "REFUND"][n - 1],
  referenceId: n > 2 ? `jc-00${n}` : undefined,
  description: `Seed wallet txn ${n}`,
  balanceAfter: 500 + n * 200,
  createdAt: iso(new Date(Date.UTC(2026, 3, 4 + n, 12, 0, 0))),
}));

const partCategories = ["Detailing", "Lubricants", "Filters", "Body", "Electrical"];
const parts = [1, 2, 3, 4, 5].map((n) => {
  const base = {
    id: `part-00${n}`,
    name: ["Microfiber pack", "Engine oil 5W30", "Cabin filter", "Polish compound", "Wiring harness"][n - 1],
    sku: `SKU-SEED-${100 + n}`,
    category: partCategories[n - 1],
    quantity: 20 + n * 5,
    primaryUnit: "pcs",
    secondaryUnit: "box",
    conversionFactor: 12,
    unitPrice: 150 + n * 25,
    reorderLevel: 5,
    supplier: `Supplier ${n}`,
    lastRestocked: day(-n),
  };
  if (n === 2) {
    return {
      ...base,
      stockQuantityMl: 48000,
      reorderLevelMl: 8000,
    };
  }
  return base;
});

const stockMovements = [1, 2, 3, 4, 5].map((n) => ({
  id: `stk-00${n}`,
  partId: `part-00${n}`,
  type: n % 2 === 0 ? "OUT" : "IN",
  quantity: n * 2,
  unit: "pcs",
  reason: n % 2 === 0 ? `Job jc-00${n} consumption` : "Purchase receipt",
  jobCardId: n % 2 === 0 ? `jc-00${n}` : undefined,
  purchaseId: n % 2 === 1 ? `purch-00${n}` : undefined,
  performedBy: "usr-admin",
  createdAt: iso(new Date(Date.UTC(2026, 3, 6 + n, 16, 0, 0))),
}));

const productPurchases = [1, 2, 3, 4, 5].map((n) => ({
  id: `purch-00${n}`,
  partId: `part-00${n}`,
  vendorName: `Vendor ${n}`,
  quantityMl: n * 1000,
  unitCost: 80 + n * 10,
  reference: `PO-2026-${400 + n}`,
  purchasedAt: iso(new Date(Date.UTC(2026, 3, 7 + n, 11, 0, 0))),
  recordedBy: "usr-admin",
}));

const followUps = [1, 2, 3, 4, 5].map((n) => ({
  id: `fu-00${n}`,
  customerId: `cust-00${n}`,
  customerName: `Test Customer ${n}`,
  customerPhone: `+91987654320${n}`,
  lastVisitDate: day(-14 - n),
  daysSinceLastVisit: 14 + n,
  assignedTo: "usr-005",
  assignedToName: "Neha Reception",
  status: ["PENDING", "CALLED", "SCHEDULED", "NOT_INTERESTED", "REENGAGED"][n - 1],
  callNotes: n === 2 ? "Asked to call back next week" : undefined,
  nextCallbackDate: n <= 3 ? day(7) : undefined,
  createdAt: iso(new Date(Date.UTC(2026, 3, 1, 9, 0, 0))),
  updatedAt: iso(new Date(Date.UTC(2026, 3, 8 + n, 9, 0, 0))),
}));

const notifications = [1, 2, 3, 4, 5].map((n) => ({
  id: `notif-00${n}`,
  type: ["job_created", "job_status", "payment_received", "reminder", "customer_new"][n - 1],
  title: `Notification ${n}`,
  message: `Seed notification message ${n} for testing.`,
  read: n === 5,
  href: n === 1 ? "/job-cards" : n === 3 ? "/finance" : undefined,
  createdAt: iso(new Date(Date.UTC(2026, 3, 9 + n, 8, 0, 0))),
}));

const dashboardStats = {
  averageRating: 4.3,
  carsReceivedToday: 3,
  carsDeliveredToday: 2,
  inProgressServices: 4,
  dailyRevenue: 12500,
  totalExpensesToday: 2100,
  netProfitToday: 10400,
  newCustomersToday: 1,
  inactiveCustomers: 0,
  activeJobCards: 5,
  pendingPayments: 2,
  monthlyRevenue: [1, 2, 3, 4, 5].map((n) => ({
    month: `2026-0${n}`,
    revenue: 80000 + n * 12000,
    expenses: 20000 + n * 3000,
    profit: 60000 + n * 9000,
  })),
  serviceBreakdown: mainServices.map((s, i) => ({
    name: s.name,
    count: 3 + i,
  })),
  todaysBookings: [jobCards[0], jobCards[1]],
  readyForDelivery: [jobCards[3]],
};

const expenseMeta = {
  customCategories: ["Detailing supplies", "R&D"],
  categoryDescriptions: { RENT: "Shop rent", SUPPLIES: "Consumables" },
  vendorSuggestions: ["Acme Supplies", "PowerCo", "PrintShop"],
  vendorDirectory: [1, 2, 3, 4, 5].map((n) => ({
    id: `vend-00${n}`,
    name: `Directory Vendor ${n}`,
    contactPerson: `Contact ${n}`,
    phone: `+918000001${n}${n}0`,
    email: `vendor${n}@suppliers.test`,
    paymentTerms: "Net 15",
    address: `${n} Supply Street`,
    gstNumber: `29ABCDE1234F${n}Z${n}`,
  })),
};

const cashBank = {
  accounts: [1, 2, 3, 4, 5].map((n) => ({
    id: `acc-00${n}`,
    type: n === 1 ? "cash" : "bank",
    displayName: n === 1 ? "Cash" : `Bank account ${n}`,
    balance: 50000 + n * 15000,
    openingBalanceDate: day(-90),
    ...(n > 1
      ? {
          bankMeta: {
            accountNumber: `000${n}112233`,
            holderName: `My Detail OS ${n}`,
            ifsc: `HDFC0${n}0001`,
            bankName: "HDFC Bank",
            branchName: "MG Road",
            upiId: n === 2 ? "mydetailos@hdfc" : undefined,
          },
        }
      : {}),
  })),
  transactions: [1, 2, 3, 4, 5].map((n) => ({
    id: `cbtx-00${n}`,
    accountId: `acc-00${((n - 1) % 5) + 1}`,
    date: day(-n),
    rowType: n === 1 ? "OPENING" : "ADJUST_ADD",
    txnNo: `CB-${500 + n}`,
    party: `Party ${n}`,
    received: n === 1 ? 0 : 1000 * n,
    balanceAfter: 40000 + n * 8000,
    notes: `Seed cash/bank ${n}`,
  })),
};

const payroll = {
  salaryStructures: [1, 2, 3, 4, 5].map((n) => ({
    id: `ss-00${n}`,
    role: ["MECHANIC", "RECEPTIONIST", "BRANCH_MANAGER", "SUPERVISOR", "ADMIN"][n - 1],
    experienceBand: ["ENTRY", "MID", "SENIOR", "LEAD", "MID"][n - 1],
    label: `Band ${n} seed`,
    baseSalary: 18000 + n * 2500,
    attendanceBonusPerDay: 150 + n * 10,
    absenceDeductionPerDay: 400 + n * 20,
  })),
  payrollRecords: [1, 2, 3, 4, 5].map((n) => ({
    id: `pr-00${n}`,
    employeeId: staff[n - 1].id,
    employeeName: staff[n - 1].name,
    branchId: staff[n - 1].branchId,
    periodMonth: 4,
    periodYear: 2026,
    attendanceDays: 22 - n,
    presencePayment: 2000 + n * 100,
    baseSalary: 20000 + n * 2000,
    absenceDeduction: n * 200,
    grossEarnings: 25000 + n * 2500,
    totalDeductions: 1500 + n * 100,
    netSalaryBeforeAdvance: 23500 + n * 2400,
    advanceDeductionPlanned: 0,
    advanceDeductionFinalized: 0,
    advanceOutstandingBefore: 0,
    advanceOutstandingAfterPlanned: 0,
    advanceOutstandingAfterFinalized: 0,
    advanceRecoveryRefs: [],
    netSalary: 23500 + n * 2400,
    status: n === 5 ? "PENDING" : "PAID",
    salaryStructureId: `ss-00${n}`,
    createdAt: iso(new Date(Date.UTC(2026, 3, 1, 10, 0, 0))),
    updatedAt: iso(new Date(Date.UTC(2026, 3, 10, 10, 0, 0))),
  })),
  salaryAdvances: [
    {
      id: "sa-001",
      employeeId: staff[0].id,
      employeeName: staff[0].name,
      branchId: staff[0].branchId,
      advanceAmount: 6000,
      advanceDate: day(-20),
      monthlyDeductionAmount: 2000,
      recoveredAmount: 0,
      remainingAmount: 6000,
      status: "OPEN",
      notes: "Seed salary advance",
      createdAt: iso(new Date(Date.UTC(2026, 3, 5, 10, 0, 0))),
      updatedAt: iso(new Date(Date.UTC(2026, 3, 5, 10, 0, 0))),
    },
    {
      id: "sa-002",
      employeeId: staff[1].id,
      employeeName: staff[1].name,
      branchId: staff[1].branchId,
      advanceAmount: 4500,
      advanceDate: day(-12),
      recoveredAmount: 0,
      remainingAmount: 4500,
      status: "OPEN",
      createdAt: iso(new Date(Date.UTC(2026, 3, 8, 10, 0, 0))),
      updatedAt: iso(new Date(Date.UTC(2026, 3, 8, 10, 0, 0))),
    },
  ],
  salaryAdvanceRecoveries: [],
};

const membershipUsageHistory = [1, 2, 3, 4, 5].map((i) => ({
  usedAt: iso(new Date(Date.UTC(2026, 2, 5 + i, 14, 0, 0))),
  serviceCatalogId: `srv-00${i}`,
  serviceName: mainServices[i - 1].name,
  jobCardId: "jc-001",
}));

const membership = {
  packages: [1, 2, 3, 4, 5].map((n) => ({
    id: `mpkg-00${n}`,
    name: [`Silver ${n}m`, `Gold ${n}m`, `Platinum`, `Bike care`, `Fleet lite`][n - 1],
    tier: ["MONTHLY", "QUARTERLY", "YEARLY", "MONTHLY", "HALF_YEARLY"][n - 1],
    price: 1999 + n * 500,
    includedServiceIds: n < 5 ? [`srv-00${n}`, `srv-a0${n}`] : [`srv-001`, `srv-a05`],
    isActive: true,
    createdAt: iso(new Date(Date.UTC(2026, 2, n, 10, 0, 0))),
  })),
  subscriptions: [
    {
      id: "msub-001",
      customerId: "cust-001",
      packageId: "mpkg-001",
      startDate: day(-60),
      endDate: day(120),
      status: "ACTIVE",
      notes: "Active pass (vehicle) + 5 usage rows for MEMBERSHIP STATUS step",
      vehicleId: "veh-001",
      usageHistory: membershipUsageHistory,
    },
    {
      id: "msub-002",
      customerId: "cust-002",
      packageId: "mpkg-002",
      startDate: day(-20),
      endDate: day(200),
      status: "ACTIVE",
      notes: "Second active subscription",
      vehicleId: "veh-002",
    },
    {
      id: "msub-003",
      customerId: "cust-003",
      packageId: "mpkg-003",
      startDate: day(-400),
      endDate: day(-30),
      status: "EXPIRED",
      notes: "Expired (no wizard active pass)",
      vehicleId: "veh-003",
    },
    {
      id: "msub-004",
      customerId: "cust-004",
      packageId: "mpkg-004",
      startDate: day(-90),
      endDate: day(180),
      status: "CANCELLED",
      notes: "Cancelled",
      vehicleId: "veh-004",
    },
    {
      id: "msub-005",
      customerId: "cust-005",
      packageId: "mpkg-005",
      startDate: day(-10),
      endDate: day(350),
      status: "ACTIVE",
      notes: "Customer-wide pass (no vehicleId)",
    },
  ],
};

const collections = {
  jobCards,
  invoices,
  quotations,
  appointments,
  expenses,
  activityLogs,
  serviceReminders,
  walletTransactions,
  serviceCatalog,
  parts,
  stockMovements,
  productPurchases,
  followUps,
  serviceCategories,
  notifications,
  dashboardStats,
  expenseMeta,
  cashBank,
  payroll,
  membership,
};

const out = { branches, staff, customers, vehicles, collections };
writeFileSync(join(__dirname, "seed-data.json"), JSON.stringify(out, null, 2), "utf8");
console.log("Wrote prisma/seed-data.json");
