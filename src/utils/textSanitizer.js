// src/utils/textSanitizer.js — UPDATED (2026-02-08)
// v20:
// - mantiene fixMojibake / cleanForFliki / wordCount (compat con tutto il backend)
// - aggiunge Quality Engine (computeQuality) per anti-ripetizione misurata
// - aggiunge trimToWordLimit, padDeterministicSmart (robusto, non “microfrasi ripetute”)

import crypto from "crypto";

// -------------------- Mojibake detection --------------------
function looksMojibake(s) {
  if (!s) return false;
  return /ÔÇ|â€|Ã.|Â.|├.|�/u.test(String(s));
}

function mojibakeScore(s) {
  const str = String(s || "");
  const patterns = [/ÔÇ/g, /â€/g, /Ã./g, /Â./g, /├./g, /\uFFFD/g];
  return patterns.reduce((acc, re) => acc + (str.match(re)?.length ?? 0), 0);
}

// -------------------- Public: fixMojibake --------------------
export function fixMojibake(input) {
  let s = String(input ?? "");

  if (!looksMojibake(s)) return s;

  let candidate = s;

  // tentativo: latin1 -> utf8
  try {
    const converted = Buffer.from(s, "latin1").toString("utf8");
    if (mojibakeScore(converted) < mojibakeScore(candidate)) candidate = converted;
  } catch {
    // ignore
  }

  // fix quote/simboli tipici mojibake
  candidate = candidate
    .replace(/ÔÇ£/g, '"')
    .replace(/ÔÇØ/g, '"')
    .replace(/ÔÇÖ/g, "'")
    .replace(/ÔÇô/g, "-")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€™/g, "'")
    .replace(/â€“/g, "-")
    .replace(/â€¦/g, "...");

  // fix cp437 italiano (àèìòù + maiuscole)
  const cp437Map = new Map([
    ["├á", "à"],
    ["├®", "è"],
    ["├¬", "ì"],
    ["├▓", "ò"],
    ["├╣", "ù"],
    ["├À", "À"],
    ["├ê", "È"],
    ["├ì", "Ì"],
    ["├Ò", "Ò"],
    ["├Ù", "Ù"],
  ]);
  for (const [bad, good] of cp437Map.entries()) {
    candidate = candidate.split(bad).join(good);
  }

  return candidate;
}

// -------------------- Public: cleanForFliki --------------------
export function cleanForFliki(raw) {
  let s = fixMojibake(String(raw ?? ""));

  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // rimuovi controlli strani (ma tieni \n e \t)
  s = s.replace(/[^\S\n\t]+/g, " ");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  // rimuovi label [Hook] ecc a inizio riga
  s = s.replace(/^\s*\[[^\]]{1,40}\]\s*:?/gim, "");

  // rimuovi heading tipo "HOOK:" "CTA:" ecc.
  s = s.replace(
    /^\s*(hook|intro|introduzione|parte|sezione|conclusione|cta)\s*[:\-]\s*/gim,
    ""
  );

  // riduci righe vuote infinite
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

// -------------------- Public: wordCount --------------------
export function wordCount(text) {
  const s = String(text ?? "").trim();
  if (!s) return 0;
  const tokens = s.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?/g);
  return tokens ? tokens.length : 0;
}

// -------------------- Public: debugId --------------------
export function debugId() {
  return crypto.randomBytes(4).toString("hex");
}

// -------------------- Public: trimToWordLimit --------------------
export function trimToWordLimit(text, limitWords) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= limitWords) return t;

  let cut = words.slice(0, limitWords).join(" ");

  // prova a chiudere su punteggiatura “vicina”
  const tail = cut.slice(Math.max(0, cut.length - 260));
  const lastPunct = Math.max(tail.lastIndexOf("."), tail.lastIndexOf("!"), tail.lastIndexOf("?"));
  if (lastPunct > 60) {
    cut = cut.slice(0, cut.length - (tail.length - lastPunct - 1)).trim();
  }

  return cut.trim();
}

// -------------------- Public: padDeterministicSmart --------------------
export function padDeterministicSmart(body, minWords, seed = "") {
  let t = String(body ?? "").trim();
  let wc = wordCount(t);
  if (wc >= minWords) return { text: t, smartPad: false };

  // IMPORTANT: fillers “lunghi e diversi” → evitano trigrammi ripetuti
  const fillers = [
    "Mini-regola pratica: usa il talk test. Se puoi parlare in frasi intere, sei nel ritmo giusto. Se devi spezzare le frasi, stai esagerando: rallenta e durerai di più.",
    "Errore classico: aumentare troppo in fretta. La costanza batte la motivazione: stessa ora, stessa durata per 7 giorni, poi aumenti di poco. Così il corpo non ti presenta il conto.",
    "Per ginocchia e schiena: passo più corto, spalle rilassate, appoggio morbido. Non stai cercando prestazione, stai costruendo un'abitudine sostenibile.",
    "Se salti un giorno, non recuperare. Riparti domani: la continuità è la vera vittoria. Il recupero aggressivo crea solo stanchezza e ti fa mollare.",
    "Trucco anti-molla: prepara le scarpe e i vestiti la sera prima. Riduci attrito e decisioni: quando è facile iniziare, è più facile restare costante.",
    "Se piove o fa freddo, non buttare la giornata: fai 10 minuti indoor, poi 5 di mobilità. L'obiettivo è non spezzare la catena, non fare l'eroe.",
  ];

  // ordine deterministico
  const h = hash32(String(seed) + "|" + t);
  for (let i = 0; i < fillers.length && wc < minWords; i++) {
    const idx = (h + i) % fillers.length;
    const add = fillers[idx];
    if (t.includes(add)) continue;
    t = (t + "\n\n" + add).trim();
    wc = wordCount(t);
  }

  // ultimo safety: se ancora corto, aggiungi micro-paragrafi variati (non una frase ripetuta)
  const micros = [
    "Segna i minuti su un foglio. Non per giudicarti: per vedere i progressi reali quando la testa ti dice che non stai migliorando.",
    "Se hai una giornata storta, dimezza i minuti ma non saltare. La costanza non è fare tanto: è fare sempre.",
    "La parte più importante non è la camminata perfetta. È la camminata possibile, ripetuta, che ti rimette in moto.",
  ];
  let j = 0;
  while (wc < minWords && j < 30) {
    t = (t + "\n\n" + micros[(h + j) % micros.length]).trim();
    wc = wordCount(t);
    j++;
  }

  return { text: t.trim(), smartPad: true };
}

function hash32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// =====================================================================
// ✅ Quality Engine (anti-ripetizione)
// =====================================================================

export function normalizeForCompare(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/[“”„]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s'"]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const raw = t
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // evita microfrasi inutili (tendono a ripetersi)
  return raw.filter((s) => normalizeForCompare(s).length >= 20);
}

export function tokenize(text) {
  const n = normalizeForCompare(text);
  if (!n) return [];
  return n.split(" ").filter(Boolean);
}

function ngramCounts(tokens, n = 3) {
  const m = new Map();
  for (let i = 0; i <= tokens.length - n; i++) {
    const key = tokens.slice(i, i + n).join(" ");
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

function repeatedNgramRatio(tokens, n = 3) {
  if (tokens.length < n * 3) return 0;
  const counts = ngramCounts(tokens, n);
  let total = 0;
  let repeated = 0;
  for (const [, c] of counts.entries()) {
    total += c;
    if (c >= 2) repeated += c;
  }
  return total ? repeated / total : 0;
}

function duplicateSentenceRatio(sentences) {
  if (!sentences.length) return 0;
  const seen = new Map();
  let dup = 0;
  for (const s of sentences) {
    const k = normalizeForCompare(s);
    if (!k) continue;
    if (seen.has(k)) dup++;
    else seen.set(k, 1);
  }
  return sentences.length ? dup / sentences.length : 0;
}

function highIncipitRepetitionRatio(sentences) {
  if (sentences.length < 6) return 0;
  const map = new Map();
  for (const s of sentences) {
    const n = normalizeForCompare(s);
    const first2 = n.split(" ").slice(0, 2).join(" ");
    if (!first2) continue;
    map.set(first2, (map.get(first2) || 0) + 1);
  }
  let max = 0;
  for (const [, c] of map.entries()) max = Math.max(max, c);
  return max / sentences.length;
}

const LAZY_PHRASES = [
  "immagina di",
  "in questo video",
  "oggi parleremo di",
  "scopriamo insieme",
  "andiamo a vedere",
  "ecco perché",
  "ma c'è di più",
  "in conclusione",
];

function lazyPhraseHits(text) {
  const n = normalizeForCompare(text);
  if (!n) return { hits: 0, matched: [] };
  const matched = [];
  for (const p of LAZY_PHRASES) if (n.includes(p)) matched.push(p);
  return { hits: matched.length, matched };
}

function trailerContractCheck(text) {
  const sents = splitSentences(text);
  const firstBlock = sents.slice(0, 6).join(" ");
  const n = normalizeForCompare(firstBlock);

  const promiseSignals = ["alla fine", "uscirai", "ti mostro", "saprai", "otterrai", "ti porto"];
  const hasPromise = promiseSignals.some((k) => n.includes(k));

  const first3 = sents.slice(0, 3).join(" ");
  const listy = (first3.match(/[:•\-]/g) || []).length >= 2;

  return {
    hasPromise,
    microNarrationOk: sents.length >= 3 ? !listy : false,
  };
}

export function computeQuality(text) {
  const sentences = splitSentences(text);
  const tokens = tokenize(text);

  const dupSent = duplicateSentenceRatio(sentences);
  const rep3 = repeatedNgramRatio(tokens, 3);
  const incipitRep = highIncipitRepetitionRatio(sentences);
  const lazy = lazyPhraseHits(text);
  const trailer = trailerContractCheck(text);

  let score = 100;
  score -= Math.round(dupSent * 90);
  score -= Math.round(rep3 * 80);
  score -= Math.round(incipitRep * 50);
  score -= Math.min(20, lazy.hits * 6);
  if (!trailer.hasPromise) score -= 18;
  if (!trailer.microNarrationOk) score -= 12;

  score = Math.max(0, Math.min(100, score));

  const flags = [];
  if (dupSent >= 0.08) flags.push("DUP_SENTENCES");
  if (rep3 >= 0.14) flags.push("REPEATED_TRIGRAMS");
  if (incipitRep >= 0.22) flags.push("REPEATED_INCIPIT");
  if (lazy.hits >= 2) flags.push("LAZY_PHRASES");
  if (!trailer.hasPromise) flags.push("MISSING_PROMISE");
  if (!trailer.microNarrationOk) flags.push("MICRO_NARRATION_WEAK");

  return {
    score,
    flags,
    metrics: {
      sentenceCount: sentences.length,
      tokenCount: tokens.length,
      dupSentenceRatio: Number(dupSent.toFixed(3)),
      repeatedTrigramRatio: Number(rep3.toFixed(3)),
      incipitRepetitionRatio: Number(incipitRep.toFixed(3)),
      lazyPhraseHits: lazy.hits,
      lazyPhraseMatched: lazy.matched,
      trailer,
    },
  };
}
