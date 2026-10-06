import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { AppError } from "../src/lib/app-error.js";
import { sanitizeInspectionImage } from "../src/modules/inspections/inspection-assets.service.js";
import { renderInspectionPdf } from "../src/modules/inspections/inspection-pdf.service.js";
import {
  assertInspectionComplete,
  snapshotInspectionPayload,
  validateInspectionPayload,
} from "../src/modules/inspections/inspection-validation.js";

const completeReport = {
  sections: [
    { id: "engine", checkpoints: [{ id: "oil", rating: "GOOD" }, { id: "noise", rating: "BAD" }] },
  ],
};

describe("inspection validation", () => {
  it("blocks empty and unchecked sections", () => {
    assert.throws(() => assertInspectionComplete({ sections: [] }), AppError);
    assert.throws(() => assertInspectionComplete({ sections: [{ checkpoints: [] }] }), AppError);
    assert.throws(() => assertInspectionComplete({ sections: [{ checkpoints: [{ rating: "NOT_CHECKED" }] }] }), AppError);
  });

  it("requires a reason for an overall override without bypassing completeness", () => {
    assert.throws(() => assertInspectionComplete({ ...completeReport, overallRatingOverride: "GOOD" }), AppError);
    assert.throws(() => assertInspectionComplete({
      sections: [{ checkpoints: [{ rating: "NOT_CHECKED" }] }],
      overallRatingOverride: "GOOD",
      overrideReason: "Customer requested it",
    }), AppError);
    assert.doesNotThrow(() => assertInspectionComplete({
      ...completeReport,
      overallRatingOverride: "GOOD",
      overrideReason: "Verified by supervisor",
    }));
  });

  it("uses worst severity and treats all N/A as N/A", () => {
    const snapshot = snapshotInspectionPayload({
      sections: [
        { checkpoints: [{ rating: "GOOD" }, { rating: "BAD" }] },
        { checkpoints: [{ rating: "N/A" }, { rating: "NOT_APPLICABLE" }] },
      ],
    });
    assert.equal((snapshot.sections as Array<{ computedRating: string }>)[0]!.computedRating, "BAD");
    assert.equal((snapshot.sections as Array<{ computedRating: string }>)[1]!.computedRating, "N/A");
    assert.equal(snapshot.computedOverallRating, "BAD");
    assert.equal(snapshotInspectionPayload({
      ...completeReport,
      overallRatingOverride: "GOOD",
      overrideReason: "Verified",
    }).computedOverallRating, "GOOD");
  });

  it("rejects unsupported ratings and negative odometer values", () => {
    assert.throws(() => validateInspectionPayload({ sections: [{ checkpoints: [{ rating: "EXCELLENT" }] }] }), AppError);
    assert.throws(() => validateInspectionPayload({ sections: [], odometerReading: -1 }), AppError);
  });

  it("decodes image contents, rejects MIME mismatches, and renders a PDF with photos", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const cleanImage = await sanitizeInspectionImage(png, "image/png");
    assert.equal(cleanImage.mimeType, "image/png");
    await assert.rejects(() => sanitizeInspectionImage(png, "image/jpeg"), AppError);
    await assert.rejects(() => sanitizeInspectionImage(Buffer.from("not an image"), "image/png"), AppError);

    const pdf = await renderInspectionPdf({
      reportNumber: "INSP-TEST",
      revision: 1,
      sections: [{ name: "Engine", computedRating: "GOOD", checkpoints: [{ name: "Oil", rating: "GOOD" }] }],
      computedOverallRating: "GOOD",
    }, [{ id: "photo-1", buffer: cleanImage.buffer, mimeType: cleanImage.mimeType }]);
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 1000);
  });
});