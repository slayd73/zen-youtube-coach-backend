#!/usr/bin/env node
// Slayd Intelligence  Script Quality Auditor

import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const out = {
    file: "",
    audience: "over60",
    minutes: null,
    trigramThreshold: 3,
  };

  for (const arg of argv) {
    if (arg.startsWith("--audience=")) {
      out.audience = arg.split("=")[1]?.trim() || out.audience;
      continue;
    }
    if (arg.startsWith("--minutes=")) {
      const v = Number(arg.split("=")[1]);
      out.minutes = Number.isFinite(v) ? v : null;
      continue;
    }
    if (arg.startsWith("--trigram-threshold=")) {
      const v = Number(arg.split("=")[1]);
      out.trigramThreshold = Number.isFinite(v) && v > 0 ? Math.floor(v) : 3;
      continue;
    }
    if (!arg.startsWith("--") && !out.file) {
      out.file = arg.trim();
    }
  }

  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function splitSentences(raw) {
  const flat = String(raw || "").replace(/\r/g, "").replace(/\n+/g, " ").trim();
  if (!flat) return [];
  const chunks = flat.match(/[^.!?…]+[.!?…]?/g) || [];
  return chunks
    .map((x) => x.trim())
    .filter(Boolean);
}

function detectPlaceholders(raw) {
  const n = normalizeText(raw);
  const markers = [
    "[script_start]",
    "[script_end]",
    "[incolla",
    "[todo",
    "[placeholder",
    "incolla qui",
  ];
  return markers.filter((m) => n.includes(m));
}

function analyzeHook(sentences, allWords) {
  const first3 = sentences.slice(0, 3).map(cleanForMatch);
  const first30Words = allWords.slice(0, 30);
  const first30Text = first30Words.join(" ");

  const bannedOpeners = [
    "benvenuti",
    "in questo video",
    "scopriamo insieme",
  ];

  let bannedFound = [];
  for (const s of first3) {
    for (const b of bannedOpeners) {
      if (s.includes(b)) bannedFound.push(b);
    }
  }
  bannedFound = [...new Set(bannedFound)];

  const problemKeywords = [
    "dolore",
    "rigid",
    "fiato",
    "stanc",
    "fatica",
    "paura",
    "equilibr",
    "instabil",
    "lento",
    "debole",
    "ansim",
    "capogir",
  ];
  const hasProblem = problemKeywords.some((k) => first30Text.includes(k));

  const promisePattern =
    /\bin\s+\d+\s+giorni\b|\bpuoi\b|\botterrai\b|\bti mostro\b|\bcosa cambia\b|\britrov\w+\b|\bmiglior\w+\b/;
  const benefitKeywords = [
    "energia",
    "respiro",
    "gambe",
    "sicur",
    "autonomia",
    "stabil",
    "sonno",
    "forza",
    "equilibr",
  ];
  const hasPromise = promisePattern.test(first30Text) && benefitKeywords.some((k) => first30Text.includes(k));

  let hookScore = 10;
  if (bannedFound.length > 0) hookScore -= 4;
  if (!hasProblem) hookScore -= 3;
  if (!hasPromise) hookScore -= 3;
  hookScore = clamp(hookScore, 0, 10);

  return {
    first3,
    first30Text,
    bannedFound,
    hasProblem,
    hasPromise,
    hookScore,
    pass: bannedFound.length === 0 && hasProblem && hasPromise,
  };
}

function analyzeDuplicates(sentences) {
  const map = new Map();
  for (const sRaw of sentences) {
    const s = cleanForMatch(sRaw);
    const wc = s.split(" ").filter(Boolean).length;
    if (wc < 4) continue;
    map.set(s, (map.get(s) || 0) + 1);
  }
  const duplicates = [];
  for (const [sentence, count] of map.entries()) {
    if (count > 1) duplicates.push({ sentence, count });
  }
  duplicates.sort((a, b) => b.count - a.count || b.sentence.length - a.sentence.length);
  return duplicates;
}

function countTrigrams(words) {
  const map = new Map();
  for (let i = 0; i <= words.length - 3; i++) {
    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    map.set(tri, (map.get(tri) || 0) + 1);
  }
  return map;
}

function findRepeatedTrigrams(words, threshold, topN = 10) {
  const triMap = countTrigrams(words);
  const arr = [];
  for (const [trigram, count] of triMap.entries()) {
    if (count >= threshold) arr.push({ trigram, count });
  }
  arr.sort((a, b) => b.count - a.count || a.trigram.localeCompare(b.trigram));
  return arr.slice(0, topN);
}

function cueTokensList() {
  return [
    "tra poco",
    "alla fine",
    "tra un attimo",
    "piu avanti",
    "errore che",
  ].map((c) => c.split(" "));
}

function findCuePositions(words) {
  const cues = cueTokensList();
  const hits = [];

  for (let i = 0; i < words.length; i++) {
    for (const cue of cues) {
      if (i + cue.length > words.length) continue;
      let ok = true;
      for (let j = 0; j < cue.length; j++) {
        if (words[i + j] !== cue[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        hits.push({ cue: cue.join(" "), wordIndex: i });
      }
    }
  }

  hits.sort((a, b) => a.wordIndex - b.wordIndex);

  const dedup = [];
  for (const h of hits) {
    if (!dedup.length || dedup[dedup.length - 1].wordIndex !== h.wordIndex) dedup.push(h);
  }
  return dedup;
}

function analyzeOpenLoops(words) {
  const positions = findCuePositions(words);
  const gapsSec = [];
  for (let i = 1; i < positions.length; i++) {
    const gapWords = positions[i].wordIndex - positions[i - 1].wordIndex;
    const sec = (gapWords / 150) * 60;
    gapsSec.push({
      fromCue: positions[i - 1].cue,
      toCue: positions[i].cue,
      sec,
      pass: sec <= 90,
    });
  }
  return { positions, gapsSec };
}

function paragraphStats(raw) {
  const paragraphs = String(raw || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const lineCounts = paragraphs.map((p) =>
    p.split(/\n/g).map((x) => x.trim()).filter(Boolean).length
  );

  const avgLines =
    lineCounts.length > 0
      ? lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length
      : 0;

  return { paragraphs: paragraphs.length, lineCounts, avgLines };
}

function audienceCompliance(audience, words, raw) {
  const txt = cleanForMatch(raw);
  const technicalTerms = [
    "mitocondri",
    "catecolamine",
    "periodizzazione",
    "glicolisi",
    "vo2max",
    "biomeccanica",
    "vasodilatazione",
    "ipertrofia",
    "neuromuscolare",
    "macronutrienti",
  ];

  const technicalHits = technicalTerms.filter((t) => txt.includes(t));

  if (audience === "over60") {
    const focusGroups = {
      sicurezza: ["sicurezza", "sicuro", "medico", "ascoltare il corpo", "dolore", "capogiri"],
      autonomia: ["autonomia", "indipendenza", "stabilita", "controllo", "muoverti"],
      ritmo: ["ritmo", "regolare", "costanza", "continuita", "graduale", "comodo"],
    };
    let groupsHit = 0;
    for (const keys of Object.values(focusGroups)) {
      if (keys.some((k) => txt.includes(k))) groupsHit++;
    }
    const pass = technicalHits.length <= 2 && groupsHit >= 2;
    return { pass, technicalHits, groupsHit };
  }

  if (audience === "over50") {
    const activeKeys = ["energia", "ritmo", "giornata", "lavoro", "costanza"];
    const hasActive = activeKeys.some((k) => txt.includes(k));
    const avoid = txt.includes("anziani");
    return { pass: hasActive && !avoid, technicalHits, groupsHit: hasActive ? 1 : 0 };
  }

  if (audience === "over70") {
    const avgSentenceWords = (() => {
      const s = splitSentences(raw);
      if (!s.length) return 0;
      const n = s.map((x) => wordsFromText(x).length).reduce((a, b) => a + b, 0);
      return n / s.length;
    })();
    const safetyFocus = ["sicurezza", "sicuro", "medico", "ascolta il corpo"].some((k) =>
      txt.includes(k)
    );
    const pass = avgSentenceWords <= 18 && safetyFocus && technicalHits.length <= 1;
    return { pass, technicalHits, groupsHit: safetyFocus ? 1 : 0 };
  }

  return { pass: false, technicalHits, groupsHit: 0 };
}

function scoreRetention(openLoops, pStats, wordCount, estimatedMinutes150) {
  let score = 10;

  if (wordCount > 180 && openLoops.positions.length < 2) score -= 4;
  for (const g of openLoops.gapsSec) {
    if (!g.pass) score -= 2;
  }

  if (pStats.avgLines > 4.5) score -= 2;
  if (pStats.avgLines < 1.5 && pStats.paragraphs > 8) score -= 1;

  score = clamp(score, 0, 10);

  // Retention cap by duration (@150wpm)
  if (estimatedMinutes150 < 5) return Math.min(score, 3);
  if (estimatedMinutes150 < 7) return Math.min(score, 6);
  return score;
}

function scoreNonRepetition(duplicates, repeatedTrigrams) {
  let score = 10;
  if (duplicates.length > 0) score -= 6;
  score -= Math.min(5, repeatedTrigrams.length);
  return clamp(score, 0, 10);
}

function usage() {
  console.log("Usage:");
  console.log("  node tools\\scriptQualityCheck.js <file.txt> --audience=over60 --minutes=9 [--trigram-threshold=3]");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    usage();
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.log(`ERROR: file not found -> ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const words = wordsFromText(raw);
  const sentences = splitSentences(raw);

  const wordCount = words.length;
  const minutes130 = wordCount / 130;
  const minutes150 = wordCount / 150;
  const baseWords = args.minutes != null ? Math.round(args.minutes * 150) : null;
  const minWords = baseWords != null ? Math.round(baseWords * 0.85) : null;
  const maxWords = baseWords != null ? Math.round(baseWords * 1.15) : null;
  const inRange =
    minWords != null && maxWords != null
      ? wordCount >= minWords && wordCount <= maxWords
      : false;

  const hook = analyzeHook(sentences, words);
  const placeholders = detectPlaceholders(raw);
  const duplicates = analyzeDuplicates(sentences);
  const repeatedTrigrams = findRepeatedTrigrams(words, args.trigramThreshold, 10);
  const openLoops = analyzeOpenLoops(words);
  const pStats = paragraphStats(raw);
  const audience = audienceCompliance(args.audience, words, raw);

  const retentionScore = scoreRetention(openLoops, pStats, wordCount, minutes150);
  const nonRepScore = scoreNonRepetition(duplicates, repeatedTrigrams);
  const hookScore = hook.hookScore;

  const hardFailReasons = [];
  if (placeholders.length > 0) hardFailReasons.push(`Placeholder trovati: ${placeholders.join(", ")}`);
  if (hook.bannedFound.length > 0) hardFailReasons.push(`Banned opener nel hook: ${hook.bannedFound.join(", ")}`);
  if (duplicates.length > 0) hardFailReasons.push(`Frasi duplicate trovate: ${duplicates.length}`);

  const failReasons = [...hardFailReasons];
  if (!hook.hasProblem) failReasons.push("Nel hook (prime 30 parole) non rilevo problema reale.");
  if (!hook.hasPromise) failReasons.push("Nel hook (prime 30 parole) non rilevo promessa/beneficio chiaro.");
  if (!audience.pass) failReasons.push(`Audience compliance FAIL per ${args.audience}.`);
  if (retentionScore < 7) failReasons.push("Retention score sotto soglia (>=7).");
  if (nonRepScore < 8) failReasons.push("Non-ripetizione sotto soglia (>=8).");
  if (hookScore < 8) failReasons.push("Hook score sotto soglia (>=8).");
  if (args.minutes == null) {
    failReasons.push("MINUTES_TARGET_MISSING (--minutes=...)");
  } else if (!inRange) {
    failReasons.push(`WORDCOUNT_OUT_OF_RANGE (wordCount=${wordCount}, range=${minWords}-${maxWords})`);
  }

  const hardFail = hardFailReasons.length > 0;
  const overallPass =
    !hardFail &&
    hookScore >= 8 &&
    nonRepScore >= 8 &&
    retentionScore >= 7 &&
    audience.pass &&
    inRange;

  console.log("============================================================");
  console.log("SLAYD INTELLIGENCE - SCRIPT QUALITY AUDITOR");
  console.log("============================================================");
  console.log(`File: ${filePath}`);
  console.log(`Audience: ${args.audience}`);
  console.log(`Target minutes: ${args.minutes ?? "n/a"}`);
  console.log(`Trigram threshold: ${args.trigramThreshold}`);
  console.log("------------------------------------------------------------");
  console.log(`wordCount: ${wordCount}`);
  console.log(`estimatedMinutes@130wpm: ${minutes130.toFixed(2)}`);
  console.log(`estimatedMinutes@150wpm: ${minutes150.toFixed(2)}`);
  console.log(`baseWords: ${baseWords != null ? baseWords : "n/a"}`);
  console.log(`minWords: ${minWords != null ? minWords : "n/a"}`);
  console.log(`maxWords: ${maxWords != null ? maxWords : "n/a"}`);
  console.log(`inRange: ${inRange ? "YES" : "NO"}`);
  console.log("------------------------------------------------------------");
  console.log(`hookWordCount: ${Math.min(30, wordCount)}`);
  console.log(`hookSeconds@150wpm: ${((Math.min(30, wordCount) / 150) * 60).toFixed(1)}`);
  console.log(`hookProblemDetected: ${hook.hasProblem ? "YES" : "NO"}`);
  console.log(`hookPromiseDetected: ${hook.hasPromise ? "YES" : "NO"}`);
  console.log(`hookBannedOpeners: ${hook.bannedFound.length ? hook.bannedFound.join(", ") : "none"}`);
  console.log("------------------------------------------------------------");
  console.log(`paragraphs: ${pStats.paragraphs}`);
  console.log(`avgLinesPerParagraph: ${pStats.avgLines.toFixed(2)}`);
  console.log(`exactDuplicateSentences: ${duplicates.length}`);
  console.log(`repeatedTrigrams(top10): ${repeatedTrigrams.length}`);
  console.log("------------------------------------------------------------");
  console.log("SCORES");
  console.log(`Hook: ${hookScore}/10`);
  console.log(`Retention: ${retentionScore}/10`);
  console.log(`Non-ripetizione: ${nonRepScore}/10`);
  console.log("------------------------------------------------------------");
  console.log("Top repeated trigrams:");
  if (!repeatedTrigrams.length) {
    console.log("  - none");
  } else {
    repeatedTrigrams.forEach((t, i) => {
      console.log(`  ${i + 1}. "${t.trigram}" x${t.count}`);
    });
  }
  console.log("------------------------------------------------------------");
  console.log("Open-loop gaps (sec @150wpm):");
  if (!openLoops.gapsSec.length) {
    if (openLoops.positions.length === 0) console.log("  - no cue found");
    else console.log("  - only one cue found (no gap)");
  } else {
    openLoops.gapsSec.forEach((g, i) => {
      console.log(
        `  ${i + 1}. "${g.fromCue}" -> "${g.toCue}" = ${g.sec.toFixed(1)}s ${g.pass ? "[OK]" : "[FAIL]"}`
      );
    });
  }
  console.log("------------------------------------------------------------");
  console.log(`Audience compliance (${args.audience}): ${audience.pass ? "PASS" : "FAIL"}`);
  console.log(
    `Technical terms detected: ${audience.technicalHits.length ? audience.technicalHits.join(", ") : "none"}`
  );
  console.log("------------------------------------------------------------");

  if (failReasons.length) {
    console.log("FAIL reasons:");
    failReasons.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  } else {
    console.log("FAIL reasons: none");
  }

  console.log("------------------------------------------------------------");
  console.log(`FINAL: ${overallPass ? "PASS" : "FAIL"}`);
  console.log("============================================================");

  process.exit(overallPass ? 0 : 1);
}

main();
