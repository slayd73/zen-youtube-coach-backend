import express from "express";

const router = express.Router();

/**
 * POST /api/diagnose-channel-primary-error
 */
async function handleDiagnosePrimaryError(req, res) {
  try {
    const body = req.body || {};

    // Placeholder: sostituisci con la tua logica reale
    return res.json({
      success: true,
      warning: false,
      result: {
        status: "success",
        analysis_scope: "system_check",
        primary_bottleneck: "OK",
        confidence_score: "HIGH",
        echo: body,
      },
    });
  } catch (err) {
    console.error("❌ diagnose-channel-primary-error error:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "Errore interno diagnosi",
    });
  }
}

// Canonico (montato come /api/diagnose-channel-primary-error)
router.post("/", handleDiagnosePrimaryError);
// Compat legacy
router.post("/diagnose-channel-primary-error", handleDiagnosePrimaryError);

export default router;
