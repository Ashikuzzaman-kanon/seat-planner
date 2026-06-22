const { body } = require("express-validator");

const email = () =>
  body("email").isEmail().withMessage("A valid email is required").normalizeEmail();

const password = (field = "password") =>
  body(field)
    .isString()
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters");

const code = () =>
  body("code")
    .isString()
    .isLength({ min: 6, max: 6 })
    .withMessage("Verification code must be 6 digits");

const registerRules = [
  body("fullName").trim().notEmpty().withMessage("Full name is required"),
  email(),
  password(),
];

const verifyEmailRules = [email(), code()];
const resendRules = [email()];
const loginRules = [email(), body("password").notEmpty().withMessage("Password is required")];
const forgotPasswordRules = [email()];
const resetPasswordRules = [email(), code(), password("newPassword")];

module.exports = {
  registerRules,
  verifyEmailRules,
  resendRules,
  loginRules,
  forgotPasswordRules,
  resetPasswordRules,
};
