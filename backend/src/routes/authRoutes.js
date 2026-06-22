const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const rules = require("../validators/authValidators");

router.post("/register", rules.registerRules, validate, authController.register);
router.post("/verify-email", rules.verifyEmailRules, validate, authController.verifyEmail);
router.post("/resend-verification", rules.resendRules, validate, authController.resendVerification);
router.post("/login", rules.loginRules, validate, authController.login);
router.post("/forgot-password", rules.forgotPasswordRules, validate, authController.forgotPassword);
router.post("/reset-password", rules.resetPasswordRules, validate, authController.resetPassword);

router.get("/me", authenticate, authController.me);

module.exports = router;
