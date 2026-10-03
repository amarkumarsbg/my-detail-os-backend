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
  listMyWorkspaces,
  switchMyWorkspace,
  linkMyWorkspace,
  unlinkMyWorkspace,
  createMyWorkspaceBranch,
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
authRouter.get("/workspaces", requireAuth, listMyWorkspaces);
authRouter.post("/workspaces/switch", requireAuth, switchMyWorkspace);
authRouter.post("/workspaces/link", requireAuth, linkMyWorkspace);
authRouter.post("/workspaces/unlink", requireAuth, unlinkMyWorkspace);
authRouter.post("/workspaces/create", requireAuth, createMyWorkspaceBranch);
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
