// backend/src/utils/introValidator.js
import fs from "fs";

function countSentences(text) {
  // split semplice: ., !, ? con filtro
  return text
    .split(/[\.\!\?]+/g)
    .map(s => s.trim())
    .filter(Boolean).length;
}

function includesAny(text, list) {
  const t = text.toLowerCase();
  return list.some(p => t.includes(p.toLowerCase()));
}

function hasConcreteBenefit(text) {
  // euristica: deve contenere "ti mostro / ti spiego / imparerai / capirai / scoprirai come"
  const t = text.toLowerCase();
  const patterns = [
    "ti mostro",
    "ti spiego",
    "ti faccio vedere",
    "imparerai",
    "capirai",
    "scoprirai come",
    "come fare",
    "come evitare",
    "come risolvere",
    "cosa fare"
  ];
  return patterns.some(p => t.includes(p));
}

function hasHookSignal(text) {
  // euristica: presenza di promessa + tempo/rapidità o valore
  const t = text.toLowerCase();
  const patterns = [
    "tra poco",
    "in pochi minuti",
    "in questo video ti",
    "oggi ti",
    "alla fine di questo video",
    "ti porterò",
    "ti darò"
  ];
  return patterns.some(p => t.includes(p));
}

export function validateIntro({ introText, rules }) {
  const issues = [];
  const intro = (introText || "").trim();
  const lower = intro.toLowerCase();

  // 1) anti-pattern: frasi bannate in apertura (primissime parole)
  const firstLine = lower.split("\n")[0].slice(0, 80);
  if (includesAny(firstLine, rules.antiPatterns.bannedOpeningPhrases)) {
    issues.push("Apertura piatta: frase bannata nelle prime parole (slide: niente intro tradizionale).");
  }

  // 2) micro-narrazione max 3 frasi (se presente)
  const sentences = countSentences(intro);
  if (rules.microNarration.enabled && sentences > 6) {
    // Nota: intro completa può avere più frasi, ma la micro-narrazione deve stare all'inizio.
    // Qui facciamo un check soft: se è lunghissima, sicuro non è “micro”.
    issues.push("Intro troppo lunga: la parte iniziale non sembra una micro-narrazione (slide: max 3 frasi).");
  }

  // 3) chiarezza: beneficio esplicito
  if (rules.hook.enabled && !hasConcreteBenefit(intro)) {
    issues.push("Hook debole: manca un beneficio esplicito (“ti mostro / ti spiego / capirai come…”).");
  }

  // 4) no vaghezza
  if (rules.hook.noVaguePromises && includesAny(intro, rules.antiPatterns.bannedVaguePhrases)) {
    issues.push("Hook fumoso: contiene frasi vaghe vietate (slide: chiarezza > suspense).");
  }

  // 5) deve esserci un segnale hook
  if (rules.hook.enabled && !hasHookSignal(intro)) {
    issues.push("Hook non dichiarato: manca una promessa immediata (“tra poco ti mostro…”).");
  }

  // 6) brand: non prima dell’hook (euristica: se nomina il canale troppo presto)
  if (rules.brand.brandMustNotComeBeforeHook) {
    const brandIdx = lower.indexOf(rules.brand.channelName.toLowerCase());
    if (brandIdx !== -1) {
      // se brand compare prima di un segnale hook → FAIL
      const hookIdx = Math.max(
        lower.indexOf("ti mostro"),
        lower.indexOf("ti spiego"),
        lower.indexOf("imparerai"),
        lower.indexOf("capirai"),
        lower.indexOf("scoprirai come")
      );
      if (hookIdx === -1 || brandIdx < hookIdx) {
        issues.push("Brand troppo presto: il canale non deve comparire prima della promessa (slide: prima hook, poi brand).");
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

// helper per caricare rules
export function loadIntroRules(pathToJson) {
  const raw = fs.readFileSync(pathToJson, "utf-8");
  return JSON.parse(raw);
}
