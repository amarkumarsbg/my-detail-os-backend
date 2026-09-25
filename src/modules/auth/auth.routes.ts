import { Router } from "express";
import {
  login,
  logout,
  me,
  patchMe,
  uploadMyAvatar,
  sendLoginOtp,
  verifyLoginOtp,
  forgotPassword,
  completePasswordReset,
  getResetPasswordTokenStatus,
  changePassword,
  getMyReportFavourites,
  putMyReportFavourites,
} from "./auth.controller.js";
import { requireAuth, requireAnyPermission } from "../../middleware/auth.js";
import { avatarUploadHandler } from "../../middleware/avatar-upload.js";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/logout", requireAuth, logout);
authRouter.post("/change-password", requireAuth, changePassword);
authRouter.post("/forgot-password", forgotPassword);
authRouter.get("/reset-password/status", getResetPasswordTokenStatus);
authRouter.post("/reset-password", completePasswordReset);
authRouter.post("/otp/send", sendLoginOtp);
authRouter.post("/otp/verify", verifyLoginOtp);
authRouter.get("/me", requireAuth, me);
authRouter.patch("/me", requireAuth, patchMe);
authRouter.post("/me/avatar", requireAuth, avatarUploadHandler, uploadMyAvatar);
authRouter.get(
  "/me/report-favourites",
  requireAuth,
  requireAnyPermission(["REPORTS", "ADVANCED_REPORTS"]),
  getMyReportFavourites
);
authRouter.put(
  "/me/report-favourites",
  requireAuth,
  requireAnyPermission(["REPORTS", "ADVANCED_REPORTS"]),
  putMyReportFavourites
);
