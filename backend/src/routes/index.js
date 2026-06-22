const express = require("express");
const router = express.Router();

const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const { ALL_ROLES, ROLE_PERMISSIONS } = require("../constants/roles");

router.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Expose the role/permission matrix so the frontend can mirror it for UI gating.
router.get("/meta/roles", (_req, res) =>
  res.json({ roles: ALL_ROLES, permissions: ROLE_PERMISSIONS })
);

router.use("/auth", authRoutes);
router.use("/users", userRoutes);

module.exports = router;
