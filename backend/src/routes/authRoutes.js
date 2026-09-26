const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const authController = require("../controllers/authController");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const rules = require("../validators/authValidators");

router.post("/register", rules.registerRules, validate, authController.register);
router.post("/verify-email", rules.verifyEmailRules, validate, authController.verifyEmail);
router.post("/resend-verification", rules.resendRules, validate, authController.resendVerification);
router.post("/login", rules.loginRules, validate, authController.login);

// Session lifecycle. Access tokens are short-lived, so clients exchange a
// refresh token for a new pair; the presented token is rotated out.
router.post("/refresh", rules.refreshRules, validate, authController.refresh);
router.post("/logout", rules.refreshRules, validate, authController.logout);

router.post("/forgot-password", rules.forgotPasswordRules, validate, authController.forgotPassword);
router.post("/reset-password", rules.resetPasswordRules, validate, authController.resetPassword);

router.get("/me", authenticate, authController.me);

/*
 * Your own travel details. No permission: these are the account holder's own,
 * and every signed-in passenger needs them before they can buy anything.
 */
router.get("/profile", authenticate, authController.getProfile);
router.put(
  "/profile",
  authenticate,
  [
    body("fullName").optional().isString().trim().isLength({ min: 2, max: 120 }),
    body("nid").optional().matches(/^\d{10,17}$/).withMessage("National ID must be 10 to 17 digits"),
    body("dateOfBirth")
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage("Date of birth must look like YYYY-MM-DD"),
  ],
  validate,
  authController.updateProfile
);

module.exports = router;
