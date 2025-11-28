// ======================================================
// 🚀 Zen YouTube Coach Pro — Backend Ultra Premium 2025
// Entry Point — index.js
// ======================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ---------------------------------------------
// Middleware
// ---------------------------------------------
app.use(express.json({ limit: "60mb" }));
app.use(cors());

// ---------------------------------------------
// IMPORT ROUTES
// ---------------------------------------------
import healthRoute from "./routes/health.js";
import transcriptRoute from "./routes/transcript.js";
import analyzeRoute from "./routes/analyze-transcript.js";
import compareVideosRoute from "./routes/compare-videos.js";
import trendDeepRoute from "./routes/trend-deepsearch.js";

// ---------------------------------------------
// HEALTH PRIMA DI TUTTO (Priority Route)
// ---------------------------------------------
app.use("/health", healthRoute);
app.use("/healthz", healthRoute);

// ---------------------------------------------
// TUTTE LE ALTRE API
// ---------------------------------------------
app.use("/transcript", transcriptRoute);
app.use("/analyze", analyzeRoute);
app.use("/compare-videos", compareVideosRoute);
app.use("/trend-deepsearch", trendDeepRoute);

// ---------------------------------------------
// Render PORT Fix
// ---------------------------------------------
const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0";

// ---------------------------------------------
// START
// ---------------------------------------------
app.listen(PORT, HOST, () => {
  console.log("============================================");
  console.log("🔥 Zen YouTube Coach Pro — Backend avviato");
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log(`🌐 Server attivo su: http://${HOST}:${PORT}`);
  console.log("============================================");
});
