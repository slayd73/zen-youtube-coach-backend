import express from "express";
import { extractYouTubeId, fetchTranscript } from "../services/youtubeTools.js";

const router = express.Router();

// POST /api/transcript (mounted by index.js)
// Accepts either:
// - { url: "https://youtube..." }
// - { transcript: "manual text..." } for frontend compatibility.
router.post("/", async (req, res) => {
  try {
    const { url, transcript } = req.body || {};

    if (typeof transcript === "string" && transcript.trim().length >= 20) {
      const clean = transcript.trim();
      return res.json({
        success: true,
        source: "manual",
        length: clean.length,
        transcript: clean,
      });
    }

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "URL mancante. Devi fornire un link YouTube o un transcript testuale.",
      });
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: "URL non valido. Impossibile estrarre il videoId.",
      });
    }

    const extracted = await fetchTranscript(videoId);
    if (!extracted) {
      return res.status(500).json({
        success: false,
        error: "Nessun transcript disponibile (tutti i livelli falliti).",
        details:
          "Possibile: video senza sottotitoli, HTML non accessibile, Whisper non attivo, fallback AI non disponibile.",
      });
    }

    return res.json({
      success: true,
      videoId,
      length: extracted.length,
      transcript: extracted,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Errore interno del server.",
      details: err?.message || "Unknown error",
    });
  }
});

router.get("/ping", (_req, res) => {
  res.json({
    ok: true,
    route: "/transcript/ping",
    message: "Transcript Engine attivo",
  });
});

export default router;
