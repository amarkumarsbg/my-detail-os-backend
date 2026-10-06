import type { NextFunction, Request, Response } from "express";
import multer from "multer";

/** Vehicle inspection photos (before / after) — larger limit than profile avatars. */
export const INSPECTION_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INSPECTION_PHOTO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Please upload a JPEG, PNG, or WebP image."));
    }
  },
});

/** Multipart field `photo`; responds with 400 on multer errors (never calls next). */
export function inspectionPhotoUploadHandler(req: Request, res: Response, next: NextFunction): void {
  upload.single("photo")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          data: null,
          error: { message: "Photo must be 10 MB or smaller." },
        });
        return;
      }
      const msg = err instanceof Error ? err.message : "Upload failed.";
      res.status(400).json({ data: null, error: { message: msg } });
      return;
    }
    next();
  });
}
