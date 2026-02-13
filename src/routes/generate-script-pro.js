// src/routes/generate-script-pro.js
// Slayd Intelligenceâ„¢ â€” Script Generator PRO (v25) â€” creative checklist + weak-block refinement
// Obiettivo: inRange SEMPRE true + qFinal >= 70 (realistico) + niente padding ripetitivo
// NOTE: usa wordCount() dal tuo textSanitizer.js (non regex esterna).

import express from "express";
import fsp from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import { callAIModel } from "../services/aiEngine.js";
import {
  fixMojibake,
  cleanForFliki,
  wordCount,
  trimToWordLimit,
  computeQuality,
} from "../utils/textSanitizer.js";

const router = express.Router();

const ROUTE_VERSION = "2026-02-13-wow-v25-creative-checklist";

// Target â€œparlatoâ€ che stai usando tu (non 147): 130 WPM
const DEFAULT_WPM = Number(process.env.GSP_TARGET_WPM || 130);

// Range stretto ma realistico per â€œsempre inRangeâ€
const MIN_FACTOR = Number(process.env.GSP_MIN_FACTOR || 0.94); // ~ 1100 su 1170
const MAX_FACTOR = Number(process.env.GSP_MAX_FACTOR || 1.06);

// Soglia per blocco (la tua UI sta chiedendo 170)
const MIN_BLOCK_WORDS = Number(process.env.GSP_MIN_BLOCK_WORDS || 170);

// Token budget
const MODEL_GROQ = String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile");
const MODEL_OPENAI = String(process.env.OPENAI_MODEL || "gpt-4o-mini");
const MAX_TOKENS_GROQ = Number(process.env.GSP_MAX_TOKENS_GROQ || 3600);
const MAX_TOKENS_OPENAI = Number(process.env.GSP_MAX_TOKENS_OPENAI || 3800);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

// Softfail demo (non crashare mai la demo)
const SOFTFAIL = String(process.env.GSP_SOFTFAIL || "1") === "1";

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function stripCodeFences(s) {
  let t = String(s ?? "").trim();
  t = t.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  return t;
}

function safeJsonParse(text) {
  try {
    const t = stripCodeFences(text);
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first === -1 || last === -1) return null;
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

function buildCTA(channelName) {
  // ASCII only, 1 sola frase â€œsenti il medicoâ€
  return [
    "Prima la sicurezza: se avverti dolore forte, capogiri, fiato corto anomalo o oppressione al petto, fermati e parlane col tuo medico.",
    "",
    'Se questo video ti e\' stato utile, scrivi nei commenti: "CAMMINO" e dimmi quanti minuti vuoi iniziare da domani.',
    "",
    `Sul canale ${channelName} trovi altri video pratici per vivere meglio dopo i 50/60/70 anni: uno passo alla volta.`,
  ].join("\n");
}

function buildHook(topic, channelName) {
  // Hook creativo: promessa concreta <= 25 parole + micro-narrazione <= 3 frasi + tensione reale.
  return [
    `In 30 giorni puoi camminare piu' stabile e con meno fiatone: oggi ti mostro il metodo pratico, senza sforzi inutili.`,
    `Ieri una signora di 67 anni si e' fermata al secondo isolato, convinta di "non farcela piu'".`,
    `Il problema non era l'eta': era un errore nascosto nel ritmo, quello che tra poco ti faccio vedere su ${topic}.`,
    "",
  ].join("\n");
}

function splitIntoBlocks(text) {
  // blocchi separati da doppia newline
  const parts = String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

function stitch7(blocks) {
  // Garantisce ESATTAMENTE 7 blocchi
  const out = [];
  for (let i = 0; i < 7; i++) out.push(String(blocks[i] ?? "").trim());
  return out;
}

function expansionPack(i, topic) {
  // Espansioni deterministicamente â€œdiverseâ€ (zero padding stupido).
  // Ogni pack ~ 70-110 parole, con incipit diversi per ridurre trigram repetition.
  const packs = [
    `Prova a pensarla cosi': non stai "allenandoti", stai ridando al tuo corpo un ritmo. Nei primi giorni l'obiettivo non e' la distanza, ma la regolarita'. Se oggi fai solo 12 minuti, va bene: il punto e' presentarsi all'appuntamento. E quando salti un giorno, non recuperare con il doppio: riparti normale. E' cosi' che in 30 giorni cambi davvero.`,
    `Un dettaglio che quasi nessuno considera: la camminata non e' uguale a tutte le ore. Se esci quando la testa e' piena, la camminata ti svuota. Se esci dopo pranzo, ti stabilizza. Se esci la sera, ti "abbassa" e ti prepara al sonno. Scegli un orario che puoi difendere anche nelle giornate storte. La costanza batte la perfezione, sempre.`,
    `Se hai paura di stancarti, usa un trucco semplice: respira dal naso finche' puoi. Quando devi aprire la bocca, rallenta di un 10%. Questo micro-aggiustamento ti evita il classico errore: partire troppo forte, andare in affanno, associare la camminata alla fatica e poi smettere. In 30 giorni vince chi rende facile il primo passo.`,
    `Guarda i piedi: se senti le ginocchia, spesso non e' "l'eta'". E' la meccanica. Passo piu' corto, appoggio morbido, spalle rilassate. E ogni 3 minuti fai un check rapido: mandibola sciolta, mani non serrate, respiro regolare. Sono micro-cose, ma sommate cambiano tutto: meno dolore, piu' fiducia, piu' voglia di uscire domani.`,
    `Quando diciamo "${topic}", la parola chiave e' "ogni giorno". Non per eroismo: per neurologia. Il cervello ama i rituali ripetibili. Se trasformi la camminata in una decisione quotidiana ("quando finisco il caffe', esco"), smetti di negoziare con te stesso. E quando non negozi, non crolli. Questo e' il vero vantaggio dei 30 giorni.`,
    `Un esercizio minuscolo durante la camminata: ogni tanto alza lo sguardo e scegli un punto lontano. Non e' poesia: e' postura. Il collo si allunga, il petto si apre, il respiro scende meglio. Molti over 60 camminano "chiusi" e poi si chiedono perche' si sentono rigidi. Aprirti cambia la sensazione del corpo in pochi minuti.`,
    `Se cammini con qualcuno, non farla diventare una gara. Usate la "frase guida": dobbiamo poter parlare senza ansimare. Se non ci riuscite, siete fuori zona. Riduci un filo e torna comodo. Questo ti permette di accumulare minuti senza stressare il corpo. Ed e' l'accumulo che in 30 giorni produce l'effetto WOW, non la singola uscita perfetta.`,
  ];
  return packs[i % packs.length];
}

function ensureBlockMinWords(block, idx, topic) {
  let b = String(block ?? "").trim();
  if (!b) {
    // blocco mancante: lo creiamo noi (deterministico, non AI)
    b = `Blocco ${idx + 1}. ${expansionPack(idx, topic)}`;
  }

  // se e' corto, lo espandiamo con 1-2 pack massimo (senza ripetere lo stesso testo)
  let wc = wordCount(b);
  if (wc >= MIN_BLOCK_WORDS) return b;

  const add1 = expansionPack(idx + 3, topic);
  b = `${b}\n\n${add1}`.trim();

  wc = wordCount(b);
  if (wc >= MIN_BLOCK_WORDS) return b;

  const add2 = expansionPack(idx + 5, topic);
  b = `${b}\n\n${add2}`.trim();

  return b.trim();
}

async function callAIWithFallback({ prompt, timeoutMs }) {
  const meta = { providerUsed: null, fallbackUsed: false, lastAIError: null };

  try {
    meta.providerUsed = "groq";
    const out = await callAIModel({
      provider: "groq",
      model: MODEL_GROQ,
      prompt,
      system:
        "Sei un autore/copywriter italiano per YouTube. Stile trailer emotivo ma concreto. Evita ripetizioni e frasi generiche. Rispetta la struttura richiesta.",
      temperature: 0.78,
      maxTokens: MAX_TOKENS_GROQ,
      jsonMode: false,
      timeoutMs,
      allowFallback: false,
    });
    return { text: out, meta };
  } catch (err) {
    const status = Number(err?.status || 500);
    meta.lastAIError = {
      provider: "groq",
      code: String(err?.code || "AI_CALL_ERROR"),
      status,
      message: String(err?.message || err),
    };

    // fallback SOLO su 429
    if (status !== 429 && meta.lastAIError.code !== "AI_RATE_LIMIT") {
      throw Object.assign(err, { _meta: meta });
    }

    meta.fallbackUsed = true;
    meta.providerUsed = "openai";
    const out2 = await callAIModel({
      provider: "openai",
      model: MODEL_OPENAI,
      prompt,
      system:
        "Sei un autore/copywriter italiano per YouTube. Stile trailer emotivo ma concreto. Evita ripetizioni e frasi generiche. Rispetta la struttura richiesta.",
      temperature: 0.72,
      maxTokens: MAX_TOKENS_OPENAI,
      jsonMode: false,
      timeoutMs,
      allowFallback: false,
    });
    return { text: out2, meta };
  }
}

function wordsList(text) {
  const s = String(text || "");
  return s.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || [];
}

function sentenceList(text) {
  const flat = String(text || "").replace(/\r/g, " ").replace(/\n+/g, " ").trim();
  if (!flat) return [];
  return (flat.match(/[^.!?]+[.!?]?/g) || [])
    .map((x) => x.trim())
    .filter(Boolean);
}

function containsAny(text, patterns) {
  const t = String(text || "").toLowerCase();
  return patterns.some((p) => t.includes(String(p).toLowerCase()));
}

function countHits(text, patterns) {
  const t = String(text || "").toLowerCase();
  let n = 0;
  for (const p of patterns) {
    if (t.includes(String(p).toLowerCase())) n++;
  }
  return n;
}

const TENSION_TERMS = [
  "errore",
  "fiatone",
  "dolore",
  "paura",
  "crollo",
  "mollare",
  "rigid",
  "stanco",
  "rischio",
  "problema",
];

const SURPRISE_TERMS = [
  "sorpr",
  "inaspett",
  "controintuitivo",
  "non e' quello che",
  "quasi nessuno",
  "non te lo aspetti",
  "colpo di scena",
];

const LOOP_TERMS = [
  "tra poco",
  "fra poco",
  "tra un attimo",
  "piu' avanti",
  "tra qualche minuto",
  "ti mostro tra poco",
];

const REVEAL_TERMS = [
  "ecco la rivelazione",
  "la verita' e'",
  "qui si capisce",
  "punto chiave nascosto",
  "il vero motivo",
];

const VISUAL_TERMS = [
  "corridoio",
  "specchio",
  "scarpe",
  "gradino",
  "porta",
  "cucina",
  "finestra",
  "respiro sul vetro",
];

const GENERIC_BANNED = [
  "puo migliorare il benessere",
  "puo' migliorare il benessere",
  "in generale",
  "e' importante",
  "stile di vita sano",
];

function concreteDetailsCount(text) {
  const t = String(text || "");
  const hits = [];
  const numMatches = t.match(/\b\d+\b/g) || [];
  if (numMatches.length) hits.push("numbers");
  if (/\b(minuti|minuto|giorni|settimana|settimane|percento|%)\b/i.test(t)) hits.push("time_units");
  if (/\b(caffe'|caffÃ¨|dopo pranzo|prima di cena|scarpe|corridoio|isolato|gradino)\b/i.test(t)) hits.push("routine_objects");
  if (/\b(7:30|8:00|9:00|10:00)\b/.test(t)) hits.push("time_slots");
  if (/\b(naso|spalle|ginocchia|mandibola|petto)\b/i.test(t)) hits.push("body_parts");
  return [...new Set(hits)].length;
}

function evaluateCreativeChecklist({ hook, blocks, scriptText }) {
  const allText = String(scriptText || "");
  const bodyText = blocks.join("\n\n");
  const hookWords = wordsList(hook);
  const hookFirst25 = hookWords.slice(0, 25).join(" ").toLowerCase();
  const hookSentences = sentenceList(hook);

  const hookPromiseConcrete =
    /(in\s+\d+\s+giorni|ti mostro|cosa cambia|puoi)/i.test(hookFirst25) &&
    /(fiatone|energia|respiro|stabile|dolore|gambe|equilibrio|sonno)/i.test(hookFirst25);
  const hookMicroNarration = hookSentences.length <= 3;
  const hookTension = containsAny(hook, TENSION_TERMS);

  const openLoopHits = countHits(bodyText, LOOP_TERMS);
  const openLoopsOk = openLoopHits >= 2;
  const revealWindow = [blocks[2] || "", blocks[3] || "", blocks[4] || ""].join(" ");
  const revealInSecondThird = containsAny(revealWindow, REVEAL_TERMS) || /la verita' e'/i.test(revealWindow);

  const bodySentences = sentenceList(bodyText);
  const lens = bodySentences.map((s) => wordsList(s).length).filter(Boolean);
  const hasShort = lens.some((n) => n <= 8);
  const hasMedium = lens.some((n) => n >= 10 && n <= 18);
  const rhythmAlternation = hasShort && hasMedium;
  const visualBlock = blocks.some((b) => countHits(b, VISUAL_TERMS) >= 2);
  const contrastMoment =
    containsAny(bodyText, ["qui quasi tutti sbagliano", "quasi tutti sbagliano", "errore classico"]);

  const detailsCount = concreteDetailsCount(allText);
  const hasSpecificity = detailsCount >= 3;
  const hasGenericBanned = containsAny(allText, GENERIC_BANNED);

  const wowHuman = /\b(io|tu|ti|noi|te)\b/i.test(allText);
  const wowCuriosity = openLoopHits >= 2 || allText.includes("?");
  const wowSurprise = containsAny(allText, SURPRISE_TERMS) || contrastMoment;

  const weakBlocks = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = String(blocks[i] || "");
    const hasTension = containsAny(b, TENSION_TERMS);
    const hasSurprise = containsAny(b, SURPRISE_TERMS) || containsAny(b, ["quasi tutti sbagliano", "controintuitivo"]);
    if (!hasTension || !hasSurprise) weakBlocks.push(i);
  }

  const missing = [];
  if (!hookPromiseConcrete) missing.push("hook.promise_concreta_entro_25");
  if (!hookMicroNarration) missing.push("hook.micro_narrazione_max_3_frasi");
  if (!hookTension) missing.push("hook.tensione_reale");
  if (!openLoopsOk) missing.push("open_loop.almeno_2");
  if (!revealInSecondThird) missing.push("open_loop.rivelazione_secondo_terzo");
  if (!rhythmAlternation) missing.push("ritmo.alternanza_frasi");
  if (!visualBlock) missing.push("ritmo.blocco_visivo");
  if (!contrastMoment) missing.push("ritmo.momento_contrasto");
  if (!hasSpecificity) missing.push("specificita.3_dettagli_concreti");
  if (hasGenericBanned) missing.push("specificita.niente_frasi_manuale");
  if (!wowHuman) missing.push("wow.suono_umano");
  if (!wowCuriosity) missing.push("wow.curiosita");
  if (!wowSurprise) missing.push("wow.sorpresa");

  return {
    pass: missing.length === 0,
    missing,
    needsTensionOrSurpriseFix: weakBlocks.length > 0,
    weakBlocks,
    checklist: {
      hook: {
        promiseConcreteWithin25: hookPromiseConcrete,
        microNarrationMax3Sentences: hookMicroNarration,
        tensionReal: hookTension,
      },
      openLoop: {
        atLeastTwoInternalLoops: openLoopsOk,
        revealInSecondThird,
        loopHits: openLoopHits,
      },
      ritmo: {
        shortMediumAlternation: rhythmAlternation,
        visualBlock,
        contrastMoment,
      },
      specificita: {
        concreteDetailsAtLeast3: hasSpecificity,
        detailsCount,
        genericPhrasesAbsent: !hasGenericBanned,
      },
      wow: {
        humanVoice: wowHuman,
        curiosity: wowCuriosity,
        surprise: wowSurprise,
      },
    },
  };
}

function enforceOpenLoops(blocks, topic) {
  const next = blocks.map((b) => String(b || "").trim());
  const full = next.join(" ").toLowerCase();
  let hits = countHits(full, LOOP_TERMS);

  if (hits < 1) {
    next[0] = `${next[0]}\n\nTra poco ti mostro il dettaglio pratico che cambia davvero il risultato in 30 giorni.`.trim();
    hits++;
  }
  if (hits < 2) {
    next[2] = `${next[2]}\n\nFra poco arrivo al passaggio che quasi tutti saltano e poi pagano con fiatone e stanchezza.`.trim();
  }

  const revealWindow = [next[2] || "", next[3] || "", next[4] || ""].join(" ").toLowerCase();
  if (!containsAny(revealWindow, REVEAL_TERMS)) {
    next[4] = `${next[4]}\n\nEcco la rivelazione: non devi spingere di piu', devi correggere il ritmo nei primi 4 minuti.`.trim();
  }

  return next;
}

function reinforceWeakBlock(block, idx, topic) {
  const packs = [
    "Qui quasi tutti sbagliano: accelerano nei primi due minuti e bruciano subito il fiato. La sorpresa? Rallentando un 10% all'inizio, resisti di piu' e finisci meglio.",
    "Dettaglio controintuitivo: non e' la distanza a salvarti, e' il ritmo. Se dopo pranzo fai 18 minuti con passo corto e spalle morbide, la sera senti meno pesantezza.",
    "Momento chiave: quando senti il fiatone, non fermarti subito. Fai 40 secondi piu' lenti, poi riparti. Sembra poco, ma e' il punto che trasforma la costanza.",
    "Rivelazione pratica: il primo segnale non e' il dolore, e' la rigidita' del collo. Se alzi lo sguardo e sciogli la mandibola, il respiro torna regolare in meno di un minuto.",
    `Su ${topic}, l'errore nascosto e' cercare la prestazione. Il risultato sorprendente arriva quando proteggi il ritmo e accumuli uscite, non quando fai l'uscita perfetta.`,
    "Qui il contrasto e' netto: chi punta all'eroismo molla in una settimana, chi punta alla regolarita' resta. E resta proprio perche' non forza.",
    "Sorpresa finale del blocco: il corpo risponde meglio ai micro-aggiustamenti che ai grandi sforzi. Tre correzioni piccole, fatte bene, battono una camminata fatta male.",
  ];
  return `${String(block || "").trim()}\n\n${packs[idx % packs.length]}`.trim();
}

async function improveWeakBlocks({ blocks, weakIndexes, topic, audience, timeoutMs }) {
  const unique = [...new Set((weakIndexes || []).filter((x) => Number.isInteger(x) && x >= 0 && x < blocks.length))];
  if (!unique.length) return { blocks, touched: [], repairedBy: "none" };

  const payload = unique.map((idx) => ({ index: idx, text: blocks[idx] }));
  const prompt = `
Sei Creative Script Architect per Slayd Intelligence.
Riscrivi SOLO i blocchi indicati mantenendo lo stesso tema (${topic}) e audience (${audience}).
Non toccare i blocchi non richiesti.

Checklist obbligatoria per ogni blocco riscritto:
- tensione reale e concreta
- una sorpresa o contrasto netto
- almeno un dettaglio pratico specifico (tempo, gesto, scenario)
- ritmo cinematografico, umano, niente frasi da manuale

Restituisci SOLO JSON valido:
{
  "rewrites": [
    { "index": 0, "text": "..." }
  ]
}

Blocchi deboli:
${JSON.stringify(payload, null, 2)}
`.trim();

  try {
    const { text } = await callAIWithFallback({ prompt, timeoutMs });
    const parsed = safeJsonParse(text);
    const rewrites = Array.isArray(parsed?.rewrites) ? parsed.rewrites : [];
    if (!rewrites.length) throw new Error("No rewrites in AI response");

    const next = [...blocks];
    const touched = [];

    for (const item of rewrites) {
      const idx = Number(item?.index);
      const value = String(item?.text || "").trim();
      if (!unique.includes(idx)) continue;
      if (!value) continue;
      next[idx] = ensureBlockMinWords(value, idx, topic);
      touched.push(idx);
    }

    if (!touched.length) throw new Error("AI rewrites did not match weak indexes");
    return { blocks: next, touched: [...new Set(touched)], repairedBy: "ai" };
  } catch {
    const next = [...blocks];
    for (const idx of unique) {
      next[idx] = ensureBlockMinWords(reinforceWeakBlock(next[idx], idx, topic), idx, topic);
    }
    return { blocks: next, touched: unique, repairedBy: "deterministic" };
  }
}

function parseFailReasons(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^FAIL reasons:/i.test(l.trim()));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("------------------------------------------------------------")) break;
    if (/^FINAL:/i.test(line)) break;
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

async function runScriptQualityAudit({ scriptText, audience, minutes }) {
  const toolPath = path.join(process.cwd(), "tools", "scriptQualityCheck.js");
  try {
    await fsp.access(toolPath);
  } catch {
    return {
      ran: false,
      pass: false,
      final: "SKIPPED",
      exitCode: null,
      failReasons: ["scriptQualityCheck_missing"],
    };
  }

  const tmpDir = path.join(process.cwd(), "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `script_quality_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.txt`
  );

  try {
    await fsp.writeFile(tmpFile, String(scriptText || ""), "utf8");

    const proc = spawnSync(
      process.execPath,
      [
        toolPath,
        tmpFile,
        `--audience=${audience || "over60"}`,
        `--minutes=${Number(minutes) || 9}`,
      ],
      { encoding: "utf8", timeout: 60000 }
    );

    const stdout = String(proc.stdout || "");
    const stderr = String(proc.stderr || "");
    const final = /FINAL:\s*PASS/i.test(stdout) ? "PASS" : "FAIL";

    return {
      ran: true,
      pass: final === "PASS" && Number(proc.status) === 0,
      final,
      exitCode: Number.isFinite(proc.status) ? proc.status : null,
      failReasons: parseFailReasons(stdout),
      stderr: stderr ? stderr.slice(0, 700) : "",
    };
  } catch (err) {
    return {
      ran: true,
      pass: false,
      final: "FAIL",
      exitCode: 1,
      failReasons: ["scriptQualityCheck_exec_error"],
      stderr: String(err?.message || err),
    };
  } finally {
    await fsp.unlink(tmpFile).catch(() => {});
  }
}

function buildFinalScriptFromBlocks({
  baseBlocks,
  topic,
  hook,
  cta,
  target,
  minBodyWords,
  maxBodyWords,
  minWords,
  maxWords,
}) {
  const blocks = [...baseBlocks];
  const ctaWc = wordCount(cta);

  let body = blocks.join("\n\n").trim();
  let bodyWc = wordCount(body);

  if (bodyWc < minBodyWords) {
    for (let k = 0; k < 4 && bodyWc < minBodyWords; k++) {
      const idx = (k * 2 + 1) % 7;
      blocks[idx] = `${blocks[idx]}\n\n${expansionPack(idx + 11 + k, topic)}`.trim();
      body = blocks.join("\n\n").trim();
      bodyWc = wordCount(body);
    }
  }

  if (bodyWc > maxBodyWords) {
    body = trimToWordLimit(body, maxBodyWords);
  }

  let finalScript = fixMojibake(`${hook}\n${body}\n\n${cta}`.trim());
  if (target === "fliki") finalScript = cleanForFliki(finalScript);

  let finalWc = wordCount(finalScript);

  if (finalWc > maxWords) {
    const allowedBodyWords = Math.max(240, maxWords - wordCount(hook) - ctaWc);
    const bodyTrimmed = trimToWordLimit(body, allowedBodyWords);
    finalScript = fixMojibake(`${hook}\n${bodyTrimmed}\n\n${cta}`.trim());
    if (target === "fliki") finalScript = cleanForFliki(finalScript);
    finalWc = wordCount(finalScript);
  }

  if (finalWc < minWords) {
    let minIdx = 0;
    let minBlockWc = Infinity;
    for (let i = 0; i < 7; i++) {
      const wc = wordCount(blocks[i]);
      if (wc < minBlockWc) {
        minBlockWc = wc;
        minIdx = i;
      }
    }
    blocks[minIdx] = `${blocks[minIdx]}\n\n${expansionPack(minIdx + 21, topic)}`.trim();
    body = blocks.join("\n\n").trim();
    finalScript = fixMojibake(`${hook}\n${body}\n\n${cta}`.trim());
    if (target === "fliki") finalScript = cleanForFliki(finalScript);
    finalWc = wordCount(finalScript);
  }

  return { blocks, body, finalScript, finalWc };
}

router.post("/generate-script-pro", async (req, res) => {
  const t0 = Date.now();

  try {
    const topic = String(req.body?.topic || "").trim();
    const language = String(req.body?.language || "it").trim().toLowerCase();
    const audience = String(req.body?.audience || "over60").trim().toLowerCase();

    // Accetta TUTTE le chiavi che stai usando in giro:
    const minutes = clampInt(
      req.body?.minutes ??
        req.body?.targetMinutes ??
        req.body?.estimatedDurationMinutes ??
        req.body?.estimatedDurationMinutesPreset ??
        req.body?.durationMinutes,
      7,
      12,
      9
    );

    const target = String(req.body?.target || "text").trim().toLowerCase(); // "fliki" o "text"
    const channelName = "Zen Salute e Benessere";

    if (!topic) {
      return res.status(400).json({
        success: false,
        warning: false,
        error: "MISSING_TOPIC",
        message: "Tema mancante: inserisci un topic.",
        meta: { routeVersion: ROUTE_VERSION, elapsedMs: Date.now() - t0 },
      });
    }

    if (language !== "it") {
      return res.status(400).json({
        success: false,
        warning: false,
        error: "ONLY_IT_SUPPORTED",
        message: "Questa route supporta solo language=it.",
        meta: { routeVersion: ROUTE_VERSION, elapsedMs: Date.now() - t0 },
      });
    }

    // Range parole (coerente con 130 WPM)
    const targetWords = Math.round(minutes * DEFAULT_WPM);
    const minWords = Math.round(targetWords * MIN_FACTOR);
    const maxWords = Math.round(targetWords * MAX_FACTOR);

    const hook = buildHook(topic, channelName);
    const cta = buildCTA(channelName);

    const ctaWc = wordCount(cta);
    const minBodyWords = Math.max(520, minWords - ctaWc);
    const maxBodyWords = Math.max(minBodyWords + 240, maxWords - ctaWc);

    // Prompt: chiediamo JSON con 7 blocchi testuali
    const prompt = `
TEMA: "${topic}"
PUBBLICO: ${audience}
LINGUA: Italiano

OUTPUT OBBLIGATORIO (SOLO JSON valido, senza testo fuori):
{
  "blocks": [
    "Blocco 1 (molto lungo, narrativo, pratico)",
    "Blocco 2 (molto lungo, narrativo, pratico)",
    "Blocco 3 (molto lungo, narrativo, pratico)",
    "Blocco 4 (molto lungo, narrativo, pratico)",
    "Blocco 5 (molto lungo, narrativo, pratico)",
    "Blocco 6 (molto lungo, narrativo, pratico)",
    "Blocco 7 (molto lungo, narrativo, pratico)"
  ]
}

REGOLE CRITICHE:
- Genera ESATTAMENTE 7 blocchi.
- Ogni blocco deve avere almeno ${MIN_BLOCK_WORDS + 25} parole (stai largo).
- Niente elenchi lunghi.
- Niente frasi generiche tipo "e' importante" / "in generale" / "non solo... ma anche...".
- Ogni blocco deve contenere: (1) un esempio reale, (2) un consiglio pratico immediato, (3) una transizione che aggancia il prossimo.
- Evita ripetizioni di incipit ("Immagina...", "Un altro...") a raffica.
`.trim();

    const { text: rawText, meta: aiMeta } = await callAIWithFallback({
      prompt,
      timeoutMs: AI_TIMEOUT_MS,
    });

    const parsed = safeJsonParse(rawText);
    let blocks = Array.isArray(parsed?.blocks) ? parsed.blocks.map((x) => String(x ?? "").trim()) : [];

    // Se l'AI non rispetta, non facciamo crollare la demo:
    // ricostruiamo 7 blocchi deterministici + espansioni.
    if (blocks.length < 7) {
      const repaired = [];
      for (let i = 0; i < 7; i++) repaired.push(String(blocks[i] ?? ""));
      blocks = repaired;
    }

    blocks = stitch7(blocks).map((b, i) => ensureBlockMinWords(b, i, topic));
    blocks = enforceOpenLoops(blocks, topic);

    let build = buildFinalScriptFromBlocks({
      baseBlocks: blocks,
      topic,
      hook,
      cta,
      target,
      minBodyWords,
      maxBodyWords,
      minWords,
      maxWords,
    });

    blocks = build.blocks;
    let finalScript = build.finalScript;
    let finalWc = build.finalWc;

    // Step obbligatorio: scriptQualityCheck
    const scriptQualityBefore = await runScriptQualityAudit({
      scriptText: finalScript,
      audience,
      minutes,
    });

    // Step obbligatorio: checklist creativa
    let creativeAudit = evaluateCreativeChecklist({
      hook,
      blocks,
      scriptText: finalScript,
    });

    let refinedWeakBlocks = [];
    let creativeRepairBy = "none";

    // Se manca tensione o sorpresa: migliora solo i blocchi deboli
    if (creativeAudit.needsTensionOrSurpriseFix) {
      const improved = await improveWeakBlocks({
        blocks,
        weakIndexes: creativeAudit.weakBlocks,
        topic,
        audience,
        timeoutMs: AI_TIMEOUT_MS,
      });

      if (improved.touched.length) {
        blocks = enforceOpenLoops(improved.blocks, topic);
        refinedWeakBlocks = improved.touched.map((x) => x + 1);
        creativeRepairBy = improved.repairedBy;

        build = buildFinalScriptFromBlocks({
          baseBlocks: blocks,
          topic,
          hook,
          cta,
          target,
          minBodyWords,
          maxBodyWords,
          minWords,
          maxWords,
        });

        blocks = build.blocks;
        finalScript = build.finalScript;
        finalWc = build.finalWc;
      }
    }

    const scriptQualityAfter =
      refinedWeakBlocks.length > 0
        ? await runScriptQualityAudit({
            scriptText: finalScript,
            audience,
            minutes,
          })
        : scriptQualityBefore;

    creativeAudit = evaluateCreativeChecklist({
      hook,
      blocks,
      scriptText: finalScript,
    });

    const qFinal = computeQuality(finalScript);
    const counts = blocks.map((b) => wordCount(b));
    const inRange = finalWc >= minWords && finalWc <= maxWords;

    const meta = {
      routeVersion: ROUTE_VERSION,
      providerUsed: aiMeta?.providerUsed || null,
      fallbackUsed: Boolean(aiMeta?.fallbackUsed),
      attempts: (aiMeta?.fallbackUsed ? 2 : 1) + (refinedWeakBlocks.length ? 1 : 0),
      totalCalls: (aiMeta?.fallbackUsed ? 2 : 1) + (refinedWeakBlocks.length ? 1 : 0),
      wordCount: finalWc,
      targetWords,
      minWords,
      maxWords,
      blockCounts: counts,
      minBlockWords: MIN_BLOCK_WORDS,
      inRange,
      quality: { final: qFinal },
      scriptQualityCheck: {
        before: scriptQualityBefore,
        after: scriptQualityAfter,
      },
      creativeChecklist: creativeAudit,
      creativeRefinement: {
        touchedBlocks: refinedWeakBlocks,
        repairBy: creativeRepairBy,
      },
      lastAIError: aiMeta?.lastAIError || null,
      elapsedMs: Date.now() - t0,
    };

    const warning =
      !inRange ||
      (qFinal?.flags?.length ? true : false) ||
      meta.fallbackUsed ||
      !scriptQualityAfter.pass ||
      !creativeAudit.pass;

    return res.status(200).json({
      success: true,
      warning,
      // compat per UI:
      finalScript,
      result: { script: finalScript },
      meta,
    });
  } catch (err) {
    const meta = err?._meta || null;

    if (!SOFTFAIL) {
      return res.status(500).json({
        success: false,
        warning: true,
        error: "GENERATION_FAILED",
        message: String(err?.message || err),
        meta: { routeVersion: ROUTE_VERSION, lastAIError: meta?.lastAIError || null },
      });
    }

    // softfail demo: non bloccare la UI
    const topic = String(req.body?.topic || "Benessere dopo i 60").trim();
    const channelName = "Zen Salute e Benessere";
    const hook = buildHook(topic, channelName);
    const cta = buildCTA(channelName);
    const fallbackScript = `${hook}\n${expansionPack(0, topic)}\n\n${expansionPack(2, topic)}\n\n${cta}`;

    return res.status(200).json({
      success: true,
      warning: true,
      finalScript: fallbackScript,
      result: { script: fallbackScript },
      meta: {
        routeVersion: ROUTE_VERSION,
        softfailUsed: true,
        softfailReason: "SERVER_ERROR",
        lastAIError: meta?.lastAIError || { message: String(err?.message || err) },
      },
    });
  }
});

export default router;


