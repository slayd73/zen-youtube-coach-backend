// ======================================================
// 🔀 /compare-videos — Comparative Engine PRO
// Creator Intelligence Pro™ — Enterprise Stable
// ======================================================

import express from "express";
import { callAIModel } from "../services/aiEngine.js";
import { getTranscript } from "../services/transcriptService.js";

const router = express.Router();

/* -----------------------------------------------------
   Utility: Extract YouTube ID
----------------------------------------------------- */
function extractYouTubeId(input = "") {
  if (!input || typeof input !== "string") return null;

  if (/^[a-zA-Z0-9_-]{10,15}$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (url.searchParams.get("v")) return url.searchParams.get("v");
    if (url.hostname.includes("youtu.be")) return url.pathname.replace("/", "");
    if (url.pathname.startsWith("/shorts/"))
      return url.pathname.split("/shorts/")[1];
    return null;
  } catch {
    return null;
  }
}

/* -----------------------------------------------------
   Fetch transcript with safety limits
----------------------------------------------------- */
async function fetchVideoData(urlOrId, fallbackLabel) {
  const videoId = extractYouTubeId(urlOrId);
  if (!videoId) return null;

  try {
    const res = await getTranscript(videoId);

    let transcript = "Transcript non disponibile.";

    if (res?.success && res?.continuousText) {
      transcript = res.continuousText.slice(0, 8000);
      if (res.continuousText.length > 8000) {
        transcript += "\n[TRANSCRIPT TRUNCATED]";
      }
    }

    return {
      videoId,
      title: fallbackLabel,
      transcript,
    };
  } catch (err) {
    console.error("❌ Transcript error:", err.message);
    return null;
  }
}

/* -----------------------------------------------------
   SYSTEM PROMPT
----------------------------------------------------- */
const SYSTEM_PROMPT = `
Sei "Zen Compare Engine", motore di confronto video.

Regole:
- Se il transcript manca o è corto → punteggi bassi
- NON inventare dati
- "[TRANSCRIPT TRUNCATED]" non è penalizzante

Rispondi SOLO con JSON valido.
`;

/* -----------------------------------------------------
   JSON helpers
----------------------------------------------------- */
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* =====================================================
   🚀 POST /compare-videos  (ENDPOINT CORRETTO)
===================================================== */
router.post("/compare-videos", async (req, res) => {
  try {
    const {
      audience,
      videoA,
      videoB,
      labelA = "Video A",
      labelB = "Video B",
      focusMetric = "overall",
    } = req.body || {};

    if (!videoA || !videoB) {
      return res.status(400).json({
        success: false,
        error: "videoA e videoB sono obbligatori",
      });
    }

    if (!["over50", "over60", "over70"].includes(audience)) {
      return res.status(400).json({
        success: false,
        error: "Audience non valida",
      });
    }

    const [dataA, dataB] = await Promise.all([
      fetchVideoData(videoA, labelA),
      fetchVideoData(videoB, labelB),
    ]);

    if (!dataA || !dataB) {
      return res.status(400).json({
        success: false,
        error: "Impossibile recuperare transcript",
      });
    }

    const context = {
      audience,
      focusMetric,
      labelA,
      labelB,
      transcriptA: dataA.transcript,
      transcriptB: dataB.transcript,
    };

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify(context, null, 2),
      },
    ];

    const raw = await callAIModel({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
      maxTokens: 2000,
    });

    const parsed = extractJson(typeof raw === "string" ? raw : raw?.content);

    if (!parsed) {
      return res.status(500).json({
        success: false,
        error: "JSON AI non valido",
      });
    }

    parsed.success = true;
    parsed.meta = {
      audience,
      focusMetric,
      labelA,
      labelB,
    };

    return res.json(parsed);
  } catch (err) {
    console.error("🔥 /compare-videos error:", err);
    return res.status(500).json({
      success: false,
      error: "Errore interno compare-videos",
    });
  }
});

export default router;
