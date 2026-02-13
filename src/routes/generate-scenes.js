// ======================================================================
// 🎬 /generate-scenes — ULTRA PREMIUM SCENE ENGINE 2025
// Validated by Senior AI Engineer
// ======================================================================

import express from "express";
import { callAIModel } from "../services/aiEngine.js";

const router = express.Router();

// ------------------------------------------------------
// 🧠 Utility: Parser JSON robusto
// ------------------------------------------------------
function tryParseJson(text) {
  try {
    // Se jsonMode è attivo, OpenAI restituisce quasi sempre JSON pulito.
    // Ma per sicurezza cerchiamo le graffe esterne.
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) {
      // Tentativo fallback: se non trova graffe, prova a parsare tutto
      return JSON.parse(text); 
    }
    return JSON.parse(text.slice(first, last + 1));
  } catch (err) {
    console.warn("⚠️ Parsing JSON fallito (fallback attivo):", err.message);
    return null;
  }
}

// ------------------------------------------------------
// 🧩 Smart Splitter (Accumulatore per ritmo Senior)
// ------------------------------------------------------
function splitIntoScenes(text) {
  // Pulisce newline e spazi multipli
  const cleanText = text.replace(/\s+/g, " ").trim();
  
  // Split basilare su punteggiatura forte (. ! ?)
  const sentences = cleanText.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [cleanText];

  const scenes = [];
  let chunk = "";
  // 180 chars ≈ 12-14 secondi di lettura calma. Perfetto per Over 60.
  const CHAR_LIMIT = 180; 

  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;

    // Se accumulando superiamo il limite E abbiamo già un po' di testo...
    if ((chunk.length + sentence.length) > CHAR_LIMIT && chunk.length > 50) {
      scenes.push(chunk);
      chunk = sentence; // Inizia nuovo blocco
    } else {
      chunk += (chunk ? " " : "") + sentence; // Accumula
    }
  }

  if (chunk) scenes.push(chunk);
  return scenes;
}

// ------------------------------------------------------
// 🎬 ROUTE PRINCIPALE
// ------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { script } = req.body;

    // Validazione Input Base
    if (!script || script.length < 50) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "❌ Script troppo corto. Inserisci almeno 2 frasi complete."
      });
    }

    // 1️⃣ Dividi in blocchi logici
    const blocks = splitIntoScenes(script);

    // GUARDRAIL: Prevenzione Timeout/Token Limit
    // GPT-4o ha un output limitato a 4096 token. Se abbiamo 50 scene, rischiamo il taglio.
    if (blocks.length > 40) {
      console.warn(`⚠️ Script molto lungo (${blocks.length} blocchi). Possibile taglio JSON.`);
      // In una versione v2, qui implementeremmo la paginazione (batching).
    }

    // 2️⃣ Prompt Premium (Ottimizzato per Visual Variety)
    const prompt = `
Sei un Director AI di alto livello per documentari (Target: Over 60).
Converti i seguenti blocchi di testo in un array JSON "scenes".

🎯 OBIETTIVO VISUAL (IMPORTANTE):
- Genera descrizioni per STOCK FOOTAGE (Adobe Stock / Storyblocks).
- Usa keyword in INGLESE.
- VARIA I SOGGETTI: Non usare sempre "anziana che sorride". Usa dettagli (mani, occhi, natura, oggetti, cibo, azioni).
- STILE: Cinematic, warm lighting, slow motion, photorealistic 4k.

⚠️ REGOLE JSON:
- Restituisci SOLO un oggetto JSON valido.
- Struttura:
{
  "scenes": [
    {
      "id": 1,
      "text": "testo narrato (identico all'input o leggermente pulito)",
      "visual": "descrizione visiva in inglese",
      "transition": "fade" | "dissolve" | "slide",
      "duration": numero intero (calcola circa 1 sec ogni 15 caratteri)
    }
  ]
}

BLOCCHI DA ELABORARE:
${blocks.map((t, i) => `[ID:${i + 1}] ${t}`).join("\n")}
`;

    // 3️⃣ Chiamata AI Enterprise
    const aiResponse = await callAIModel({
      model: "gpt-4o", // USO GPT-4o per qualità visuale superiore
      system: "Sei un backend JSON generator. Rispondi SOLO in JSON valido.",
      prompt,
      temperature: 0.3, // Basso per stabilità sintattica
      maxTokens: 4000,  // Massimo output possibile
      jsonMode: true    // Attivazione JSON Mode
    });

    // 4️⃣ Parsing
    const parsed = tryParseJson(aiResponse);

    if (!parsed || !parsed.scenes) {
      throw new Error("AI ha restituito un JSON non valido o incompleto.");
    }

    // 5️⃣ Risposta Successo
    return res.json({
      success: true,
      meta: {
        totalScenes: parsed.scenes.length,
        estimatedTotalDuration: parsed.scenes.reduce((acc, s) => acc + (s.duration || 0), 0)
      },
      scenes: parsed.scenes
    });

  } catch (err) {
    console.error("🔥 Errore generate-scenes:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Errore interno durante la generazione delle scene.",
      details: err.message || String(err)
    });
  }
});

export default router;