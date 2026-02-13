// ============================================================================
// 🎬 /shorts-generator — Zen YouTube Coach Pro (ULTRA-PREMIUM 2025)
// Generatore Shorts: Hook, Script 45s, CTA, Testo sovraimpressione
// Con JSON Extractor + Auto-Fix + Profilazione Over 50/60/70
// ============================================================================

import express from "express";
import { callAIModel } from "../services/aiEngine.js";
import { getProfileByHandle, getDefaultProfile } from "../services/profileManager.js";

const router = express.Router();

// ----------------------------------------------------------------------
// 🔍 JSON EXTRACTOR — Estrae SOLO il primo oggetto JSON valido
// ----------------------------------------------------------------------
function extractJsonBlock(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return text.substring(start, end + 1);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// 🧪 Safe JSON Parse
// ----------------------------------------------------------------------
function tryParse(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// 🧠 Prompt Ultra-Premium per Shorts
// ----------------------------------------------------------------------
function buildPrompt(topic, transcript, audience) {
  const base = topic || transcript?.slice(0, 2000) || "";

  return `
Sei il miglior creatore di SHORTS YouTube d'Italia per pubblico Over 50 / Over 60 / Over 70.

Genera 5 idee potenti di Shorts basati sul seguente tema:
"${base}"

Requisiti:
- Hook immediato nei primi 1.5 secondi
- Script completo max 45-50 secondi
- Ritmo rapido
- Linguaggio semplice, empatico, orientato al beneficio
- Testo sovraimpresso: max 3-4 parole per slide
- CTA chiara e non banale
- Nessun commento esterno. Nessun markdown.
- Rispondi **SOLO** con JSON valido.

Formato JSON richiesto:

{
  "shorts": [
    {
      "titolo": "",
      "hookIniziale": "",
      "script": "",
      "testoSovraimpresso": ["", ""],
      "callToAction": ""
    }
  ]
}

Target: ${audience}
  `.trim();
}

// ----------------------------------------------------------------------
// 🛠️ ROUTE PRINCIPALE
// ----------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const {
      topic = "",
      transcript = "",
      audience = "over60",
      profileHandle = null
    } = req.body || {};

    if (!topic && !transcript) {
      return res.status(400).json({
        success: false,
        error: "❌ Devi fornire almeno 'topic' o 'transcript'."
      });
    }

    // Profilazione intelligente (respetta Over50/60/70)
    const profile = profileHandle
      ? getProfileByHandle(profileHandle)
      : getDefaultProfile(audience);

    const prompt = buildPrompt(topic, transcript, audience);

    // 🔥 CHIAMATA AL MODELLO — versione AI Engine PRO
    const aiRaw = await callAIModel({
      model: profile.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.55,
      max_tokens: 3500
    });

    // ------------------------------------------------------------------
    // 🧩 Estrazione JSON — Tentativo A
    // ------------------------------------------------------------------
    let block = extractJsonBlock(aiRaw);
    let parsed = block ? tryParse(block) : null;

    // Se JSON non valido → AUTO-FIX
    if (!parsed) {
      const fixPrompt = `
Hai generato JSON non valido.
Correggilo e rispondi SOLO con JSON valido, senza testo extra:

Testo da correggere:
${aiRaw}
      `.trim();

      const aiFix = await callAIModel({
        model: profile.model,
        messages: [{ role: "user", content: fixPrompt }],
        temperature: 0.2
      });

      block = extractJsonBlock(aiFix);
      parsed = block ? tryParse(block) : null;
    }

    if (!parsed) {
      return res.status(500).json({
        success: false,
        error: "❌ Impossibile generare JSON Shorts valido."
      });
    }

    // ------------------------------------------------------------------
    // 🟢 RISPOSTA FINALE STANDARD
    // ------------------------------------------------------------------
    res.json({
      success: true,
      meta: {
        audience,
        topicUsed: topic || "(estratto da transcript)",
        modelUsed: profile.model
      },
      data: parsed
    });

  } catch (err) {
    console.error("🔥 ERRORE /shorts-generator:", err);

    res.status(500).json({
      success: false,
      error: "Errore interno server in shorts-generator",
      details: err.message
    });
  }
});

export default router;
