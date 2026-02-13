// ======================================================
// 🩺 Health Check — Creator Intelligence Pro™ (FULL PREMIUM VERSION)
// ======================================================

import express from "express";
const router = express.Router();

// Risposta standard premium
function baseResponse() {
  return {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime(),
    memory: process.memoryUsage(),
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    app: "Creator Intelligence Pro™ — Backend",
    version: "Ultra-Premium 2025"
  };
}

// ----------------------
// ROUTE PRINCIPALE
// ----------------------
router.get("/", (req, res) => {
  res.status(200).json(baseResponse());
});

// ----------------------
// WILDCARD HANDLER
// ----------------------
router.get("/*", (req, res) => {
  res.status(200).json(baseResponse());
});

// Esporta router premium
export default router;
