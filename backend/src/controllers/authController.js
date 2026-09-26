const asyncHandler = require("../utils/asyncHandler");
const authService = require("../services/authService");

/** Context recorded against an issued refresh token, to make sessions identifiable. */
function requestContext(req) {
  return { userAgent: req.headers["user-agent"], ipAddress: req.ip };
}

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  res.status(201).json({
    message: "Registration successful. Check your email for a verification code.",
    user,
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body, requestContext(req));
  res.json({ message: "Email verified", ...result });
});

const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body);
  res.json({ message: "If the account exists and is unverified, a code has been sent." });
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, requestContext(req));
  res.json({ message: "Login successful", ...result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body, requestContext(req));
  res.json({ message: "Session refreshed", ...result });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body);
  res.json({ message: "Logged out" });
});

const me = asyncHandler(async (req, res) => {
  res.json({
    user: req.user.toPublicJSON(),
    roles: req.access.roles,
    permissions: req.access.permissions,
  });
});

/** The account holder's own travel details, reused at checkout. */
const getProfile = asyncHandler(async (req, res) => {
  res.json({ profile: await authService.getProfile(req.user.id) });
});

const updateProfile = asyncHandler(async (req, res) => {
  const profile = await authService.updateProfile(req.user.id, {
    fullName: req.body.fullName,
    nid: req.body.nid,
    dateOfBirth: req.body.dateOfBirth,
  });
  res.json({ message: "Your travel details are saved", profile });
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
  refresh,
  logout,
  me,
  getProfile,
  updateProfile,
  forgotPassword,
  resetPassword,
};
