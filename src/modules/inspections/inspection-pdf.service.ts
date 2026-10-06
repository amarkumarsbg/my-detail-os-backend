import PDFDocument from "pdfkit";
import sharp from "sharp";

export type InspectionPdfPhoto = {
  id: string;
  buffer: Buffer;
  mimeType: string;
};

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeBrandColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#167C80";
}

function checkpointLabel(value: unknown): string {
  if (!value || typeof value !== "object") return text(value);
  const checkpoint = value as Record<string, unknown>;
  return text(checkpoint.name ?? checkpoint.label ?? checkpoint.title ?? checkpoint.id) || "Checkpoint";
}

export async function renderInspectionPdf(
  report: Record<string, unknown>,
  photos: InspectionPdfPhoto[]
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, info: { Title: `Vehicle inspection ${text(report.reportNumber)}` } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const branding = report.organizationBranding && typeof report.organizationBranding === "object"
    ? report.organizationBranding as Record<string, unknown>
    : {};
  const primary = safeBrandColor(branding.brandPrimary);
  const width = doc.page.width - 88;
  const bottom = doc.page.height - 48;

  const ensureSpace = (height: number): void => {
    if (doc.y + height > bottom) doc.addPage();
  };
  const heading = (value: string): void => {
    ensureSpace(34);
    doc.moveDown(0.5).fillColor(primary).font("Helvetica-Bold").fontSize(13).text(value);
    doc.moveDown(0.25).fillColor("#202426").font("Helvetica").fontSize(9);
  };
  const line = (label: string, value: unknown): void => {
    const content = text(value);
    if (!content) return;
    ensureSpace(26);
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
    doc.font("Helvetica").text(content);
  };

  doc.fillColor(primary).font("Helvetica-Bold").fontSize(21).text(text(branding.businessName) || "Vehicle Inspection");
  const tagline = text(branding.businessTagline);
  if (tagline) doc.moveDown(0.2).fillColor("#596366").font("Helvetica").fontSize(9).text(tagline);
  doc.moveDown(0.5).fillColor("#202426").font("Helvetica-Bold").fontSize(16).text("Vehicle Inspection Report");
  doc.moveDown(0.4).font("Helvetica").fontSize(9);
  line("Report", report.reportNumber);
  line("Revision", report.revision);
  line("Inspection date", report.inspectionDate ?? report.date ?? report.createdAt);
  line("Branch", report.branchName);

  heading("Customer and vehicle");
  line("Customer", report.customerName);
  line("Phone", report.customerPhone);
  line("Email", report.customerEmail);
  line("Registration", report.vehicleRegistration ?? report.registrationNumber);
  line("Vehicle", report.vehicleMakeModel ?? [report.vehicleMake, report.vehicleModel].filter(Boolean).join(" "));
  line("Odometer", report.odometerReading ?? report.odometer);
  heading("Overall assessment");
  line("Rating", report.computedOverallRating);
  line("Override reason", report.overrideReason);

  const sections = Array.isArray(report.sections) ? report.sections : [];
  heading("Inspection checklist");
  for (const value of sections) {
    if (!value || typeof value !== "object") continue;
    const section = value as Record<string, unknown>;
    const title = text(section.name ?? section.title ?? section.label) || "Inspection section";
    ensureSpace(36);
    doc.fillColor(primary).font("Helvetica-Bold").fontSize(10).text(`${title}  |  ${text(section.computedRating)}`);
    doc.fillColor("#202426").font("Helvetica").fontSize(8);
    const checkpoints = Array.isArray(section.checkpoints) ? section.checkpoints : Array.isArray(section.items) ? section.items : [];
    for (const value of checkpoints) {
      const checkpoint = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const detail = [
        checkpointLabel(value),
        text(checkpoint.rating ?? checkpoint.conditionRating ?? checkpoint.severity),
        text(checkpoint.reading ?? checkpoint.value),
        text(checkpoint.remarks ?? checkpoint.remark ?? checkpoint.notes),
      ].filter(Boolean).join(" | ");
      ensureSpace(28);
      doc.text(`- ${detail}`, { width, continued: false });
    }
    doc.moveDown(0.35);
  }

  const remarks = text(report.remarks ?? report.overallRemarks);
  if (remarks) {
    heading("Remarks");
    doc.text(remarks, { width });
  }
  const terms = Array.isArray(report.terms) ? report.terms.map(text).filter(Boolean).join("\n") : text(report.terms);
  if (terms) {
    heading("Terms");
    doc.text(terms, { width });
  }

  if (photos.length > 0) {
    doc.addPage();
    heading("Inspection photos");
    for (const photo of photos) {
      ensureSpace(280);
      try {
        const image = await sharp(photo.buffer, { failOn: "error" }).rotate().jpeg({ quality: 88 }).toBuffer();
        doc.image(image, { fit: [width, 220], align: "center" });
        doc.moveDown(0.3).fillColor("#596366").fontSize(8).text(`Photo ${photo.id}`);
        doc.moveDown(0.8).fillColor("#202426");
      } catch {
        throw new Error(`Inspection photo ${photo.id} could not be embedded in the PDF.`);
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let page = 0; page < range.count; page++) {
    doc.switchToPage(range.start + page);
    doc.font("Helvetica").fontSize(7).fillColor("#596366").text(
      `Report ${text(report.reportNumber)}  |  Revision ${text(report.revision)}  |  Page ${page + 1} of ${range.count}`,
      44,
      doc.page.height - 30,
      { width, align: "right" }
    );
  }

  doc.end();
  return output;
}