// backend/src/routes/analyze-hook.js
import express from "express";
import { callAIModel } from "../services/aiEngine.js";
import { getTranscript } from "../services/transcriptService.js";

const router = express.Router();

/**
 * POST /api/analyze-hook
 * body: { videoUrl, language="it", audience="over60", seconds=60, model? }
 */
async function handleAnalyzeHook(req, res) {
  const t0 = Date.now();

  try {
    const {
      videoUrl,
      language = "it",
      audience = "over60",
      seconds = 60,
      model = "gpt-4o-mini",
    } = req.body || {};

    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({ success: false, error: "videoUrl mancante o non valido" });
    }

    // 1) Transcript (con cache/lock già integrati nel tuo transcriptService)
    const tr = await getTranscript(videoUrl, { language });

    const attempts = tr?.meta?.attempts || [];
    const transcriptText = (tr?.continuousText || "").trim();

    if (!tr?.success || transcriptText.length < 50) {
      return res.status(200).json({
        success: true,
        warning: true,
        result: {
          status: "NO_TRANSCRIPT",
          claim: "Transcript non disponibile o troppo corto per analisi hook.",
          evidence: "Senza testo sufficiente non posso valutare l’hook.",
        },
        _debug: {
          transcript_success: !!tr?.success,
          transcript_len: transcriptText.length,
          transcript_attempts: attempts,
        },
        meta: { elapsedMs: Date.now() - t0 },
      });
    }

    // 2) Estrai ~primi N secondi (stima parole)
    // Parlato medio 150–170 WPM. Per 60s ~150–170 parole.
    const targetWords = Math.max(80, Math.min(260, Math.round((seconds / 60) * 160)));
    const words = transcriptText.split(/\s+/).filter(Boolean);
    const hookSlice = words.slice(0, targetWords).join(" ");

    // 3) Prompt (JSON Mode)
    const system = [
      "Sei un analista YouTube data-driven e copywriter.",
      "Valuti SOLO l'hook (primi secondi) e proponi alternative migliori.",
      "Rispondi STRICTLY in JSON. Niente testo fuori dal JSON.",
    ].join(" ");

    const user = `
Analizza l'hook per pubblico ${audience} (Over 50 / Over 60 / Over 70). Lingua: ${language}.
Ti do l'inizio del transcript (stimato ~${seconds}s):

"""${hookSlice}"""

Dammi un JSON con questa struttura ESATTA:

{
  "hook_quality": "weak|medium|strong",
  "clarity_score": 0.0,
  "promise_detected": true,
  "problem_detected": true,
  "audience_alignment": "over50|over60|over70|generic",
  "main_issue": "string",
  "drop_risks": ["string", "..."],
  "micro_narration_present": true,
  "rewrite_hooks": [
    {
      "style": "trailer|direct|question",
      "text": "string (max 2 frasi, promessa chiara + problema reale)"
    }
  ],
  "opening_fix": "string (1-2 frasi per migliorare l'apertura subito dopo l'hook)"
}

Regole dure:
- clarity_score tra 0.0 e 1.0
- rewrite_hooks: minimo 3 varianti
- niente moralismi, niente teoria. Solo output pratico.
`.trim();

    const raw = await callAIModel({
      model,
      system,
      prompt: user,
      temperature: 0.5,
      maxTokens: 900,
      jsonMode: true,
    });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // fallback: se per qualsiasi motivo non è JSON puro
      return res.status(200).json({
        success: true,
        warning: true,
        result: {
          status: "AI_JSON_PARSE_FAIL",
          claim: "L'AI ha risposto ma non in JSON valido.",
          evidence: "Serve ritentare o stringere il prompt.",
        },
        _debug: {
          ai_raw: raw,
          transcript_attempts: attempts,
        },
        meta: { elapsedMs: Date.now() - t0 },
      });
    }

    return res.json({
      success: true,
      warning: false,
      result: {
        status: "OK",
        hook: parsed,
      },
      _debug: {
        transcript_provider: tr?.provider || tr?.provider,
        transcript_len: transcriptText.length,
        transcript_attempts: attempts,
        slice_words: targetWords,
      },
      meta: { elapsedMs: Date.now() - t0 },
    });
  } catch (err) {
    console.error("❌ /analyze-hook error:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: true,
      message: err?.message || "Errore interno",
    });
  }
}

// Canonico (montato come /api/analyze-hook)
router.post("/", handleAnalyzeHook);
// Compat legacy (evita rotture su client vecchi)
router.post("/analyze-hook", handleAnalyzeHook);

export default router;
