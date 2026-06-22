const asyncHandler = require("../utils/asyncHandler");
const authService = require("../services/authService");
const { permissionsForRole } = require("../constants/roles");

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  res.status(201).json({
    message: "Registration successful. Check your email for a verification code.",
    user,
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body);
  res.json({ message: "Email verified", ...result });
});

const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body);
  res.json({ message: "If the account exists and is unverified, a code has been sent." });
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json({ message: "Login successful", ...result });
});

const me = asyncHandler(async (req, res) => {
  res.json({
    user: req.user.toPublicJSON(),
    permissions: permissionsForRole(req.user.role),
  });
});

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  res.json({ message: "If the account exists, a reset code has been sent." });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: "Password reset successful. You can now log in." });
});

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  me,
  forgotPassword,
  resetPassword,
};
