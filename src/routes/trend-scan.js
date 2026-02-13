// ======================================================
// 📈 /trend-scan — Trend Scanner PRO (Creator Intelligence Pro™)
// Endpoint stabile: POST / (montato su /api/trend-scan)
// Accetta body: { query, audience, depth } (compat frontend)
// ======================================================

import express from "express";
import { callAIModel } from "../services/aiEngine.js";

const router = express.Router();

async function handleTrendScan(req, res) {
  try {
    const {
      query = "salute e benessere",
      audience = "over60",
      depth = "standard", // "standard" | "deep"
      language = "it",
    } = req.body || {};

    if (!query || typeof query !== "string" || query.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Parametro 'query' mancante o non valido (min 3 caratteri).",
      });
    }

    // Mappa depth → modalità
    const mode = depth === "deep" ? "doubleDown" : "explore";
    const modeLabel =
      mode === "doubleDown"
        ? "vai più a fondo: angoli sottoutilizzati, cluster topic, format replicabili"
        : "scansiona la nicchia e intercetta i temi caldi emergenti";

    const prompt = `
Sei Creator Intelligence Pro™ (YouTube strategist).
Obiettivo: generare idee trend REALISTICHE senza inventare dati analytics.

NICCHIA/TEMA: "${query.trim()}"
AUDIENCE: ${audience} (Over 50/60/70)
LINGUA: ${language === "it" ? "Italiano" : "Inglese"}
MODALITÀ: ${mode} → ${modeLabel}

RESTITUISCI SOLO JSON valido (nessun testo fuori):
{
  "trendPrincipali": ["..."],
  "formatiCheFunzionano": ["..."],
  "ideeVideoLunghi": [
    {
      "titolo": "...",
      "angolo": "...",
      "percheFunzionaOver50": "...",
      "hookSuggerito": "..."
    }
  ],
  "ideeShorts": [
    { "titolo": "...", "concept": "...", "cta": "..." }
  ],
  "hookPatterns": ["..."],
  "erroriDaEvitare": ["..."],
  "calendarSuggerito": {
    "frequenza": "...",
    "giorniConsigliati": ["..."],
    "note": "..."
  },
  "noteStrategiche": "..."
}
`.trim();

    const extractJSON = (txt) => {
      try {
        const first = txt.indexOf("{");
        const last = txt.lastIndexOf("}");
        if (first === -1 || last === -1) return null;
        return JSON.parse(txt.substring(first, last + 1));
      } catch {
        return null;
      }
    };

    // Passata 1 (Groq se configurato in aiEngine)
    let raw = await callAIModel(prompt, "text", {
      provider: "groq",
      temperature: 0.25,
      maxTokens: 6500,
    });

    let parsed = extractJSON(raw);

    // Fallback OpenAI
    if (!parsed) {
      raw = await callAIModel(prompt, "text", {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.15,
        maxTokens: 7500,
      });
      parsed = extractJSON(raw);
    }

    if (!parsed) {
      return res.status(500).json({
        success: false,
        message: "AI ha prodotto JSON non valido in /trend-scan.",
        raw,
      });
    }

    return res.json({
      success: true,
      query: query.trim(),
      audience,
      depth,
      data: parsed,
    });
  } catch (err) {
    console.error("❌ /trend-scan ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Errore interno /trend-scan: " + err.message,
    });
  }
}

// Canonico (montato come /api/trend-scan)
router.post("/", handleTrendScan);
// Compat legacy
router.post("/trend-scan", handleTrendScan);

export default router;
