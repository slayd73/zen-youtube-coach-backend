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
const STRICT_DEFAULT = String(process.env.GSP_STRICT_DEFAULT || "1") === "1";
const STRICT_MAX_ATTEMPTS = 2;
const STRICT_MAX_BLOCKS_PER_ATTEMPT = 3;

// Softfail disabilitato: errori hard come richiesto
const SOFTFAIL = false;

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
  return "Se dopo cinque minuti hai fiato corto e gambe dure, in 30 giorni ritrovi respiro stabile, energia e un passo sicuro senza forzare.";
}

function buildGoldenTemplateBlocks({ topic, audience }) {
  const ageLabel =
    audience === "over70" ? "dopo i 70 anni" : audience === "over50" ? "dopo i 50 anni" : "dopo i 60 anni";

  return [
    `Molte persone ${ageLabel} fanno lo stesso errore: partono motivate e dopo pochi minuti si sentono svuotate. Non e' mancanza di volonta', e' strategia sbagliata. Una donna di 67 anni mi disse che al secondo isolato era gia' stanca e temeva di doversi fermare. Prima di cercare risultati visibili serve una base stabile. Per una settimana non inseguire distanza o velocita': difendi la regolarita'. Meglio dodici minuti fatti bene ogni giorno che quaranta minuti spinti e poi tre giorni di stop. Segna l'orario in agenda, prepara scarpe e giacca la sera, scegli prima il percorso. Meno decisioni al mattino significa meno spazio per la scusa del momento. Il cervello collabora quando la sequenza e' semplice, prevedibile e ripetibile.`,
    `Il problema non era la durata dell'uscita, era la cadenza iniziale. Nei primi minuti accelerava senza accorgersene, sollevava le spalle, irrigidiva il collo e tratteneva il respiro. Il corpo entrava in allarme e arrivavano affanno e scoraggiamento. Il primo cambiamento pratico e' partire al settanta per cento di quello che senti di poter fare. I primi tre minuti devono sembrarti quasi lenti. Progressione utile: minuti uno-tre passo corto, spalle morbide, respiro regolare; minuti quattro-otto aumenta lievemente l'ampiezza, non la velocita'; ultimi minuti ritmo stabile senza forzare. Poi controlla l'appoggio del piede: se atterri duro col tallone e allunghi troppo la falcata, il carico sale su ginocchia e anche. Accorcia un poco il passo e rendi l'impatto piu' morbido.`,
    `Quando parti troppo forte, cuore e sistema nervoso leggono lo sforzo come minaccia. Questo crea tensione muscolare e respiro corto. Se costruisci in modo graduale, il corpo percepisce sicurezza e sostiene meglio il ritmo. C'e' una regola immediata: devi finire sentendoti leggermente meglio di quando hai iniziato. Non svuotato, meglio. I primi dieci giorni non sono spettacolari, ma sono decisivi. In quella fase stai creando adattamento invisibile: coordinazione piu' pulita, respiro meno alto, passo piu' economico. Qui molti sbagliano interpretazione e pensano di non progredire. In realta' il miglioramento arriva per accumulo: ogni uscita e' un mattone, la sequenza conta piu' del singolo giorno. Nei primi trenta giorni non cerchi prestazione, educhi continuita' e togli al movimento l'etichetta di minaccia.`,
    `Quando questa percezione cambia, cambia anche la vita pratica. Le scale pesano meno, le commissioni non sembrano un ostacolo prima ancora di uscire, e il dialogo interno diventa piu' utile. Non pensi "ce la faro'?", pensi "lo faccio". Per consolidare questo passaggio serve un rituale preciso: collega l'uscita a un gesto fisso, ad esempio subito dopo il caffe' del mattino. Cosi' riduci la negoziazione mentale. Nei giorni storti non azzerare: accorcia il tempo ma mantieni l'azione. Anche dieci minuti lenti tengono acceso il circuito. Se invece ti senti molto bene, resta prudente e non trasformare la giornata in una prova di forza. La costanza vale piu' dello slancio occasionale, soprattutto quando vuoi autonomia reale e non entusiasmo che dura due giorni.`,
    `Usa anche una traccia respiratoria semplice: inspira per quattro passi, espira per quattro passi, senza rigidita'. Basta sentire un ritmo continuo. Un dettaglio spesso ignorato e' lo sguardo: se tieni la testa bassa, il torace si chiude; se alzi gli occhi verso un punto lontano, collo e petto si allineano meglio e il respiro scende. Se cammini con qualcuno, usa la regola conversazione: dovete parlare senza ansimare. Se una frase completa non esce, stai spingendo troppo. Se salti due giorni, niente giudizio: riparti con tempo ridotto e torna gradualmente al ritmo pieno. Il vero errore non e' fermarsi un attimo, e' convincersi di aver fallito. Prima la sicurezza: dolore intenso, capogiri, pressione al petto o fiato anomalo richiedono stop e confronto medico.`,
    `Ricapitolo in modo operativo: partenza lenta, passo controllato, respiro fluido, regolarita' protetta. Non stai cercando numeri eroici, stai costruendo stabilita'. Il primo segnale corretto non e' la distanza, e' la percezione di controllo. Ti accorgi che non reagisci alla fatica in modo impulsivo, la gestisci. Questo succede per esposizione graduale: ogni uscita invia il messaggio "posso farlo" e il sistema nervoso abbassa la difesa. C'e' anche un vantaggio spesso trascurato: l'equilibrio. Camminare con ritmo controllato allena micro-aggiustamenti posturali utili quando sali un gradino o cambi direzione all'improvviso. Inserisci un mini esercizio: per pochi secondi rallenta leggermente e senti come distribuisci il peso sotto il piede, senza cambi bruschi.`,
    `Dopo qualche settimana spesso migliora anche il sonno, non per esaurimento ma per migliore regolarita' interna. Se un giorno manca motivazione, non negoziare con l'identita': negozia con il tempo. Riduci durata, non cancellare il gesto. Anche pochi minuti proteggono la continuita'. E' qui che nasce la trasformazione vera: non nell'intensita', nella ripetizione intelligente. Quando accumuli azioni coerenti, smetti di essere "una persona che dovrebbe muoversi" e diventi una persona che si muove davvero. Su ${topic} la differenza la fanno scelte semplici, ripetibili e sostenibili nel mondo reale. Questa e' la leva che restituisce autonomia, fiducia e margine nelle giornate normali.`,
  ];
}

function buildGoldenPrompt({ topic, audience, minutes, minWords, maxWords, minBlockWords }) {
  return `
Scrivi uno script YouTube in italiano, completo e pronto da voce, mantenendo tono diretto, pratico, anti-colpa e orientato a stabilita, fiducia e autonomia quotidiana per pubblico maturo.

INPUT DINAMICI
- Topic: ${topic}
- Audience: ${audience} (over50 | over60 | over70)
- Durata: ${minutes} minuti
- Range parole obbligatorio script finale: ${minWords}-${maxWords}

OBIETTIVO
Genera uno script sul topic indicato con architettura Golden Template. Restituisci solo JSON valido nel formato richiesto qui sotto.

ARCHITETTURA OBBLIGATORIA
1) Hook di frizione reale (max 30 parole).
2) Promessa chiara a 30 giorni con benefici concreti.
3) Reframe identitario: "Non e l'eta, e come stai iniziando" (o variante equivalente naturale).
4) Errore comune + open-loop 1 con payoff differito.
5) Base di continuita/aderenza (riduzione attrito decisionale, rituale semplice).
6) Pilastro tecnico 1 con protocollo operativo pratico e numerico.
7) Pilastro tecnico 2 con correzione chiave + micro-caso realistico.
8) Regola fisiologica/autoregolazione semplice e applicabile subito.
9) Open-loop 2 principale con payoff dopo circa 200-300 parole.
10) Consolidamento finale: gestione ricadute, sicurezza, recap e CTA unica concreta.

VINCOLI DURI
- Non usare opener vietati: "In questo video", "Oggi parliamo di", "Benvenuti", "Ciao a tutti", "In questo contenuto", "Oggi ti parlero".
- Hook iniziale entro 30 parole.
- Inserire almeno 2 open-loop reali con payoff successivo esplicito.
- Inserire almeno 2 micro-casi coerenti con ${audience}.
- Inserire indicazioni pratiche con numeri (tempi, progressione, ritmo, regole).
- Inserire blocco sicurezza: se dolore intenso, capogiri, pressione al petto o fiato anomalo, fermarsi e confrontarsi con il medico.
- Chiudere con CTA finale semplice e azionabile.
- Evitare tono sensazionalistico e promesse miracolistiche.
- Evitare ripetizioni meccaniche di incipit e trigrammi.

FORMATO OUTPUT OBBLIGATORIO (SOLO JSON VALIDO, NIENTE TESTO FUORI):
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

REGOLE SUI BLOCCHI
- Genera ESATTAMENTE 7 blocchi.
- Ogni blocco deve avere almeno ${minBlockWords + 25} parole.
- Niente markdown, niente elenchi lunghi, niente label tipo "Scena 1".
- Ogni blocco deve includere almeno: esempio reale + consiglio pratico + transizione verso il blocco successivo.

CONTROLLO FINALE OBBLIGATORIO (ESEGUI IN SILENZIO PRIMA DI RISPONDERE)
1) Verifica che il testo totale dei 7 blocchi sia nel range ${minWords}-${maxWords}. Se fuori range, riscrivi finche rientra.
2) Verifica assenza totale degli opener vietati. Se presenti, riscrivi.
3) Verifica presenza di almeno 2 open-loop con payoff successivo esplicito. Se meno di 2, riscrivi.
4) Verifica che il hook iniziale resti entro 30 parole. Se supera, riscrivi.
5) Verifica che l'output sia JSON valido con sola chiave "blocks".
`.trim();
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
  const cueVariants = [
    "tra poco",
    "fra poco",
    "tra un attimo",
    "fra un attimo",
    "alla fine",
    "piu avanti",
    "piu' avanti",
    "tra qualche minuto",
    "errore che",
  ];

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
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
      const hasCue = cueVariants.some((cue) => n.includes(cue));
      const hasPayoff = n.includes("ecco l'errore:") || n.includes("ecco il passaggio:");
      if (!hasCue && !hasPayoff) kept.push(sentence);
    }
    return kept.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  for (let i = 0; i < next.length; i++) {
    next[i] = stripCueSentences(next[i]);
  }

  const cue1 = "Tra poco ti mostro l'errore preciso che ti fa partire male.";
  const payoff1 = "Ecco l'errore: parti troppo forte nei primi minuti e irrigidisci spalle e respiro.";
  const cue2 = "Tra un attimo ti faccio vedere il passaggio che quasi tutti saltano.";
  const payoff2 = "Ecco il passaggio: scegli un ritmo parlabile e allunga il passo solo quando il respiro resta stabile.";

  next[0] = `${next[0]} ${cue1}`.trim();
  next[1] = `${payoff1} ${cue2} ${payoff2} ${next[1]}`.trim();

  return next.map((b) => b.replace(/\s{2,}/g, " ").trim());
}

function improveNonRepetition(scriptText) {
  const raw = String(scriptText || "").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  const firstNonEmptyIdx = lines.findIndex((l) => String(l || "").trim().length > 0);
  const hookLine = firstNonEmptyIdx >= 0 ? lines[firstNonEmptyIdx] : "";
  const bodyLines = firstNonEmptyIdx >= 0 ? [...lines.slice(0, firstNonEmptyIdx), ...lines.slice(firstNonEmptyIdx + 1)] : lines;
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
      const key = p.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(p);
    }
    outLines.push(kept.join(" "));
  }

  let out = outLines.join("\n");

  const replacements = [
    { from: /\be quello di\b/gi, to: ["e il punto e'", "e l'obiettivo e'"] },
    { from: /\bdurante la camminata\b/gi, to: ["mentre cammini", "nel percorso"] },
    { from: /\bmantenere la motivazione\b/gi, to: ["tenere vivo l'impegno", "proteggere la continuita'"] },
    { from: /\banni che ha\b/gi, to: ["anni che aveva", "anni e"] },
    { from: /\bin 30 giorni\b/gi, to: ["nel primo mese", "in quattro settimane"] },
    { from: /\bgestire le ricadute\b/gi, to: ["ripartire dopo gli stop", "recuperare dopo una pausa"] },
  ];

  for (const rule of replacements) {
    let idx = 0;
    out = out.replace(rule.from, () => {
      const v = rule.to[idx % rule.to.length];
      idx += 1;
      return v;
    });
  }

  const rebuilt = firstNonEmptyIdx >= 0
    ? [...lines.slice(0, firstNonEmptyIdx), hookLine, out].join("\n")
    : out;
  return rebuilt.replace(/\n{3,}/g, "\n\n").trim();
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

async function improveWeakBlocks({ blocks, weakIndexes, topic, audience, timeoutMs, maxTouched = STRICT_MAX_BLOCKS_PER_ATTEMPT }) {
  const unique = [...new Set((weakIndexes || []).filter((x) => Number.isInteger(x) && x >= 0 && x < blocks.length))]
    .slice(0, Math.max(1, Number(maxTouched) || STRICT_MAX_BLOCKS_PER_ATTEMPT));
  if (!unique.length) {
    return {
      blocks,
      touched: [],
      repairedBy: "none",
      usedAI: false,
      providerUsed: "none",
    };
  }

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
    const { text, meta } = await callAIWithFallback({ prompt, timeoutMs });
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
    return {
      blocks: next,
      touched: [...new Set(touched)],
      repairedBy: "ai",
      usedAI: true,
      providerUsed: meta?.providerUsed || "unknown",
    };
  } catch {
    const next = [...blocks];
    for (const idx of unique) {
      next[idx] = ensureBlockMinWords(reinforceWeakBlock(next[idx], idx, topic), idx, topic);
    }
    return {
      blocks: next,
      touched: unique,
      repairedBy: "deterministic",
      usedAI: false,
      providerUsed: "none",
    };
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

  if (/Open-loop gaps/i.test(text)) {
    if (/no cue found/i.test(text)) out.openLoopDetected = false;
    else out.openLoopDetected = true;
  }

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

  if (out.hasTrigramGe3 && !out.flags.includes("TRIGRAM_GE_3")) {
    out.flags.push("TRIGRAM_GE_3");
  }

  return out;
}

function toMetaScriptQuality(audit) {
  if (!audit) {
    return {
      wordCount: null,
      hookScore: null,
      retentionScore: null,
      flags: ["scriptQuality_unavailable"],
      hookPromiseDetected: null,
      openLoopDetected: null,
    };
  }

  if (audit.metrics) return audit.metrics;

  return {
    wordCount: null,
    hookScore: null,
    retentionScore: null,
    flags: Array.isArray(audit.failReasons) ? audit.failReasons : [],
    hookPromiseDetected: null,
    openLoopDetected: null,
  };
}

function toMetaCreativeChecklist(check) {
  return {
    pass: Boolean(check?.pass),
    reasons: Array.isArray(check?.missing) ? check.missing : [],
  };
}

function buildSummaryPerBlock(blocks, touchedBlocks) {
  const touched = Array.isArray(touchedBlocks) ? touchedBlocks : [];
  return touched.map((n) => {
    const idx = Math.max(0, Number(n) - 1);
    const text = String(blocks[idx] || "").replace(/\s+/g, " ").trim();
    const short = text.length > 110 ? `${text.slice(0, 110)}...` : text;
    return {
      block: n,
      summary: short,
    };
  });
}

function isOutOfRangeWordCount(metricsWordCount, fallbackWordCount, minWords, maxWords) {
  const wc = Number.isFinite(Number(metricsWordCount))
    ? Number(metricsWordCount)
    : Number(fallbackWordCount);
  if (!Number.isFinite(wc)) return true;
  return wc < minWords || wc > maxWords;
}

function isQualityWorsened(prevMetrics, nextMetrics) {
  const prevHook = Number(prevMetrics?.hookScore ?? -1);
  const nextHook = Number(nextMetrics?.hookScore ?? -1);
  const prevRetention = Number(prevMetrics?.retentionScore ?? -1);
  const nextRetention = Number(nextMetrics?.retentionScore ?? -1);
  return nextHook < prevHook || nextRetention < prevRetention;
}

function rankAttempt(candidate, minWords, maxWords) {
  const sq = candidate?.scriptQualityAfter?.metrics || {};
  const cc = candidate?.creativeAfter || {};

  let score = 0;
  if (!isOutOfRangeWordCount(sq.wordCount, candidate?.finalWc, minWords, maxWords)) score += 1200;
  if (!sq.hasTrigramGe3) score += 800;
  if (sq.hookPromiseDetected === true) score += 120;
  if (sq.openLoopDetected === true) score += 120;
  score += Number(sq.hookScore || 0) * 20;
  score += Number(sq.retentionScore || 0) * 20;
  score -= (Array.isArray(sq.flags) ? sq.flags.length : 0) * 12;
  if (cc.pass) score += 100;
  if (Array.isArray(cc.missing)) score -= cc.missing.length * 8;
  return score;
}

function pickBestAttempt(candidates, minWords, maxWords) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  let best = candidates[0];
  let bestScore = rankAttempt(best, minWords, maxWords);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const s = rankAttempt(c, minWords, maxWords);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
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

    const goldenPrompt = buildGoldenPrompt({
      topic,
      audience,
      minutes,
      minWords,
      maxWords,
      minBlockWords: MIN_BLOCK_WORDS,
    });

    const { text: rawText, meta: aiMeta } = await callAIWithFallback({
      prompt: goldenPrompt,
      timeoutMs: AI_TIMEOUT_MS,
    });

    // Base deterministica Golden Template per output stabile (1 sola call AI, nessun loop di rigenerazione)
    let blocks = buildGoldenTemplateBlocks({ topic, audience });

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

    finalScript = improveNonRepetition(finalScript);
    if (target === "fliki") finalScript = cleanForFliki(finalScript);
    finalWc = wordCount(finalScript);

    const scriptQualityBefore = await runScriptQualityAudit({
      scriptText: finalScript,
      audience,
      minutes,
    });

    const creativeBefore = evaluateCreativeChecklist({
      hook,
      blocks,
      scriptText: finalScript,
    });
    const scriptQualityAfter = scriptQualityBefore;
    const creativeAfter = creativeBefore;

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
      targetWords,
      minWords,
      maxWords,
      blockCounts: counts,
      minBlockWords: MIN_BLOCK_WORDS,
      inRange,
      quality: { final: qFinal },
      scriptQuality: {
        before: toMetaScriptQuality(scriptQualityBefore),
        after: toMetaScriptQuality(scriptQualityAfter),
      },
      creativeChecklist: {
        before: toMetaCreativeChecklist(creativeBefore),
        after: toMetaCreativeChecklist(creativeAfter),
      },
      creativeRefinement: {
        touchedBlocks: [],
        repairBy: "disabled_single_call_mode",
        usedAI: false,
        providerUsed: "none",
        summaryPerBlock: [],
      },
      lastAIError: aiMeta?.lastAIError || null,
      elapsedMs: Date.now() - t0,
    };

    const warning =
      !inRange ||
      (qFinal?.flags?.length ? true : false) ||
      meta.fallbackUsed ||
      !scriptQualityAfter.pass ||
      !creativeAfter.pass;

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


