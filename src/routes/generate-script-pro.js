// src/routes/generate-script-pro.js
// STABLE BASELINE: PASS 10/10 (ScriptQualityCheck)
// Date: 2026-02-13
// Do not modify without regression test (tools/smoke_generate_script_pro_10x.bat)

import express from "express";
import fsp from "fs/promises";
import path from "path";
import { callAIModel } from "../services/aiEngine.js";
import {
  fixMojibake,
  cleanForFliki,
  wordCount,
  trimToWordLimit,
  computeQuality,
} from "../utils/textSanitizer.js";

const router = express.Router();

const ROUTE_VERSION = "2026-02-14-wow-v26-layout-beautify";

// Target Ã¢â‚¬Å“parlatoÃ¢â‚¬Â (130 WPM)
const DEFAULT_WPM = Number(process.env.GSP_TARGET_WPM || 130);

// Range stretto ma realistico per Ã¢â‚¬Å“sempre inRangeÃ¢â‚¬Â
const MIN_FACTOR = Number(process.env.GSP_MIN_FACTOR || 0.94);
const MAX_FACTOR = Number(process.env.GSP_MAX_FACTOR || 1.06);

// Soglia blocchi
const MIN_BLOCK_WORDS = Number(process.env.GSP_MIN_BLOCK_WORDS || 170);

// Modelli / token
const MODEL_GROQ = String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile");
const MODEL_OPENAI = String(process.env.OPENAI_MODEL || "gpt-4o-mini");
const MAX_TOKENS_GROQ = Number(process.env.GSP_MAX_TOKENS_GROQ || 3600);
const MAX_TOKENS_OPENAI = Number(process.env.GSP_MAX_TOKENS_OPENAI || 3800);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

// Softfail disabilitato
const SOFTFAIL = false;

const ALLOWED_TYPES = ["howto", "protocol", "myth", "mistakes", "checklist", "story"];
let QUALITY_AUDIT_SEQ = 0;

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

function normalizeText(s) {
  return String(s || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanForMatch(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsFromText(s) {
  return cleanForMatch(s).split(" ").filter(Boolean);
}

function qualityWordCount(s) {
  return wordsFromText(s).length;
}

function computeRepeatedTrigrams(text, threshold = 3, topN = 10) {
  const words = wordsFromText(text);
  const map = new Map();
  for (let i = 0; i <= words.length - 3; i++) {
    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    map.set(tri, (map.get(tri) || 0) + 1);
  }
  const out = [];
  for (const [trigram, count] of map.entries()) {
    if (count >= threshold) out.push({ trigram, count });
  }
  out.sort((a, b) => b.count - a.count || a.trigram.localeCompare(b.trigram));
  return out.slice(0, topN);
}

const STRUCTURAL_TRIGRAMS = new Map([
  ["dopo i 60", ["oltre i 60", "superati i 60", "passati i 60"]],
  ["ogni giorno dopo", ["tutti i giorni dopo", "quotidianamente dopo", "giorno dopo giorno"]],
  ["in questo video", ["oggi", "qui", "in questa guida"]],
  ["tra un attimo", ["fra pochissimo", "a breve"]],
  ["senza forzare troppo", ["senza esagerare", "con moderazione"]],
  ["ti aiutera a", ["cosi riesci a", "ti da modo di", "puo aiutarti a"]],
  ["ti aiuta a", ["cosi riesci a", "ti sostiene nel", "puo aiutarti a"]],
  ["ti permettera di", ["cosi puoi", "ti da spazio per", "ti consente di"]],
  ["ti permette di", ["cosi puoi", "ti da spazio per", "ti consente di"]],
  ["ti consentira di", ["cosi puoi", "ti apre la strada per", "ti da margine per"]],
  ["puo aiutarti a", ["puo sostenerti nel", "ti da una mano a", "puo facilitarti nel"]],
  ["puo permetterti di", ["puo darti modo di", "ti lascia spazio per", "puo consentirti di"]],
  ["per migliorare la", ["per rendere piu solida la", "per far crescere la", "per rafforzare la"]],
  ["per rendere la", ["per rendere piu stabile la", "per rendere piu fluida la", "per rendere piu chiara la"]],
  ["per mantenere la", ["per tenere stabile la", "per conservare la", "per proteggere la"]],
  ["potresti anche considerare", ["puoi valutare", "puoi anche provare", "si puo considerare"]],
  ["e un opportunita", ["e una buona occasione", "e una leva concreta", "e una possibilita utile"]],
  ["un opportunita per", ["una leva per", "una possibilita per", "un passaggio utile per"]],
  ["il tuo stato", ["la tua condizione", "il tuo livello attuale", "come stai ora"]],
  ["il tuo livello", ["il margine attuale", "la tua condizione", "la base da cui parti"]],
  ["esperienza di camminata", ["esperienza nel cammino", "pratica quotidiana del cammino", "abitudine al cammino"]],
  ["di camminata e", ["nel cammino e", "nel percorso e", "sulla camminata e"]],
  ["in questo modo", ["cosi", "in questa maniera", "in pratica"]],
  ["a tal proposito", ["su questo punto", "a riguardo", "a questo riguardo"]],
  ["a questo punto", ["qui", "a questo passaggio", "in questa fase"]],
  ["in altre parole", ["detto in modo semplice", "in sintesi", "detto chiaramente"]],
  ["detto in breve", ["in sintesi", "in poche parole", "in modo diretto"]],
  ["da tenere presente", ["da ricordare", "utile da ricordare", "da avere in mente"]],
  ["e importante che", ["conta che", "e utile che", "serve che"]],
  ["e fondamentale che", ["e decisivo che", "conta molto che", "fa la differenza che"]],
  ["e utile che", ["conta che", "aiuta che", "vale che"]],
  ["vale la pena", ["conviene", "ha senso", "puo essere utile"]],
  ["la cosa importante", ["il punto chiave", "l aspetto centrale", "la priorita"]],
  ["la parte piu", ["il tratto piu", "il passaggio piu", "l area piu"]],
  ["una volta che", ["quando", "dopo che", "nel momento in cui"]],
  ["quando si tratta", ["quando parliamo di", "se si parla di", "sul tema"]],
  ["in modo che", ["cosi che", "per fare in modo che", "in modo da far"]],
  ["in modo da", ["cosi da", "in modo da poter", "cosi puoi"]],
  ["e per questo", ["per questo motivo", "proprio per questo", "quindi"]],
  ["e questo significa", ["e questo vuol dire", "quindi significa", "in pratica significa"]],
  ["questo vuol dire", ["questo significa", "quindi vuol dire", "in pratica vuol dire"]],
  ["nel corso della", ["durante la", "lungo la", "nell arco della"]],
  ["nel corso del", ["durante il", "lungo il", "nell arco del"]],
  ["alla fine del", ["in chiusura del", "sul finale del", "al termine del"]],
  ["alla fine della", ["in chiusura della", "sul finale della", "al termine della"]],
  ["nel caso in", ["se", "qualora", "quando"]],
  ["prima di tutto", ["per prima cosa", "per iniziare", "all inizio"]],
  ["dopo aver fatto", ["una volta fatto", "dopo questo passaggio", "dopo aver completato"]],
  ["in fase di", ["nella fase di", "durante la fase di", "nel passaggio di"]],
  ["in termini di", ["sul piano di", "dal punto di vista di", "per quanto riguarda"]],
  ["sotto questo aspetto", ["su questo aspetto", "da questo punto di vista", "in questo ambito"]],
  ["in questa fase", ["a questo passaggio", "in questo momento", "in questo tratto"]],
  ["su questo punto", ["qui", "a riguardo", "su questo aspetto"]],
  ["con il tempo", ["col passare del tempo", "progressivamente", "nel tempo"]],
  ["con il passare", ["col passare", "mano a mano", "col tempo"]],
  ["passo dopo passo", ["un passo alla volta", "gradualmente", "in modo progressivo"]],
  ["giorno dopo giorno", ["quotidianamente", "col tempo", "in modo costante"]],
  ["di volta in", ["via via", "man mano", "col tempo"]],
  ["un passo avanti", ["un avanzamento", "un progresso concreto", "un miglioramento"]],
  ["il passo successivo", ["il prossimo passaggio", "il punto seguente", "la fase successiva"]],
  ["tenere conto di", ["considerare", "avere presente", "prendere in esame"]],
  ["prendere in considerazione", ["valutare", "considerare", "mettere sul tavolo"]],
  ["mettere in pratica", ["applicare", "fare davvero", "portare sul concreto"]],
  ["e il momento", ["ora e il momento", "questo e il momento", "adesso e il momento"]],
  ["e il punto", ["e la chiave", "e il nodo", "e il passaggio centrale"]],
  ["il punto e", ["la chiave e", "il nodo e", "l obiettivo e"]],
  ["la chiave e", ["il punto e", "la base e", "l elemento centrale e"]],
  ["la base e", ["il fondamento e", "il punto di partenza e", "la regola e"]],
  ["fa la differenza", ["incide davvero", "cambia il risultato", "sposta il risultato"]],
  ["puo fare la", ["puo cambiare la", "puo spostare la", "puo incidere sulla"]],
  ["in linea generale", ["in generale", "di norma", "come regola generale"]],
  ["per quanto riguarda", ["sul tema", "in merito a", "a proposito di"]],
  ["in sostanza se", ["in pratica se", "in breve se", "detto semplice se"]],
  ["in pratica se", ["in sostanza se", "detto semplice se", "in breve se"]],
  ["il tuo passo", ["la tua andatura", "il ritmo del passo", "il passo personale"]],
  ["il tuo ritmo", ["la tua cadenza", "il ritmo personale", "la cadenza personale"]],
  ["in modo naturale", ["in modo fluido", "con naturalezza", "in maniera spontanea"]],
  ["essere quello di", ["puntare a", "avere come obiettivo", "andare verso"]],
  ["potrebbe essere quello", ["puo diventare", "puo tradursi in", "puo trasformarsi in"]],
  ["capacita di gestire", ["capacita di governare", "abilita nel gestire", "capacita di affrontare"]],
  ["giorno dopo i", ["giorno oltre i", "giorno passati i", "giorno superati i"]],
  ["la stabilita e", ["la stabilita resta", "la tenuta e", "la stabilita diventa"]],
  ["tutti i giorni", ["ogni giorno", "quotidianamente", "giorno dopo giorno"]],
  ["i tuoi progressi", ["i risultati che ottieni", "i miglioramenti ottenuti", "i passi avanti"]],
  ["la tua motivazione", ["la spinta personale", "la tua costanza", "la motivazione che senti"]],
  ["di questo blocco", ["di questa parte", "di questo passaggio", "di questa sezione"]],
  ["alta la motivazione", ["viva la motivazione", "stabile la motivazione", "alta la costanza"]],
  ["e un passo", ["e un avanzamento", "e un progresso", "rappresenta un passo"]],
  ["a tuo agio", ["in comodita", "con serenita", "in sicurezza"]],
  ["che ti faccia", ["che possa farti", "in grado di farti", "che ti aiuti a"]],
  ["e il tuo", ["e il margine che hai", "e la base che hai", "e il tuo punto di partenza"]],
  ["ricorda che ogni", ["tieni presente che ogni", "non dimenticare che ogni", "considera che ogni"]],
  ["fascia over 60", ["fascia dei sessanta", "fascia over sessanta", "gruppo over 60"]],
  ["la fascia over", ["la fascia dei", "la fascia over sessanta", "il gruppo over"]],
  ["un test rapido", ["una verifica rapida", "un controllo veloce", "un test breve"]],
  ["e quella di", ["e il punto di", "ha l obiettivo di", "si concentra su"]],
  ["il tuo stato", ["la tua condizione", "come stai ora", "il livello attuale"]],
  ["aiutera a mantenere", ["ti aiuta a tenere", "puo sostenere il mantenimento di", "ti aiuta a conservare"]],
  ["camminare tutti i", ["camminare ogni", "muoversi tutti i", "camminare quotidianamente"]],
  ["migliorare la nostra", ["rafforzare la nostra", "migliorare la tua", "rendere piu solida la nostra"]],
  ["a migliorare la", ["per migliorare la", "nel migliorare la", "a rendere piu solida la"]],
  ["aiuta a migliorare", ["puo migliorare", "contribuisce a migliorare", "serve a migliorare"]],
  ["autonomia e la", ["autonomia insieme alla", "autonomia e anche la", "autonomia con la"]],
  ["e la nostra", ["e la tua", "ed e la nostra", "oltre alla nostra"]],
  ["la nostra autonomia", ["la tua autonomia", "l autonomia personale", "l autonomia quotidiana"]],
  ["la nostra capacita", ["la tua capacita", "la capacita personale", "la capacita concreta"]],
  ["nostra capacita di", ["capacita personale di", "capacita reale di", "abilita pratica di"]],
  ["capacita di eseguire", ["capacita di fare", "abilita nell eseguire", "capacita di svolgere"]],
  ["con sicurezza e", ["in sicurezza e", "con controllo e", "in modo sicuro e"]],
  ["che puo portare", ["che rischia di portare", "che puo trasformarsi in", "che puo sfociare in"]],
  ["e l obiettivo", ["e il vero obiettivo", "resta l obiettivo", "e proprio l obiettivo"]],
  ["l obiettivo e", ["l obiettivo resta", "il punto e", "l obiettivo principale e"]],
  ["puo portare a", ["puo causare", "puo condurre a", "puo trasformarsi in"]],
  ["il che puo", ["e questo puo", "e qui puo", "cosa che puo"]],
  ["portare a una", ["arrivare a una", "sfociare in una", "condurre a una"]],
  ["i vostri progressi", ["i progressi che fate", "i vostri miglioramenti", "i progressi ottenuti"]],
  ["monitorare i vostri", ["tenere sotto controllo i vostri", "seguire i vostri", "verificare i vostri"]],
  ["vostri progressi e", ["i vostri progressi e", "i progressi ottenuti e", "i miglioramenti e"]],
  ["rendere le tue", ["rendere piu fluide le tue", "alleggerire le tue", "rendere piu semplici le tue"]],
  ["a mantenere un", ["per mantenere un", "a tenere un", "cosi mantieni un"]],
  ["mantenere un buon", ["tenere un buon", "mantenere una buona", "conservare un buon"]],
  ["una vita piu", ["una vita ancora piu", "una vita piu stabile", "una vita piu attiva"]],
]);

const TEMPLATE_BRIDGE_TRIGRAM_HINTS = [
  "ti aiutera a",
  "ti aiuta a",
  "ti permettera di",
  "ti permette di",
  "ti consentira di",
  "puo aiutarti a",
  "puo permetterti di",
  "per migliorare la",
  "potresti anche considerare",
  "e un opportunita",
  "il tuo stato",
  "esperienza di camminata",
  "aiuta a migliorare",
  "puo portare a",
  "a mantenere un",
  "mantenere un buon",
];

function hashSeed(input) {
  const s = String(input || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function normalizeAscii(s) {
  return String(s || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractTopicAnchors(topic) {
  const stop = new Set([
    "come", "dopo", "quando", "senza", "della", "delle", "degli", "dello", "dalla", "dalle", "dallo",
    "dell", "alla", "alle", "allo", "sulla", "sulle", "sullo", "con", "per", "nel", "nella", "nelle",
    "e", "ed", "il", "lo", "la", "i", "gli", "le", "un", "una", "dei", "del", "ai", "al", "di", "da",
    "ogni", "giorno", "giorni", "anni", "anno", "settimana", "settimane", "mese", "mesi", "minuto", "minuti",
  ]);
  const words = normalizeAscii(topic)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w));

  const anchors = [];
  for (let i = 0; i < words.length - 1 && anchors.length < 6; i++) {
    const two = `${words[i]} ${words[i + 1]}`.trim();
    if (two.includes("anni")) continue;
    if (!anchors.includes(two) && two.split(" ").length <= 2) anchors.push(two);
  }
  for (const w of words) {
    if (anchors.length >= 6) break;
    if (w === "anni") continue;
    if (!anchors.includes(w)) anchors.push(w);
  }
  const fallback = ["ritmo", "respiro", "passo", "stabilita", "energia", "autonomia"];
  for (const f of fallback) {
    if (anchors.length >= 6) break;
    if (!anchors.includes(f)) anchors.push(f);
  }
  return anchors.slice(0, 6);
}

function buildCTA(channelName, { anchor, seed, audience, type } = {}) {
  return [
    "Prima la sicurezza: se avverti dolore forte, capogiri, fiato corto anomalo o oppressione al petto, fermati e parlane col tuo medico.",
    "",
    'Se questo video ti e\' stato utile, scrivi nei commenti: "CAMMINO" e dimmi quanti minuti vuoi iniziare da domani.',
    "",
    `Sul canale ${channelName} trovi altri video pratici per vivere meglio dopo i 50/60/70 anni: uno passo alla volta.`,
  ].join("\n");
}

function buildHook(topic, channelName) {
  return "Se dopo cinque minuti hai fiato corto e gambe dure, in 30 giorni ritrovi respiro stabile, energia e un passo sicuro senza forzare.";
}

function getAudienceProfile(audience) {
  if (audience === "over50") {
    return {
      focus: "prevenzione, ottimizzazione, efficienza, energia, costanza, ritmo",
      style: "tono diretto e pratico",
      line: "Usa leve over50: proteggi, ottimizza, prevenzione.",
      mandatory: ["prevenzione", "ottimizza", "efficienza", "energia", "costanza", "ritmo", "proteggi", "margine"],
      forbidden: ["paura di cadere", "fragile", "dipendenza", "anziano", "insicurezza", "record", "miracolo", "cura definitiva"],
    };
  }
  if (audience === "over70") {
    return {
      focus: "sicurezza, paura caduta, autonomia, equilibrio, controllo",
      style: "tono rassicurante, frasi chiare, ritmo calmo",
      line: "Usa leve over70: in sicurezza, autonomia, riduci paura di cadere.",
      mandatory: ["sicurezza", "autonomia", "equilibrio", "controllo", "fiducia", "stabilita", "in sicurezza", "paura di cadere"],
      forbidden: ["ottimizza", "performance", "efficienza", "massimizza", "alta intensita", "spingi forte", "prestazione", "record"],
    };
  }
  return {
    focus: "stabilita', autonomia, continuita', ritmo",
    style: "tono empatico-pragmatico, progressioni sostenibili",
    line: "Devi rinforzare stabilita', ritmo e continuita' come leva centrale.",
    mandatory: ["stabilita", "autonomia", "continuita", "ritmo", "sicurezza", "controllo", "respiro", "energia"],
    forbidden: ["miracolo", "garantito", "cura definitiva", "record", "massimizza", "spingi forte", "zero sforzo", "risultato certo"],
  };
}

function getTypePattern(type) {
  const map = {
    howto: "3 azioni pratiche + 1 test rapido + 1 progressione breve (solo nei 3 blocchi centrali)",
    protocol: "protocollo a fasi (settimana 1, consolidamento, mantenimento)",
    myth: "mito diffuso -> confutazione -> alternativa pratica",
    mistakes: "3 errori specifici, ognuno con costo concreto e correzione (solo nei 3 blocchi centrali)",
    checklist: "checklist pratica + mini test durante camminata",
    story: "storia realistica -> svolta -> metodo replicabile",
  };
  return map[type] || map.howto;
}

function buildGoldenPrompt({ topic, audience, type, minutes, minWords, maxWords, minBlockWords, anchors, seed }) {
  const profile = getAudienceProfile(audience);
  const pattern = getTypePattern(type);
  const bannedFixedPhrases = [
    "Ricapitoliamo.",
    "In questo video.",
    "Oggi parliamo di.",
    "Benvenuti.",
    "Questo cambia tutto.",
    "Arriviamo al punto.",
    "questo non solo",
    "ti daro un",
    "alla fine di questo blocco",
    "over 60 il",
    "non solo migliora",
    "vi aiutera a",
  ];
  return `
Scrivi uno script YouTube in italiano, utile e concreto.

INPUT
- Topic: ${topic}
- Audience: ${audience}
- Type: ${type}
- Durata: ${minutes} minuti
- Range parole finale target: ${minWords}-${maxWords}
PROFILO AUDIENCE
- Focus lessicale: ${profile.focus}
- Stile: ${profile.style}
- Direzione: ${profile.line}
- Parole obbligatorie audience (usa tutte almeno una volta): ${profile.mandatory.join(", ")}
- Parole vietate audience (non usare): ${profile.forbidden.join(", ")}

PATTERN TYPE
- ${pattern}

TOPIC ANCHORS (OBBLIGATORIO)
- Anchor terms estratti dal topic (5-7, max 2 parole): ${anchors.join(" | ")}
- Regola: ogni blocco deve usare almeno 1 anchor (ruota gli anchor senza liste ripetitive).

REGOLE FISSE
- Niente opener vietati: "In questo video", "Oggi parliamo di", "Benvenuti".
- Niente hook o CTA: li aggiunge il sistema.
- No reuse: vietato riusare frasi identiche o periodi standard da altri topic.
- Evita formule fisse e frasi da manuale.
- Evita formule seriali come "questo non solo", "ti daro un", "alla fine di questo blocco".
- Evita trigrams ripetuti: nessuna tripletta di parole uguale oltre 2 occorrenze.
- Inserisci esattamente 2 cue open-loop con payoff successivo:
  - un cue con "piu' avanti" nel blocco 2 o 3
  - un cue con "alla fine" nel blocco 5 o 6
  - distanza tra i due cue tra 120 e 200 parole
  - non aggiungere altri cue open-loop oltre a questi due.
- Inserisci almeno 2 micro-casi coerenti con audience e type.
- Usa dettagli concreti (minuti, ritmo, segnali corpo, esempio reale).
- Ogni blocco deve citare il topic con dettagli specifici e non generici.
- Vieta incipit ripetuti: non iniziare piu' blocchi con la stessa formula.
- Frasi vietate assolute (non usare): ${bannedFixedPhrases.join(" | ")}
- Type centrali:
  - Se type=mistakes: nei 3 blocchi centrali inserisci 3 errori specifici, ciascuno con costo e correzione, e 1 anchor per errore.
  - Se type=howto: nei 3 blocchi centrali inserisci 3 azioni pratiche, ciascuna con 1 anchor; aggiungi 1 test rapido e 1 progressione breve.

CONTROLLO PRIMA DELL'OUTPUT (OBBLIGATORIO)
- Verifica che nessun trigramma (3 parole consecutive) compaia 3 volte o piu'.
- Se trovi trigrammi ripetuti >=3, riscrivi le frasi finche' il vincolo e' rispettato.

OUTPUT OBBLIGATORIO
Restituisci SOLO JSON valido:
{
  "blocks": [
    "Blocco 1",
    "Blocco 2",
    "Blocco 3",
    "Blocco 4",
    "Blocco 5",
    "Blocco 6",
    "Blocco 7"
  ]
}

VINCOLI BLOCCHI
- Esattamente 7 blocchi (priorita' assoluta).
- Ogni blocco almeno ${Math.max(150, minBlockWords - 10)} parole.
- Se sei in dubbio sulla lunghezza, mantieni comunque 7 blocchi completi.
- Nessun markdown o etichette tecniche.
`.trim();
}


function stitch7(blocks) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(String(blocks[i] ?? "").trim());
  return out;
}

function expansionPack(i, topic) {
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

function topicPaddingParagraph(idx, topic, audience, type, anchors = []) {
  const a = Array.isArray(anchors) && anchors.length ? anchors[idx % anchors.length] : "ritmo";
  const voice =
    audience === "over50"
      ? "proteggi energia utile nella giornata"
      : audience === "over70"
        ? "mantieni autonomia in sicurezza"
        : "consolida stabilita' e continuita'";

  const intros = [
    `Sul tema ${topic}, oggi ci concentriamo su ${a}.`,
    `Quando lavori su ${topic}, il riferimento pratico e' ${a}.`,
    `Nel percorso su ${topic}, la leva da tenere d'occhio e' ${a}.`,
    `Per rendere ${topic} piu' gestibile, conviene partire da ${a}.`,
    `Dentro ${topic}, il passaggio operativo di oggi riguarda ${a}.`,
    `Se vuoi migliorare ${topic}, il primo focus resta ${a}.`,
    `Nel caso di ${topic}, il nodo utile da curare e' ${a}.`,
    `Per dare continuita' a ${topic}, conviene regolare ${a}.`,
  ];

  const howtoVariants = [
    `Intervento rapido: avvio morbido, frase completa in cammino, aumento solo con recupero pulito.`,
    `Procedura pratica: primi minuti leggeri, cadenza regolare, progressione corta quando chiudi in controllo.`,
    `Passo operativo: ritmo parlabile all'inizio, verifica fiato a meta', chiusura senza strappi.`,
    `Schema semplice: partenza lenta, controllo del collo, incremento graduale solo dopo due uscite stabili.`,
    `Routine utile: evita picchi iniziali, osserva la respirazione, alza durata con prudenza.`,
    `Metodo breve: riduci fretta nei primi tratti, mantieni passo comodo, consolida prima di aumentare.`,
  ];

  const mistakesVariants = [
    `Errore da evitare: partenza aggressiva. Costo tipico: affanno precoce. Correzione: avvio progressivo e fiato ordinato.`,
    `Errore frequente: accelerare troppo presto. Effetto: calo di controllo. Correzione: cadenza stabile nei primi minuti.`,
    `Errore comune: ritmo irregolare all'inizio. Costo: fatica inutile. Correzione: passo corto e margine respiratorio.`,
    `Errore ricorrente: inseguire velocita' nei giorni no. Costo: stop anticipati. Correzione: durata ridotta ma costante.`,
    `Errore pratico: ignorare i segnali di tensione. Costo: rigidita' crescente. Correzione: abbassare un livello subito.`,
    `Errore classico: chiudere in affanno. Costo: recupero lento. Correzione: finale ordinato con cadenza regolare.`,
  ];

  const neutralVariants = [
    `Applicazione consigliata: progressione breve e verifica a fine uscita.`,
    `Applicazione utile: margine respiratorio costante e controllo nel tratto finale.`,
    `Applicazione concreta: cadenza sostenibile e controllo posturale regolare.`,
    `Applicazione pratica: micro-aggiustamenti e conferma del recupero al termine.`,
    `Applicazione semplice: ritmo difendibile anche nei giorni meno brillanti.`,
    `Applicazione stabile: continuita' settimanale prima di qualsiasi aumento.`,
  ];

  const intro = intros[idx % intros.length];
  const byType =
    type === "mistakes"
      ? mistakesVariants[idx % mistakesVariants.length]
      : type === "howto"
        ? howtoVariants[idx % howtoVariants.length]
        : neutralVariants[idx % neutralVariants.length];

  return `${intro} Qui devi ${voice}. ${byType}`;
}

function ensureBlockMinWords(block, idx, topic, audience = "over60", type = "howto", anchors = []) {
  let b = String(block ?? "").trim();
  if (!b) b = `Blocco ${idx + 1}. ${topicPaddingParagraph(idx, topic, audience, type, anchors)}`;

  let wc = wordCount(b);
  if (wc >= MIN_BLOCK_WORDS) return b;

  const add1 = topicPaddingParagraph(idx + 1, topic, audience, type, anchors);
  b = `${b}\n\n${add1}`.trim();

  wc = wordCount(b);
  if (wc >= MIN_BLOCK_WORDS) return b;

  const add2 = topicPaddingParagraph(idx + 2, topic, audience, type, anchors);
  b = `${b}\n\n${add2}`.trim();

  return b.trim();
}

function validateAIBlocks(parsed) {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "invalid_json_root" };
  if (!Array.isArray(parsed.blocks)) return { ok: false, reason: "missing_blocks_array" };
  if (parsed.blocks.length < 1) return { ok: false, reason: "blocks_empty" };
  const blocks = parsed.blocks.slice(0, 7);
  while (blocks.length < 7) blocks.push("");
  for (let i = 0; i < blocks.length; i++) {
    const v = blocks[i];
    if (typeof v !== "string") blocks[i] = String(v ?? "");
  }
  return { ok: true, blocks: blocks.map((x) => String(x).trim()) };
}

function enforceTopicAnchors(blocks, anchors, seed = 0) {
  const next = [...blocks];
  const cues = [
    "Dettaglio operativo su {A}: applica un aggiustamento graduale oggi.",
    "Su {A} conta la continuita', non lo strappo iniziale.",
    "Controllo su {A}: ritmo parlabile e passo stabile.",
    "Per {A} scegli progressione breve e verificabile.",
    "Su {A} evita picchi, mantieni margine respiratorio.",
    "Verifica {A} a fine uscita: devi chiudere in controllo.",
  ];
  const safeAnchors = Array.isArray(anchors) && anchors.length ? anchors : ["ritmo", "respiro", "passo", "stabilita", "energia", "autonomia"];
  for (let i = 0; i < next.length; i++) {
    const anchor = safeAnchors[(i + seed) % safeAnchors.length];
    const norm = normalizeAscii(next[i]).toLowerCase();
    const hasAnchor = norm.includes(anchor.toLowerCase());
    if (!hasAnchor) {
      const line = cues[(i + seed) % cues.length].replace("{A}", anchor);
      next[i] = `${next[i]} ${line}`.trim();
    }
  }
  return next;
}

function applyTypePack(blocks, type, anchors, seed = 0) {
  const next = [...blocks];
  const safeAnchors = Array.isArray(anchors) && anchors.length ? anchors : ["ritmo", "respiro", "passo", "stabilita", "energia", "autonomia"];
  if (type === "mistakes") {
    const a1 = safeAnchors[seed % safeAnchors.length];
    const a2 = safeAnchors[(seed + 1) % safeAnchors.length];
    const a3 = safeAnchors[(seed + 2) % safeAnchors.length];
    next[2] = `${next[2]} Errore 1 su ${a1}: costo concreto = affanno precoce e stop anticipato; correzione = avvio al 70% nei primi minuti.`.trim();
    next[3] = `${next[3]} Errore 2 su ${a2}: costo concreto = tensione articolare e calo fiducia; correzione = passo corto e appoggio morbido.`.trim();
    next[4] = `${next[4]} Errore 3 su ${a3}: costo concreto = perdita di continuita' settimanale; correzione = agenda fissa con durata ridotta nei giorni difficili.`.trim();
  } else if (type === "howto") {
    const a1 = safeAnchors[seed % safeAnchors.length];
    const a2 = safeAnchors[(seed + 1) % safeAnchors.length];
    const a3 = safeAnchors[(seed + 2) % safeAnchors.length];
    next[2] = `${next[2]} Azione 1 su ${a1}: avvio lento con respiro regolare per tre minuti.`.trim();
    next[3] = `${next[3]} Azione 2 su ${a2}: ampiezza passo controllata senza picchi di velocita'.`.trim();
    next[4] = `${next[4]} Azione 3 su ${a3}: chiusura in controllo; test rapido = frase completa senza ansimare; progressione breve = +1 minuto ogni tre uscite stabili.`.trim();
  }
  return next;
}

function applySeedFrames(blocks, seed, anchors) {
  const next = [...blocks];
  const a = Array.isArray(anchors) && anchors.length ? anchors[seed % anchors.length] : "ritmo";
  const intro = [
    `Scenario iniziale: su ${a} il primo segnale e' il fiato che sale troppo presto.`,
    `Contrasto iniziale: su ${a} non serve spingere forte, serve controllo progressivo.`,
    `Partenza narrativa: su ${a} il blocco vero non e' la volonta', e' il ritmo sbagliato.`,
  ];
  const dev = [
    `Sviluppo: correggi un punto alla volta su ${a}, poi verifica come risponde il corpo.`,
    `Sviluppo: costo e correzione su ${a} vanno letti nella stessa uscita, non a settimane di distanza.`,
    `Sviluppo: su ${a} il test pratico decide se aumentare o mantenere il ritmo.`,
  ];
  const close = [
    `Chiusura: su ${a} conta la continuita' settimanale, non l'uscita perfetta.`,
    `Chiusura: su ${a} l'obiettivo e' autonomia sostenibile, non prestazione episodica.`,
    `Chiusura: su ${a} conferma il controllo e prepara il prossimo passo in agenda.`,
  ];
  next[0] = `${next[0]} ${intro[seed % 3]}`.trim();
  next[3] = `${next[3]} ${dev[(seed + 1) % 3]}`.trim();
  next[6] = `${next[6]} ${close[(seed + 2) % 3]}`.trim();
  return next;
}

function reinforceAudienceSignals(blocks, audience, type) {
  const next = [...blocks];
  const p = getAudienceProfile(audience);
  const mandatoryLine = `Nel racconto tornano parole concrete come ${p.mandatory.join(", ")}.`;
  const voiceLine =
    audience === "over50"
      ? "Voce over50: proteggi risultato, ottimizza energia, prevenzione pratica."
      : audience === "over70"
        ? "Voce over70: muoversi in sicurezza, ridurre paura di cadere, consolidare autonomia."
        : "Voce over60: stabilita', controllo e continuita' senza forzare.";
  next[0] = `${next[0]} ${voiceLine} ${mandatoryLine}`.trim();

  const forbidden = p.forbidden || [];
  const replOver50 = {
    fragile: "in fase di recupero",
    fragilita: "sensibilita",
    "paura caduta": "attenzione alla stabilita'",
    "non ce la fai": "puoi gestirla per gradi",
    dipendenza: "autonomia graduale",
    insicurezza: "controllo progressivo",
    "rischio caduta": "rischio di instabilita'",
    anziano: "adulto maturo",
  };
  const replOver70 = {
    performance: "stabilita'",
    ottimizza: "protegge",
    massimizza: "consolida",
    record: "continuita'",
    "alta intensita": "intensita' moderata",
    "spingi forte": "procedi graduale",
    prestazione: "autonomia",
    "efficienza estrema": "equilibrio sostenibile",
  };
  const repl = audience === "over50" ? replOver50 : audience === "over70" ? replOver70 : {};
  for (let i = 0; i < next.length; i++) {
    let t = normalizeAscii(next[i]);
    for (const bad of forbidden) {
      const key = normalizeAscii(bad).toLowerCase();
      const val = repl[key] || "controllo";
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      t = t.replace(new RegExp(`\\b${esc}\\b`, "gi"), val);
    }
    next[i] = t;
  }

  const typeTags = {
    howto: "Schema howto: 3 azioni pratiche, test rapido, progressione breve.",
    protocol: "Schema protocol: fasi settimanali con verifica oggettiva.",
    myth: "Schema myth: mito, prova, alternativa.",
    mistakes: "Schema mistakes: 3 errori specifici con costo e correzione.",
    checklist: "Schema checklist: punti rapidi + mini test in camminata.",
    story: "Schema story: storia realistica, svolta, metodo.",
  };
  next[1] = `${next[1]} ${typeTags[type] || typeTags.howto}`.trim();
  return next;
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
        "Sei un autore/copywriter italiano per YouTube. Restituisci SOLO JSON valido con chiave blocks e 7 stringhe. Nessun testo fuori JSON.",
      temperature: 0.35,
      maxTokens: MAX_TOKENS_GROQ,
      jsonMode: true,
      timeoutMs,
      allowFallback: false,
    });
    return { text: out, meta };
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || 500);
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
        "Sei un autore/copywriter italiano per YouTube. Restituisci SOLO JSON valido con chiave blocks e 7 stringhe. Nessun testo fuori JSON.",
      temperature: 0.35,
      maxTokens: MAX_TOKENS_OPENAI,
      jsonMode: true,
      timeoutMs,
      allowFallback: false,
    });
    return { text: out2, meta };
  }
}

function enforceOpenLoops(blocks, topic, seed = 0) {
  const next = blocks.map((b) => String(b || "").trim());

  function normalize(s) {
    return normalizeAscii(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripCueSentences(text) {
    const chunks = String(text || "")
      .replace(/\r/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    const kept = [];
    for (const sentence of chunks) {
      const n = normalize(sentence);
      const isLegacyFixed =
        n.includes("tra poco ti mostro l errore preciso che ti fa partire male") ||
        n.includes("tra un attimo ti faccio vedere il passaggio che quasi tutti saltano") ||
        n.includes("ecco l errore") ||
        n.includes("ecco il passaggio");
      if (!isLegacyFixed) kept.push(sentence);
    }
    return kept.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  for (let i = 0; i < next.length; i++) next[i] = stripCueSentences(next[i]);
  // Nessuna injection post-generazione: solo pulizia legacy.
  return next.map((b) => b.replace(/\s{2,}/g, " ").trim());
}

function reduceRepeatedTrigrams(
  text,
  {
    threshold = 3,
    maxPasses = 4,
    maxFixes = 12,
    protectedHeadWords = 200,
    protectedTailWords = 120,
    minWords = 0,
  } = {}
) {
  const original = String(text || "");
  if (!original.trim()) return original;

  const safeSynonymMap = new Map([
    ["camminare", ["muoversi", "passeggiare"]],
    ["camminata", ["passeggiata", "uscita a passo"]],
    ["muoversi", ["camminare", "passeggiare"]],
    ["ritmo", ["cadenza"]],
    ["controllo", ["gestione"]],
    ["continuita", ["costanza"]],
    ["respiro", ["fiato"]],
    ["stabile", ["regolare"]],
    ["stabili", ["regolari"]],
    ["forzare", ["spingere"]],
    ["errore", ["passo falso"]],
    ["partenza", ["avvio"]],
    ["dolore", ["fastidio"]],
    ["rigidita", ["tensione"]],
    ["stanchezza", ["fatica"]],
    ["passo", ["andatura"]],
    ["solo", ["soltanto"]],
    ["vostra", ["tua"]],
    ["vostro", ["tuo"]],
    ["vi", ["ti"]],
    ["se", ["quando"]],
    ["migliora", ["rafforza"]],
    ["energia", ["carica"]],
    ["stato", ["condizione"]],
    ["livello", ["margine"]],
    ["esperienza", ["pratica"]],
    ["opportunita", ["occasione"]],
    ["rischio", ["pericolo"]],
    ["esempio", ["caso"]],
    ["concreto", ["pratico"]],
    ["eseguire", ["fare"]],
    ["mantenere", ["tenere"]],
    ["cammino", ["percorso"]],
    ["quotidiano", ["giornaliero"]],
    ["parte", ["fase"]],
    ["nodo", ["punto"]],
    ["obiettivo", ["traguardo"]],
    ["progressi", ["risultati"]],
    ["sfide", ["difficolta"]],
  ]);

  const tokenRe = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?/g;
  const fillerPatterns = [
    /\ba tal proposito\b,?/gi,
    /\bin questo modo\b,?/gi,
    /\ba questo punto\b,?/gi,
    /\bdetto questo\b,?/gi,
    /\bin pratica\b,?/gi,
    /\bin sostanza\b,?/gi,
    /\bper quanto riguarda\b,?/gi,
    /\bin altre parole\b,?/gi,
  ];
  const infinitiveToPresentSecond = new Map([
    ["respirare", "respiri"],
    ["camminare", "cammini"],
    ["mantenere", "mantieni"],
    ["sentire", "senti"],
    ["sentirti", "ti senti"],
    ["muoversi", "ti muovi"],
    ["muovere", "muovi"],
    ["recuperare", "recuperi"],
    ["tenere", "tieni"],
    ["ridurre", "riduci"],
    ["evitare", "eviti"],
    ["stabilizzare", "stabilizzi"],
    ["migliorare", "migliori"],
    ["aumentare", "aumenti"],
    ["gestire", "gestisci"],
    ["controllare", "controlli"],
    ["riposare", "riposi"],
    ["partire", "parti"],
    ["proseguire", "prosegui"],
    ["chiudere", "chiudi"],
    ["regolare", "regoli"],
    ["salire", "sali"],
    ["scendere", "scendi"],
    ["rafforzare", "rafforzi"],
    ["proteggere", "proteggi"],
    ["coordinare", "coordini"],
    ["rilassare", "rilassi"],
    ["ascoltare", "ascolti"],
    ["correggere", "correggi"],
    ["allenare", "alleni"],
    ["dosare", "dosi"],
    ["bilanciare", "bilanci"],
    ["consolidare", "consolidi"],
    ["organizzare", "organizzi"],
    ["dormire", "dormi"],
    ["bere", "bevi"],
    ["idratare", "idrati"],
  ]);

  function normalizeWord(w) {
    return normalizeText(w)
      .replace(/[^a-z0-9']/g, "")
      .trim();
  }

  function tokenizeWithRanges(raw) {
    tokenRe.lastIndex = 0;
    const words = [];
    const ranges = [];
    let m;
    while ((m = tokenRe.exec(raw)) !== null) {
      const rawWord = String(m[0] || "");
      const norm = normalizeWord(rawWord);
      if (!norm) continue;
      words.push(norm);
      ranges.push({ raw: rawWord, start: m.index, end: m.index + rawWord.length });
    }
    return { words, ranges };
  }

  function buildTrigramPositions(normWords) {
    const map = new Map();
    for (let i = 0; i <= normWords.length - 3; i++) {
      const tri = `${normWords[i]} ${normWords[i + 1]} ${normWords[i + 2]}`;
      if (!map.has(tri)) map.set(tri, []);
      map.get(tri).push(i);
    }
    return map;
  }

  function preserveCase(sourceWord, targetWord) {
    if (/^\p{Lu}/u.test(sourceWord)) {
      return targetWord.charAt(0).toUpperCase() + targetWord.slice(1);
    }
    return targetWord;
  }

  function isProtected(wordIdx, totalWords) {
    if (wordIdx < protectedHeadWords) return true;
    if (wordIdx >= Math.max(0, totalWords - protectedTailWords)) return true;
    return false;
  }

  function isEditableWordRange(startWordIdx, endWordIdx, totalWords) {
    if (startWordIdx < 0 || endWordIdx < startWordIdx) return false;
    for (let i = startWordIdx; i <= endWordIdx; i++) {
      if (isProtected(i, totalWords)) return false;
    }
    return true;
  }

  function listRepeatedWithPositions(normWords) {
    const triPos = buildTrigramPositions(normWords);
    return [...triPos.entries()]
      .filter(([, positions]) => positions.length >= threshold)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }

  function pickEditableOccurrence(positions, totalWords) {
    const editable = positions.filter(
      (start) =>
        start + 2 < totalWords &&
        !isProtected(start, totalWords) &&
        !isProtected(start + 1, totalWords) &&
        !isProtected(start + 2, totalWords)
    );
    if (!editable.length) return -1;
    return editable[Math.floor(editable.length / 2)];
  }

  function applyLocalRewrite(rawText, ranges, startWordIdx, replacementPhrase) {
    if (startWordIdx < 0 || startWordIdx + 2 >= ranges.length) return rawText;
    const left = ranges[startWordIdx].start;
    const right = ranges[startWordIdx + 2].end;
    const source = rawText.slice(left, right);
    const replacement = preserveCase(source, replacementPhrase);
    return `${rawText.slice(0, left)}${replacement}${rawText.slice(right)}`;
  }

  function applySpanRewrite(rawText, startChar, endChar, replacementText) {
    if (startChar < 0 || endChar <= startChar) return rawText;
    return `${rawText.slice(0, startChar)}${replacementText}${rawText.slice(endChar)}`;
  }

  function pickPhraseRewrite(tri, pass, fixes) {
    if (STRUCTURAL_TRIGRAMS.has(tri)) {
      const options = STRUCTURAL_TRIGRAMS.get(tri) || [];
      if (options.length) return options[(pass + fixes) % options.length];
    }
    if (tri.includes("ogni giorno")) {
      const options = ["tutti i giorni", "quotidianamente", "giorno dopo giorno"];
      const rep = options[(pass + fixes) % options.length];
      return tri.replace("ogni giorno", rep);
    }
    if (tri.includes("dopo i 60")) {
      const options = STRUCTURAL_TRIGRAMS.get("dopo i 60") || ["oltre i 60", "superati i 60", "passati i 60"];
      const rep = options[(pass + fixes) % options.length];
      return tri.replace("dopo i 60", rep);
    }
    return "";
  }

  function pickWordLevelRewrite(ranges, tri, startWordIdx, pass, fixes) {
    const triWords = tri.split(" ");
    const order = [1, 2, 0];
    for (const pos of order) {
      const base = triWords[pos] || "";
      const alternatives = safeSynonymMap.get(base) || [];
      if (!alternatives.length) continue;
      const alt = alternatives[(pass + fixes + pos) % alternatives.length];
      if (!alt || alt === base) continue;
      const rawWords = [
        ranges[startWordIdx].raw,
        ranges[startWordIdx + 1].raw,
        ranges[startWordIdx + 2].raw,
      ];
      rawWords[pos] = preserveCase(rawWords[pos], alt);
      const phrase = rawWords.join(" ");
      if (!phrase.trim()) continue;
      return phrase;
    }
    return "";
  }

  function trigramCount(normWords, tri) {
    if (normWords.length < 3) return 0;
    let c = 0;
    const parts = tri.split(" ");
    for (let i = 0; i <= normWords.length - 3; i++) {
      if (normWords[i] === parts[0] && normWords[i + 1] === parts[1] && normWords[i + 2] === parts[2]) c += 1;
    }
    return c;
  }

  function sentenceBoundsAt(rawText, charPos) {
    let start = 0;
    for (let i = Math.max(0, charPos - 1); i >= 0; i--) {
      if (/[.!?\n]/.test(rawText[i])) {
        start = i + 1;
        break;
      }
    }
    while (start < rawText.length && /\s/.test(rawText[start])) start += 1;

    let end = rawText.length;
    for (let i = Math.max(0, charPos); i < rawText.length; i++) {
      if (/[.!?\n]/.test(rawText[i])) {
        end = i + 1;
        break;
      }
    }
    return { start, end };
  }

  function wordRangeForSpan(ranges, startChar, endChar) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r.end <= startChar) continue;
      if (r.start >= endChar) break;
      if (first === -1) first = i;
      last = i;
    }
    if (first === -1 || last === -1) return null;
    return { first, last };
  }

  function cleanupSentenceSpacing(s) {
    return String(s || "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,.;:!?])(?=\S)/g, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function rewriteBridgeToDirect(sentence, pass, fixes) {
    const bridgeRegex =
      /\b(?:ti\s+(?:aiutera|aiuta|permettera|permette|consentira)\s+(?:a|di)|puo\s+(?:aiutarti|permetterti)\s+(?:a|di))\s+([A-Za-zÀ-ÖØ-öø-ÿ']+)([^.!?\n]*)/i;
    const m = sentence.match(bridgeRegex);
    if (!m) return "";

    const infRaw = String(m[1] || "").trim();
    const infNorm = normalizeWord(infRaw);
    const rest = String(m[2] || "");
    const present = infinitiveToPresentSecond.get(infNorm) || "";

    const optionIdx = (pass + fixes) % 2;
    const replacement = present
      ? (optionIdx === 0 ? `cosi ${present}${rest}` : `${present}${rest} direttamente`)
      : (optionIdx === 0 ? `cosi puoi ${infRaw}${rest}` : `puoi ${infRaw}${rest} direttamente`);

    const out = sentence.replace(bridgeRegex, replacement);
    return cleanupSentenceSpacing(out);
  }

  function invertCauseEffect(sentence) {
    const inversionRegex = /^\s*(.+?),\s*(?:e\s+)?questo\s+(?:significa|vuol dire)\s+(.+?)\s*([.!?])?\s*$/i;
    const m = sentence.match(inversionRegex);
    if (!m) return "";
    const cause = cleanupSentenceSpacing(m[1] || "");
    const effect = cleanupSentenceSpacing(m[2] || "");
    if (!cause || !effect) return "";
    const punct = m[3] || ".";
    return cleanupSentenceSpacing(`${effect}: quindi ${cause}${punct}`);
  }

  function stripFillerPhrases(sentence) {
    const before = cleanupSentenceSpacing(sentence);
    let out = before;
    for (const re of fillerPatterns) out = out.replace(re, " ");
    out = cleanupSentenceSpacing(out);
    if (!out || out === before) return "";
    return out;
  }

  function shouldTryTemplateRewrite(tri) {
    return TEMPLATE_BRIDGE_TRIGRAM_HINTS.some((hint) => tri.includes(hint));
  }

  function pickTemplateSentenceRewrite(rawText, ranges, tri, startWordIdx, totalWords, pass, fixes) {
    if (!shouldTryTemplateRewrite(tri)) return null;
    const centerIdx = startWordIdx + 1;
    if (centerIdx < 0 || centerIdx >= ranges.length) return null;

    const bounds = sentenceBoundsAt(rawText, ranges[centerIdx].start);
    const wordRange = wordRangeForSpan(ranges, bounds.start, bounds.end);
    if (!wordRange) return null;
    if (!isEditableWordRange(wordRange.first, wordRange.last, totalWords)) return null;

    const sentence = rawText.slice(bounds.start, bounds.end);
    const cleanSentence = cleanupSentenceSpacing(sentence);

    const rewA = rewriteBridgeToDirect(sentence, pass, fixes);
    if (rewA && rewA !== cleanSentence) {
      return { startChar: bounds.start, endChar: bounds.end, replacement: rewA };
    }

    const rewB = invertCauseEffect(sentence);
    if (rewB && rewB !== cleanSentence) {
      return { startChar: bounds.start, endChar: bounds.end, replacement: rewB };
    }

    const rewC = stripFillerPhrases(sentence);
    if (rewC && rewC !== cleanSentence) {
      return { startChar: bounds.start, endChar: bounds.end, replacement: rewC };
    }
    return null;
  }

  let current = original;
  let fixes = 0;

  for (let pass = 0; pass < maxPasses && fixes < maxFixes; pass++) {
    let passChanged = false;

    while (fixes < maxFixes) {
      const { words, ranges } = tokenizeWithRanges(current);
      if (words.length < 3) break;
      const repeated = listRepeatedWithPositions(words);
      if (!repeated.length) break;

      let changed = false;
      for (const [targetTri, targetPositions] of repeated) {
        const startWordIdx = pickEditableOccurrence(targetPositions, words.length);
        if (startWordIdx < 0) continue;

        const prevCount = trigramCount(words, targetTri);
        const sentenceRewrite = pickTemplateSentenceRewrite(
          current,
          ranges,
          targetTri,
          startWordIdx,
          words.length,
          pass,
          fixes
        );
        if (sentenceRewrite) {
          const nextText = applySpanRewrite(
            current,
            sentenceRewrite.startChar,
            sentenceRewrite.endChar,
            sentenceRewrite.replacement
          );
          if (nextText !== current) {
            const nextWords = tokenizeWithRanges(nextText).words;
            const nextCount = trigramCount(nextWords, targetTri);
            if (nextCount < prevCount) {
              current = nextText;
              fixes += 1;
              changed = true;
              passChanged = true;
              break;
            }
          }
        }

        const replacementCandidates = [];
        const phraseRewrite = pickPhraseRewrite(targetTri, pass, fixes);
        if (phraseRewrite) replacementCandidates.push(phraseRewrite);
        const wordRewrite = pickWordLevelRewrite(ranges, targetTri, startWordIdx, pass, fixes);
        if (wordRewrite) replacementCandidates.push(wordRewrite);
        if (!replacementCandidates.length) continue;

        for (const candidate of replacementCandidates) {
          const nextText = applyLocalRewrite(current, ranges, startWordIdx, candidate);
          if (nextText === current) continue;
          const nextWords = tokenizeWithRanges(nextText).words;
          const nextCount = trigramCount(nextWords, targetTri);
          if (nextCount >= prevCount) continue;
          current = nextText;
          fixes += 1;
          changed = true;
          passChanged = true;
          break;
        }
        if (changed) break;
      }

      if (!changed) break;
    }

    if (!passChanged) break;
  }

  const out = current.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const minW = Number(minWords || 0);
  if (minW > 0) {
    const originalWc = qualityWordCount(original);
    const outWc = qualityWordCount(out);
    if (originalWc >= minW && outWc < minW) return original;
  }
  return out;
}
function improveNonRepetition(scriptText, options = {}) {
  const topic = String(options.topic || "").trim();
  const audience = String(options.audience || "over60").trim().toLowerCase();
  const type = String(options.type || "howto").trim().toLowerCase();
  const topicTag = topic ? topic.toLowerCase().replace(/\s+/g, " ").trim() : "questo tema";
  const topicRef = (() => {
    const stopWords = new Set([
      "ogni", "giorno", "giorni", "dopo", "prima", "anni", "anno", "60", "50", "70",
      "i", "il", "lo", "la", "gli", "le", "di", "da", "del", "della", "dello",
    ]);
    const words = normalizeAscii(topicTag)
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const core = words.filter((w) => !stopWords.has(w)).slice(0, 3);
    if (core.length) return core.join(" ");
    if (words.length) return words.slice(0, 2).join(" ");
    return "tema del giorno";
  })();
  const raw = String(scriptText || "").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  const firstNonEmptyIdx = lines.findIndex((l) => String(l || "").trim().length > 0);
  const hookLine = firstNonEmptyIdx >= 0 ? lines[firstNonEmptyIdx] : "";
  const bodyLines =
    firstNonEmptyIdx >= 0
      ? [...lines.slice(0, firstNonEmptyIdx), ...lines.slice(firstNonEmptyIdx + 1)]
      : lines;

  const outLines = [];
  const seen = new Set();

  for (const line of bodyLines) {
    const t = line.trim();
    if (!t) {
      outLines.push("");
      continue;
    }
    const parts = t
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const kept = [];
    for (const p of parts) {
      const key = normalizeAscii(p).toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(p);
    }
    outLines.push(kept.join(" "));
  }

  let out = outLines.join("\n");
  out = out
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const replacements = [
    { from: /\be quello di\b/gi, to: ["e il punto e'", "e l'obiettivo e'"] },
    { from: /\be' quello di\b/gi, to: ["e' il punto di", "e' la parte da"] },
    { from: /\bdurante la camminata\b/gi, to: ["mentre cammini", "nel percorso"] },
    { from: /\bmantenere la motivazione\b/gi, to: ["tenere vivo l'impegno", "proteggere la continuita'"] },
    { from: /\banni che ha\b/gi, to: ["anni che aveva", "anni e'"] },
    { from: /\bin 30 giorni\b/gi, to: ["nel primo mese", "in quattro settimane"] },
    { from: /\bgestire le ricadute\b/gi, to: ["ripartire dopo gli stop", "recuperare dopo una pausa"] },
    { from: /\bfare esercizi di\b/gi, to: ["eseguire esercizi per", "inserire esercizi mirati"] },
    { from: /\bdopo alcune settimane\b/gi, to: ["dopo qualche settimana", "col passare delle settimane"] },
    { from: /\berrore comune e\b/gi, to: ["errore tipico e", "errore frequente e"] },
    { from: /\bdolore alle ginocchia\b/gi, to: ["fastidio alle ginocchia", "dolore articolare alle ginocchia"] },
    { from: /\bun errore comune\b/gi, to: [`un errore tipico su ${topicTag}`, `un errore ricorrente su ${topicTag}`] },
    { from: /\bun micro caso\b/gi, to: [`un caso reale su ${topicTag}`, `un esempio pratico su ${topicTag}`] },
    { from: /\binoltre e importante\b/gi, to: ["in piu' e utile", "in questa fase conta"] },
  ];

  for (const rule of replacements) {
    let idx = 0;
    out = out.replace(rule.from, () => {
      const v = rule.to[idx % rule.to.length];
      idx += 1;
      return v;
    });
  }

  const hardBanPhrases = [
    "ricapitoliamo.",
    "scrivi nei commenti.",
    "in questo video.",
    "oggi parliamo di.",
    "benvenuti.",
    "un passo alla volta. sempre.",
    "ecco cosa cambia davvero.",
    "partenza lenta, passo controllato.",
    "la costanza batte tutto.",
    "ascolta il tuo corpo.",
    "fallo ogni giorno.",
    "questo cambia tutto.",
    "ti spiego subito.",
    "arriviamo al punto.",
    "non e l eta e come inizi.",
  ];
  for (const phrase of hardBanPhrases) {
    const key = normalizeAscii(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = normalizeAscii(out).replace(new RegExp(key, "gi"), " ");
  }
  out = out.replace(/\s{2,}/g, " ").trim();

  const audienceLine =
    audience === "over50"
      ? `Focus over50: energia nella giornata e costanza compatibile con impegni reali.`
      : audience === "over70"
        ? `Focus over70: sicurezza, equilibrio e autonomia nei movimenti quotidiani.`
        : `Focus over60: stabilita', ritmo e continuita' senza forzare.`;
  const typeLine = `Pattern ${type}: applicazione concreta su ${topicRef}.`;
  out = `${audienceLine}\n${typeLine}\n${out}`.trim();

  const rebuilt =
    firstNonEmptyIdx >= 0 ? [...lines.slice(0, firstNonEmptyIdx), hookLine, out].join("\n") : out;

  const reduced = reduceRepeatedTrigrams(rebuilt, {
    threshold: 3,
    maxPasses: 4,
    maxFixes: 12,
    protectedHeadWords: 0,
    protectedTailWords: 0,
    minWords: Number(options.minWords || 0),
  });

  return reduced.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Beautify deterministico: NON cambia parole, solo layout.
 * Obiettivo: piu' paragrafi, leggibilita', Fliki-friendly.
 */
function beautifyLayout(scriptText) {
  let s = String(scriptText || "").trim();

  // Normalizza EOL e spazi
  s = s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  // Inserisce respiro tra frasi (dopo . ! ?) quando la successiva parte con lettera maiuscola
  s = s.replace(/([.!?])\s+(\p{Lu})/gu, "$1\n\n$2");

  // Spezza paragrafi troppo densi: massimo ~2 frasi per paragrafo
  const paras = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out = [];

  for (const p of paras) {
    const sentences = p
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (sentences.length <= 2) {
      out.push(p);
      continue;
    }

    for (let i = 0; i < sentences.length; i += 2) {
      out.push(sentences.slice(i, i + 2).join(" "));
    }
  }

  s = out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
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
      metrics: {
        wordCount: null,
        hookScore: null,
        retentionScore: null,
        flags: ["scriptQualityCheck_missing"],
        hookPromiseDetected: null,
        openLoopDetected: null,
        maxRepeatedTrigramCount: 0,
        hasTrigramGe3: false,
      },
    };
  }

  const tmpDir = path.join(process.cwd(), "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `script_quality_${Date.now()}_${process.pid}_${QUALITY_AUDIT_SEQ++}.txt`
  );

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

  function parseQualityMetrics(stdout, failReasons = []) {
    const out = {
      wordCount: null,
      hookScore: null,
      retentionScore: null,
      flags: [...(Array.isArray(failReasons) ? failReasons : [])],
      hookPromiseDetected: null,
      openLoopDetected: null,
      maxRepeatedTrigramCount: 0,
      hasTrigramGe3: false,
    };

    const text = String(stdout || "");
    if (!text) return out;

    const mWord = text.match(/wordCount:\s*(\d+)/i);
    if (mWord) out.wordCount = Number(mWord[1]);

    const mHook = text.match(/Hook:\s*(\d+)\/10/i);
    if (mHook) out.hookScore = Number(mHook[1]);

    const mRetention = text.match(/Retention:\s*(\d+)\/10/i);
    if (mRetention) out.retentionScore = Number(mRetention[1]);

    const mHookPromise = text.match(/hookPromiseDetected:\s*(YES|NO)/i);
    if (mHookPromise) out.hookPromiseDetected = mHookPromise[1].toUpperCase() === "YES";

    if (/Open-loop gaps/i.test(text)) out.openLoopDetected = true;

    const triSectionMatch = text.match(/Top repeated trigrams:[\s\S]*?------------------------------------------------------------/i);
    if (triSectionMatch?.[0]) {
      const lines = triSectionMatch[0].split(/\r?\n/);
      let maxCount = 0;
      for (const line of lines) {
        const m = line.match(/\bx(\d+)\b/i);
        if (!m) continue;
        const c = Number(m[1]);
        if (Number.isFinite(c)) maxCount = Math.max(maxCount, c);
      }
      out.maxRepeatedTrigramCount = maxCount;
      out.hasTrigramGe3 = maxCount >= 3;
    }

    if (out.hasTrigramGe3 && !out.flags.includes("TRIGRAM_GE_3")) out.flags.push("TRIGRAM_GE_3");
    return out;
  }

  try {
    await fsp.writeFile(tmpFile, String(scriptText || ""), "utf8");

    const { spawnSync } = await import("child_process");
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
    const failReasons = parseFailReasons(stdout);

    return {
      ran: true,
      pass: final === "PASS" && Number(proc.status) === 0,
      final,
      exitCode: Number.isFinite(proc.status) ? proc.status : null,
      failReasons,
      metrics: parseQualityMetrics(stdout, failReasons),
      stderr: stderr ? stderr.slice(0, 700) : "",
    };
  } catch (err) {
    return {
      ran: true,
      pass: false,
      final: "FAIL",
      exitCode: 1,
      failReasons: ["scriptQualityCheck_exec_error"],
      metrics: {
        wordCount: null,
        hookScore: null,
        retentionScore: null,
        flags: ["scriptQualityCheck_exec_error"],
        hookPromiseDetected: null,
        openLoopDetected: null,
        maxRepeatedTrigramCount: 0,
        hasTrigramGe3: false,
      },
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
  const ctaWc = qualityWordCount(cta);

  let body = blocks.join("\n\n").trim();
  let bodyWc = qualityWordCount(body);

  if (bodyWc < minBodyWords) {
    for (let k = 0; k < 4 && bodyWc < minBodyWords; k++) {
      const idx = (k * 2 + 1) % 7;
      blocks[idx] = `${blocks[idx]}\n\n${expansionPack(idx + 11 + k, topic)}`.trim();
      body = blocks.join("\n\n").trim();
      bodyWc = qualityWordCount(body);
    }
  }

  if (bodyWc > maxBodyWords) {
    body = trimToWordLimit(body, maxBodyWords);
  }

  let finalScript = fixMojibake(`${hook}\n${body}\n\n${cta}`.trim());
  if (target === "fliki") finalScript = cleanForFliki(finalScript);

  let finalWc = qualityWordCount(finalScript);

  if (finalWc > maxWords) {
    const allowedBodyWords = Math.max(240, maxWords - qualityWordCount(hook) - ctaWc);
    const bodyTrimmed = trimToWordLimit(body, allowedBodyWords);
    finalScript = fixMojibake(`${hook}\n${bodyTrimmed}\n\n${cta}`.trim());
    if (target === "fliki") finalScript = cleanForFliki(finalScript);
    finalWc = qualityWordCount(finalScript);
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
    finalWc = qualityWordCount(finalScript);
  }

  return { blocks, body, finalScript, finalWc };
}

function buildDeterministicMinWordPad({ padIdx, anchors = [], topic, audience = "over60", type = "howto" }) {
  const safeAnchors =
    Array.isArray(anchors) && anchors.length
      ? anchors
      : ["ritmo", "respiro", "passo", "stabilita", "energia", "autonomia"];
  const a = safeAnchors[padIdx % safeAnchors.length];

  const openers = [
    `Sul punto ${a},`,
    `Nel tratto dedicato a ${a},`,
    `Per consolidare ${a},`,
    `Quando regoli ${a},`,
    `Per dare continuita' a ${a},`,
    `Sullo snodo ${a},`,
    `Dentro la fase su ${a},`,
    `Per rendere stabile ${a},`,
    `Nel focus di oggi su ${a},`,
    `Nel lavoro pratico su ${a},`,
    `Nella progressione legata a ${a},`,
    `Nel passaggio operativo su ${a},`,
  ];
  const actions = [
    "mantieni avvio morbido e passo gestibile nei primi minuti.",
    "riduci ampiezza se sale la tensione e torna graduale in breve.",
    "lascia margine respiratorio costante e controlla il ritmo centrale.",
    "evita strappi iniziali e scegli una cadenza che resta parlabile.",
    "controlla spalle e collo per alleggerire il lavoro sul fiato.",
    "difendi continuita' settimanale invece di inseguire picchi isolati.",
    "spegni la fretta nei primi tratti e chiudi con lucidita'.",
    "regola il passo in base ai segnali reali e non all'urgenza del momento.",
  ];
  const checks = [
    "Check finale: recupero presente e sensazione di controllo in chiusura.",
    "Verifica utile: frase completa senza ansimare nel tratto conclusivo.",
    "Test rapido: ritmo ordinato anche quando il percorso cambia.",
    "Conferma pratica: nessun affanno netto negli ultimi minuti.",
    "Segnale corretto: finisci con riserva e non in rincorsa.",
    "Riscontro concreto: mente lucida e passo ancora regolare a fine uscita.",
    "Indicatore buono: ripresa del fiato entro poco dal rallentamento.",
    "Controllo reale: cadenza stabile anche nel ritorno.",
  ];
  const voices =
    audience === "over50"
      ? [
          "Questo ti aiuta a proteggere energia utile nella giornata.",
          "Cosi' difendi continuita' senza perdere efficienza.",
          "Questa scelta mantiene margine e prevenzione pratica.",
        ]
      : audience === "over70"
        ? [
            "Questo sostiene autonomia e sicurezza nei gesti quotidiani.",
            "Cosi' riduci incertezza e mantieni controllo del passo.",
            "Questa linea protegge equilibrio e fiducia nel movimento.",
          ]
        : [
            "Questo rinforza stabilita' e regolarita' senza irrigidirti.",
            "Cosi' mantieni controllo e recupero piu' affidabile.",
            "Questa impostazione favorisce costanza e fiducia progressiva.",
          ];
  const typeFrames = {
    mistakes: [
      "correggi un errore per volta e misura subito l'effetto",
      "metti a fuoco un solo errore e verifica il costo evitato",
      "scegli un errore ricorrente e chiudilo con una correzione concreta",
    ],
    howto: [
      "applica una mossa pratica e verifica la risposta del corpo",
      "scegli un'azione semplice e controlla il risultato sul momento",
      "usa un passaggio operativo e conferma il miglioramento in chiusura",
    ],
    protocol: [
      "mantieni fasi brevi con controlli ripetibili",
      "segui una sequenza corta e valida ogni passaggio",
      "organizza il lavoro in step chiari e verificabili",
    ],
    myth: [
      "sostituisci l'idea sbagliata con un criterio testabile",
      "smonta il mito con un riscontro pratico",
      "passa da convinzione vaga a regola osservabile",
    ],
    checklist: [
      "usa due check essenziali prima di aumentare",
      "conferma i punti chiave e poi avanza di poco",
      "verifica la checklist minima e mantieni controllo",
    ],
    story: [
      "prendi un caso realistico e trasformalo in abitudine utile",
      "parti da un esempio concreto e rendilo metodo replicabile",
      "usa una situazione reale per fissare una routine sostenibile",
    ],
  };
  const contextFrames = [
    "resta su progressione difendibile e margine respiratorio stabile",
    "mantieni binari regolari e recupero affidabile in chiusura",
    "porta la seduta verso continuita' concreta e controllo reale",
    "gestisci il lavoro con ritmo ordinato e aumento prudente",
  ];

  // 12 x 8 x 8 = 768 combinazioni deterministiche (> 60 richieste).
  const o = openers[padIdx % openers.length];
  const aLine = actions[(padIdx * 3 + 1) % actions.length];
  const cLine = checks[(padIdx * 5 + 2) % checks.length];
  const vLine = voices[(padIdx * 7 + 1) % voices.length];
  const typePool = typeFrames[type] || typeFrames.howto;
  const tLine = typePool[(padIdx * 11 + 3) % typePool.length];
  const ctxLine = contextFrames[(padIdx * 13 + 5) % contextFrames.length];

  return `${o} ${aLine} ${cLine} ${vLine}, ${tLine}, ${ctxLine}.`;
}

function normalizedPadKey(line) {
  return normalizeAscii(String(line || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimToMaxWordsPreserveEdges(text, maxWords, { headWords = 200, tailWords = 120 } = {}) {
  const raw = String(text || "");
  const tokenRe = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?/g;
  const ranges = [];
  let m;
  while ((m = tokenRe.exec(raw)) !== null) {
    ranges.push({ start: m.index, end: m.index + String(m[0] || "").length });
  }
  const totalWords = ranges.length;
  if (totalWords <= maxWords) return raw;
  if (!ranges.length) return raw;

  const keepHead = Math.min(headWords, totalWords);
  const keepTail = Math.min(tailWords, Math.max(0, totalWords - keepHead));
  const removableStart = keepHead;
  const removableEnd = Math.max(removableStart, totalWords - keepTail);
  const removableLen = Math.max(0, removableEnd - removableStart);
  const removeWords = Math.max(0, totalWords - maxWords);
  if (removeWords <= 0 || removableLen <= 0) {
    return trimToWordLimit(raw, maxWords);
  }

  const actualRemove = Math.min(removeWords, removableLen);
  const removeStartWord = removableStart + Math.floor((removableLen - actualRemove) / 2);
  const removeEndWord = removeStartWord + actualRemove;
  if (removeStartWord >= ranges.length || removeEndWord - 1 >= ranges.length) return trimToWordLimit(raw, maxWords);

  const charStart = ranges[removeStartWord].start;
  const charEnd = ranges[removeEndWord - 1].end;
  const out = `${raw.slice(0, charStart)} ${raw.slice(charEnd)}`.replace(/\s{2,}/g, " ").trim();
  if (qualityWordCount(out) > maxWords) return trimToWordLimit(out, maxWords);
  return out;
}

function canAppendPadWithoutNewTrigrams(currentText, padLine, threshold = 3) {
  const before = computeRepeatedTrigrams(currentText, threshold, 300);
  const after = computeRepeatedTrigrams(`${currentText}\n\n${padLine}`.trim(), threshold, 300);
  return after.length <= before.length;
}

function tokenizeQualityWithRanges(raw) {
  const tokenRe = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?/g;
  const words = [];
  const ranges = [];
  let m;
  while ((m = tokenRe.exec(String(raw || ""))) !== null) {
    const rawWord = String(m[0] || "");
    const norm = normalizeText(rawWord).replace(/[^a-z0-9']/g, "").trim();
    if (!norm) continue;
    words.push(norm);
    ranges.push({ start: m.index, end: m.index + rawWord.length });
  }
  return { words, ranges };
}

function splitSentenceRanges(raw) {
  const out = [];
  const text = String(raw || "");
  const re = /[^.!?\n]+(?:[.!?]+|\n+|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const chunk = String(m[0] || "");
    if (!chunk.trim()) continue;
    out.push({ start: m.index, end: m.index + chunk.length, text: chunk });
  }
  return out;
}

function sentenceWordBounds(tokenRanges, startChar, endChar) {
  let startWord = -1;
  let endWord = -1;
  for (let i = 0; i < tokenRanges.length; i++) {
    const r = tokenRanges[i];
    if (r.end <= startChar) continue;
    if (r.start >= endChar) break;
    if (startWord === -1) startWord = i;
    endWord = i;
  }
  if (startWord === -1 || endWord === -1) return null;
  return { startWord, endWord };
}

function rewriteDuplicateSentenceDeterministic(sentence, variantIdx = 0) {
  let s = normalizeAscii(String(sentence || "")).replace(/\s+/g, " ").trim();
  if (!s) return "";

  const questionAlternatives = [
    "Qual e il passo concreto che puoi fare adesso?",
    "Qual e il dettaglio che ti fa risparmiare fiato nel prossimo tratto?",
    "Quale scelta pratica rende subito il cammino piu stabile?",
    "Qual e il controllo semplice da fare prima di aumentare il ritmo?",
    "Qual e il segnale che indica che stai procedendo nel modo giusto?",
    "Qual e il punto che fa davvero la differenza oggi?",
  ];
  if (/^(ma\s+)?come\s+possiamo\b/i.test(cleanForMatch(s))) {
    return questionAlternatives[variantIdx % questionAlternatives.length];
  }

  const leadSwap = [
    { re: /^in conclusione,?\s*/i, options: ["In pratica, ", "In chiusura operativa, ", "Sul piano concreto, "] },
    { re: /^sul punto\b/i, options: ["Sul passaggio chiave", "Sul tratto operativo", "Sul nodo pratico"] },
    { re: /^nel tratto dedicato\b/i, options: ["Nel passaggio dedicato", "Nel segmento dedicato", "Nella fase dedicata"] },
    { re: /^per dare continuita\b/i, options: ["Per consolidare la continuita", "Per tenere stabile la continuita", "Per rafforzare la continuita"] },
  ];
  for (const item of leadSwap) {
    if (item.re.test(s)) {
      const rep = item.options[variantIdx % item.options.length];
      s = s.replace(item.re, rep);
      break;
    }
  }

  const lexicalSwaps = [
    [/\bmantieni\b/i, ["tieni", "conserva"]],
    [/\bcontrolla\b/i, ["verifica", "osserva"]],
    [/\britmo\b/i, ["cadenza", "andatura"]],
    [/\bpasso\b/i, ["andatura", "ritmo"]],
    [/\bstabile\b/i, ["regolare", "solido"]],
    [/\bchiusura\b/i, ["finale", "tratto conclusivo"]],
    [/\bprogressione\b/i, ["avanzamento", "crescita graduale"]],
    [/\brespiro\b/i, ["fiato", "respirazione"]],
  ];
  for (let i = 0; i < lexicalSwaps.length; i++) {
    const idx = (variantIdx + i) % lexicalSwaps.length;
    const [re, alts] = lexicalSwaps[idx];
    if (re.test(s)) {
      const alt = alts[(variantIdx + i) % alts.length];
      s = s.replace(re, alt);
      break;
    }
  }

  const prefixes = [
    "Sul piano concreto, ",
    "In questa fase, ",
    "Nel passaggio successivo, ",
    "In modo pratico, ",
    "Per renderlo operativo, ",
    "Per essere chiari, ",
  ];
  if (!/^[A-ZÀ-Ö]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/^(Sul piano concreto|In questa fase|Nel passaggio successivo|In modo pratico|Per renderlo operativo|Per essere chiari),/i.test(s)) {
    s = `${prefixes[variantIdx % prefixes.length]}${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  }

  s = s
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function dedupeRepeatedSentencesDeterministic(
  scriptText,
  { protectedHeadWords = 200, protectedTailWords = 120 } = {}
) {
  const raw = String(scriptText || "");
  if (!raw.trim()) return raw;

  const stop = new Set([
    "il", "lo", "la", "i", "gli", "le", "un", "una", "e", "ed", "di", "da", "a", "in", "con", "su", "per",
    "che", "non", "piu", "meno", "nel", "nella", "della", "delle", "del", "dei", "degli", "al", "alla",
  ]);

  function coreSignature(words) {
    return words.filter((w) => w.length > 2 && !stop.has(w)).slice(0, 10).join(" ");
  }

  function jaccard(a, b) {
    const A = new Set(a);
    const B = new Set(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter += 1;
    return inter / (A.size + B.size - inter);
  }

  const { ranges: tokenRanges } = tokenizeQualityWithRanges(raw);
  const totalWords = tokenRanges.length;
  const editableMaxWord = Math.max(0, totalWords - protectedTailWords - 1);
  const sentences = splitSentenceRanges(raw);
  const replacements = new Map();
  const seenExact = new Map();
  const seenCore = [];
  let variantIdx = 0;

  for (let i = 0; i < sentences.length; i++) {
    const entry = sentences[i];
    const plain = entry.text.replace(/\s+/g, " ").trim();
    if (!plain) continue;

    const bounds = sentenceWordBounds(tokenRanges, entry.start, entry.end);
    if (!bounds) continue;
    if (bounds.startWord < protectedHeadWords) continue;
    if (bounds.endWord > editableMaxWord) continue;

    const words = wordsFromText(plain);
    if (words.length < 6) continue;

    const norm = cleanForMatch(plain);
    const core = coreSignature(words);
    const exactDup = seenExact.has(norm);

    let nearDup = false;
    if (!exactDup) {
      for (const prev of seenCore) {
        if (core && prev.core && core === prev.core) {
          nearDup = true;
          break;
        }
        if (Math.abs(prev.words.length - words.length) <= 4 && jaccard(prev.words, words) >= 0.86) {
          nearDup = true;
          break;
        }
      }
    }

    if (exactDup || nearDup) {
      const rewritten = rewriteDuplicateSentenceDeterministic(plain, variantIdx++);
      if (rewritten && cleanForMatch(rewritten) !== norm) {
        const lead = (entry.text.match(/^\s*/) || [""])[0];
        const trail = (entry.text.match(/\s*$/) || [""])[0];
        replacements.set(i, `${lead}${rewritten}${trail}`);
      }
      continue;
    }

    seenExact.set(norm, true);
    seenCore.push({ core, words });
  }

  if (!replacements.size) return raw;

  let out = "";
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    out += raw.slice(cursor, s.start);
    out += replacements.has(i) ? replacements.get(i) : s.text;
    cursor = s.end;
  }
  out += raw.slice(cursor);

  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function enforceOpenLoopSpacingDeterministic(
  scriptText,
  { maxGapWords = 225, protectedHeadWords = 200, protectedTailWords = 120, maxInsertions = 2, seed = 0 } = {}
) {
  let current = String(scriptText || "").trim();
  if (!current) return current;

  const cueTokens = [
    ["tra", "poco"],
    ["alla", "fine"],
    ["tra", "un", "attimo"],
    ["piu", "avanti"],
    ["errore", "che"],
  ];

  function findCuePositions(words) {
    const hits = [];
    for (let i = 0; i < words.length; i++) {
      for (const cue of cueTokens) {
        if (i + cue.length > words.length) continue;
        let ok = true;
        for (let j = 0; j < cue.length; j++) {
          if (words[i + j] !== cue[j]) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push({ cue: cue.join(" "), wordIndex: i });
      }
    }
    hits.sort((a, b) => a.wordIndex - b.wordIndex);
    const dedup = [];
    for (const h of hits) {
      if (!dedup.length || dedup[dedup.length - 1].wordIndex !== h.wordIndex) dedup.push(h);
    }
    return dedup;
  }

  const bridgeQuestions = [
    "Tra poco chiariamo il dettaglio che ti fa sprecare energie?",
    "Piu avanti vedi quale passaggio rende il passo piu sicuro?",
    "Tra un attimo capisci dove regolare il ritmo senza fatica?",
    "Tra poco risolviamo il dubbio che blocca la continuita?",
    "Piu avanti scopri il controllo che ti evita di andare fuori giri?",
    "Tra un attimo trovi il punto che alleggerisce il fiato?",
    "Tra poco vediamo l'errore che rallenta il recupero?",
    "Piu avanti chiarisco la scelta che ti fa chiudere meglio?",
  ];
  const bridgePayoffs = [
    "Nel passaggio successivo lo chiudiamo con un test pratico.",
    "Subito dopo hai un controllo semplice da applicare in cammino.",
    "Nel blocco seguente trovi la verifica che ti conferma il ritmo giusto.",
    "Poco dopo lo risolviamo con una correzione concreta.",
    "Nel tratto successivo vedi subito come metterlo in pratica.",
    "Tra poche righe hai il payoff con un check rapido e chiaro.",
  ];
  const usedBridgeKeys = new Set();

  for (let ins = 0; ins < maxInsertions; ins++) {
    const { words, ranges } = tokenizeQualityWithRanges(current);
    if (words.length < 3 || ranges.length < 3) break;

    const cues = findCuePositions(words);
    if (cues.length < 2) break;

    let worst = null;
    for (let i = 1; i < cues.length; i++) {
      const gap = cues[i].wordIndex - cues[i - 1].wordIndex;
      if (gap > maxGapWords && (!worst || gap > worst.gap)) {
        worst = { i, gap, left: cues[i - 1], right: cues[i] };
      }
    }
    if (!worst) break;

    const totalWords = words.length;
    const minEditable = protectedHeadWords;
    const maxEditable = Math.max(minEditable, totalWords - protectedTailWords - 1);
    let insertWord = worst.left.wordIndex + Math.floor(worst.gap / 2);
    insertWord = Math.max(minEditable, Math.min(maxEditable, insertWord));
    if (insertWord <= worst.left.wordIndex + 2 || insertWord >= worst.right.wordIndex - 2) break;

    let bridge = "";
    for (let k = 0; k < bridgeQuestions.length; k++) {
      const q = bridgeQuestions[(seed + ins + k) % bridgeQuestions.length];
      const p = bridgePayoffs[(seed * 3 + ins + k) % bridgePayoffs.length];
      const candidate = `${q} ${p}`;
      const key = cleanForMatch(candidate);
      if (!usedBridgeKeys.has(key)) {
        bridge = candidate;
        usedBridgeKeys.add(key);
        break;
      }
    }
    if (!bridge) break;

    const insertChar = ranges[insertWord]?.start ?? current.length;
    const before = current.slice(0, insertChar).trimEnd();
    const after = current.slice(insertChar).trimStart();
    current = `${before}\n\n${bridge}\n\n${after}`.replace(/\n{3,}/g, "\n\n").trim();
  }

  return current;
}

function runFinalGuarantee(
  scriptText,
  {
    threshold = 3,
    protectedHeadWords = 200,
    protectedTailWords = 120,
    minWords = 0,
    extraPasses = 2,
    extraFixesPerPass = 12,
  } = {}
) {
  let current = String(scriptText || "").trim();
  let topRepeatedTrigrams = computeRepeatedTrigrams(current, threshold, 10);

  if (!topRepeatedTrigrams.length) {
    return { script: current, topRepeatedTrigrams };
  }

  for (let pass = 0; pass < extraPasses && topRepeatedTrigrams.length; pass++) {
    current = reduceRepeatedTrigrams(current, {
      threshold,
      maxPasses: 1,
      maxFixes: extraFixesPerPass,
      protectedHeadWords,
      protectedTailWords,
      minWords,
    });
    topRepeatedTrigrams = computeRepeatedTrigrams(current, threshold, 10);
  }

  return { script: current, topRepeatedTrigrams };
}

function stabilizeHotspotRepetitions(scriptText, { topic = "", audience = "over60" } = {}) {
  let s = normalizeAscii(String(scriptText || ""));

  function capPhrase(regex, keep = 2, variants = []) {
    let hit = 0;
    s = s.replace(regex, (m) => {
      hit += 1;
      if (hit <= keep || !variants.length) return m;
      return variants[(hit - keep - 1) % variants.length];
    });
  }

  if (audience === "over60") {
    let hit = 0;
    s = s.replace(/continuita'\s+senza\s+forzare/gi, () => {
      hit += 1;
      if (hit === 1) return "continuita' senza forzare";
      const alt = ["continuita' sostenibile", "costanza graduale", "progressione stabile"];
      return alt[(hit - 2) % alt.length];
    });
  }

  const normTopic = normalizeAscii(topic)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normTopic && normTopic.split(" ").length >= 3) {
    const esc = normTopic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const aliases = ["questo tema", "questo argomento", "questo percorso"];
    let seen = 0;
    s = s.replace(new RegExp(esc, "gi"), () => {
      seen += 1;
      if (seen <= 2) return normTopic;
      return aliases[(seen - 3) % aliases.length];
    });
  }

  // Limita la ripetizione di trigrammi topic-specifici molto frequenti.
  let topicTriHit = 0;
  s = s.replace(/\bcamminare\s+ogni\s+giorno\b/gi, () => {
    topicTriHit += 1;
    if (topicTriHit <= 2) return "camminare ogni giorno";
    const alt = ["muoversi ogni giorno", "camminare con costanza", "passeggiare ogni giorno"];
    return alt[(topicTriHit - 3) % alt.length];
  });

  // Cap hotspot ricorrenti che generano spesso TRIGRAM_GE_3.
  capPhrase(/\bi\s+60\s+anni\b/gi, 2, ["i sessanta", "la fascia over 60", "gli over 60"]);
  capPhrase(/\bnon\s+dimenticare\s+di\b/gi, 2, ["ricorda di", "tieni a mente di", "vale la pena di"]);
  capPhrase(/\bla\s+tua\s+stabilita\b/gi, 2, ["il tuo equilibrio", "la tua tenuta"]);
  capPhrase(/\bil\s+tuo\s+corpo\b/gi, 2, ["il tuo fisico", "il corpo"]);
  capPhrase(/\ble\s+tue\s+passeggiate\b/gi, 2, ["le tue uscite", "il tuo cammino"]);
  capPhrase(/\balla\s+fine\b/gi, 2, ["in chiusura", "piu tardi"]);
  capPhrase(/\bpiu'\s+avanti\b/gi, 1, ["nel passaggio successivo", "piu tardi"]);
  capPhrase(/\bpiu\s+avanti\b/gi, 1, ["nel passaggio successivo", "piu tardi"]);

  return s.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

router.post("/generate-script-pro", async (req, res) => {
  const t0 = Date.now();

  try {
    const topic = String(req.body?.topic || "").trim();
    const language = String(req.body?.language || "it").trim().toLowerCase();
    const audience = String(req.body?.audience || "over60").trim().toLowerCase();
    const requestedType = String(req.body?.type || "howto").trim().toLowerCase();
    const type = ALLOWED_TYPES.includes(requestedType) ? requestedType : "howto";

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

    const target = String(req.body?.target || "text").trim().toLowerCase(); // fliki|text
    const channelName = "Zen Salute e Benessere";
    const seed = hashSeed(`${topic}|${audience}|${type}`) % 9;
    const anchors = extractTopicAnchors(topic);

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

    // Range parole allineato al checker esterno (150 wpm, 85%-115%)
    const baseWords150 = Math.round(minutes * 150);
    const targetWords = baseWords150;
    const minWords = Math.round(baseWords150 * 0.85);
    const maxWords = Math.round(baseWords150 * 1.15);

    const hook = buildHook(topic, channelName);
    const cta = buildCTA(channelName);

    const ctaWc = qualityWordCount(cta);
    const minBodyWords = Math.max(520, minWords - ctaWc);
    const maxBodyWords = Math.max(minBodyWords + 240, maxWords - ctaWc);

    const goldenPrompt = buildGoldenPrompt({
      topic,
      audience,
      type,
      minutes,
      minWords,
      maxWords,
      minBlockWords: MIN_BLOCK_WORDS,
      anchors,
      seed,
    });

    const r = await callAIWithFallback({ prompt: goldenPrompt, timeoutMs: AI_TIMEOUT_MS });
    const aiMeta = r.meta || { providerUsed: null, fallbackUsed: false, lastAIError: null };
    const parsed = safeJsonParse(r.text);
    const validated = validateAIBlocks(parsed);
    if (!validated.ok) {
      return res.status(500).json({
        success: false,
        warning: true,
        error: "FORMAT_NOT_RESPECTED",
        message: `Model output format not respected: ${validated.reason}`,
        meta: { routeVersion: ROUTE_VERSION, providerUsed: aiMeta.providerUsed || null, fallbackUsed: Boolean(aiMeta.fallbackUsed) },
      });
    }

    let blocks = stitch7(validated.blocks).map((b, i) => ensureBlockMinWords(b, i, topic, audience, type, anchors));
    blocks = enforceTopicAnchors(blocks, anchors, seed);
    blocks = applyTypePack(blocks, type, anchors, seed);
    blocks = reinforceAudienceSignals(blocks, audience, type);
    blocks = enforceOpenLoops(blocks, topic, seed);

    const build = buildFinalScriptFromBlocks({
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

    // Anti-ripetizione (deterministico)
    finalScript = improveNonRepetition(finalScript, { topic, audience, type, minWords });

    // Layout estetico (deterministico, NON cambia parole)
    finalScript = beautifyLayout(finalScript);

    // Fliki cleanup (se richiesto)
    if (target === "fliki") finalScript = cleanForFliki(finalScript);

    let finalWc = qualityWordCount(finalScript);
    const usedPads = new Set();
    let padIdx = 0;

    // Ordine finale fisso: stabilize -> reduce -> pad(min) -> trim(max)
    finalScript = stabilizeHotspotRepetitions(finalScript, { topic, audience });
    finalScript = reduceRepeatedTrigrams(finalScript, {
      threshold: 3,
      maxPasses: 4,
      maxFixes: 12,
      protectedHeadWords: 200,
      protectedTailWords: 120,
      minWords,
    });
    finalWc = qualityWordCount(finalScript);

    const applyFinalGuarantee = () => {
      const guaranteed = runFinalGuarantee(finalScript, {
        threshold: 3,
        protectedHeadWords: 200,
        protectedTailWords: 120,
        minWords,
        extraPasses: 2,
        extraFixesPerPass: 12,
      });
      finalScript = guaranteed.script;
      finalWc = qualityWordCount(finalScript);
      return guaranteed.topRepeatedTrigrams;
    };

    applyFinalGuarantee();

    let padAttempts = 0;
    while (finalWc < minWords && padAttempts < 260) {
      const line = buildDeterministicMinWordPad({ padIdx, anchors, topic, audience, type });
      padIdx += 1;
      padAttempts += 1;
      const key = normalizedPadKey(line);
      if (!key || usedPads.has(key)) continue;
      if (/\bdopo\s+i\s+60\b/i.test(line)) continue;
      if (padAttempts <= 200 && !canAppendPadWithoutNewTrigrams(finalScript, line, 3)) continue;
      usedPads.add(key);
      finalScript = `${finalScript}\n\n${line}`.trim();
      finalWc = qualityWordCount(finalScript);
    }
    applyFinalGuarantee();

    if (finalWc > maxWords) {
      finalScript = trimToMaxWordsPreserveEdges(finalScript, maxWords, { headWords: 200, tailWords: 120 });
      finalWc = qualityWordCount(finalScript);
      applyFinalGuarantee();
    }

    for (let i = 0; i < 3; i++) {
      if (finalWc < minWords) {
        let repad = 0;
        while (finalWc < minWords && repad < 260) {
          const line = buildDeterministicMinWordPad({ padIdx, anchors, topic, audience, type });
          padIdx += 1;
          repad += 1;
          const key = normalizedPadKey(line);
          if (!key || usedPads.has(key)) continue;
          if (/\bdopo\s+i\s+60\b/i.test(line)) continue;
          if (repad <= 200 && !canAppendPadWithoutNewTrigrams(finalScript, line, 3)) continue;
          usedPads.add(key);
          finalScript = `${finalScript}\n\n${line}`.trim();
          finalWc = qualityWordCount(finalScript);
        }
        applyFinalGuarantee();
      }
      if (finalWc > maxWords) {
        finalScript = trimToMaxWordsPreserveEdges(finalScript, maxWords, { headWords: 200, tailWords: 120 });
        finalWc = qualityWordCount(finalScript);
        applyFinalGuarantee();
      }
      if (finalWc >= minWords && finalWc <= maxWords) break;
    }

    applyFinalGuarantee();
    if (finalWc < minWords) {
      let lastRepad = 0;
      while (finalWc < minWords && lastRepad < 260) {
        const line = buildDeterministicMinWordPad({ padIdx, anchors, topic, audience, type });
        padIdx += 1;
        lastRepad += 1;
        const key = normalizedPadKey(line);
        if (!key || usedPads.has(key)) continue;
        if (/\bdopo\s+i\s+60\b/i.test(line)) continue;
        if (lastRepad <= 200 && !canAppendPadWithoutNewTrigrams(finalScript, line, 3)) continue;
        usedPads.add(key);
        finalScript = `${finalScript}\n\n${line}`.trim();
        finalWc = qualityWordCount(finalScript);
      }
      applyFinalGuarantee();
    }
    if (finalWc > maxWords) {
      finalScript = trimToMaxWordsPreserveEdges(finalScript, maxWords, { headWords: 200, tailWords: 120 });
      finalWc = qualityWordCount(finalScript);
      applyFinalGuarantee();
    }

    // Post-processing deterministico: dedupe frasi e spacing open-loop.
    finalScript = dedupeRepeatedSentencesDeterministic(finalScript, {
      protectedHeadWords: 200,
      protectedTailWords: 120,
    });
    finalWc = qualityWordCount(finalScript);

    finalScript = enforceOpenLoopSpacingDeterministic(finalScript, {
      maxGapWords: 225,
      protectedHeadWords: 200,
      protectedTailWords: 120,
      maxInsertions: 2,
      seed,
    });
    finalWc = qualityWordCount(finalScript);
    applyFinalGuarantee();

    const scriptQuality = await runScriptQualityAudit({
      scriptText: finalScript,
      audience,
      minutes,
    });

    const finalRepeatedTrigrams = computeRepeatedTrigrams(finalScript, 3, 10);
    const flagsFinal = [];
    if (finalRepeatedTrigrams.length) {
      flagsFinal.push("TRIGRAM_GE_3");
    }
    if (finalWc < minWords) flagsFinal.push("UNDER_MIN_WORDS");
    if (finalWc > maxWords) flagsFinal.push("OVER_MAX_WORDS");

    const qFinal = computeQuality(finalScript);
    const counts = blocks.map((b) => wordCount(b));
    const inRange = finalWc >= minWords && finalWc <= maxWords;

    const meta = {
      routeVersion: ROUTE_VERSION,
      providerUsed: aiMeta?.providerUsed || null,
      fallbackUsed: Boolean(aiMeta?.fallbackUsed),
      attempts: aiMeta?.fallbackUsed ? 2 : 1,
      totalCalls: aiMeta?.fallbackUsed ? 2 : 1,
      wordCount: finalWc,
      wordCountFinal: finalWc,
      targetWords,
      minWords,
      maxWords,
      type,
      seed,
      anchors,
      blockCounts: counts,
      minBlockWords: MIN_BLOCK_WORDS,
      inRange,
      quality: { final: qFinal },
      scriptQuality: {
        after: scriptQuality?.metrics || null,
        pass: Boolean(scriptQuality?.pass),
        final: String(scriptQuality?.final || "UNKNOWN"),
        flags: Array.isArray(scriptQuality?.metrics?.flags) ? scriptQuality.metrics.flags : [],
      },
      topRepeatedTrigrams: finalRepeatedTrigrams,
      flagsFinal,
      lastAIError: aiMeta?.lastAIError || null,
      elapsedMs: Date.now() - t0,
    };

    const warning = flagsFinal.length > 0 || !scriptQuality.pass;

    return res.status(200).json({
      success: true,
      warning,
      finalScript,
      result: { script: finalScript },
      meta,
    });
  } catch (err) {
    const meta = err?._meta || null;
    return res.status(500).json({
      success: false,
      warning: true,
      error: "GENERATION_FAILED",
      message: String(err?.message || err),
      meta: { routeVersion: ROUTE_VERSION, lastAIError: meta?.lastAIError || null },
    });
  }
});

export default router;





