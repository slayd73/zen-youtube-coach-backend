// ============================================================
// 📊 Dashboard Decisionale Settimanale — V1 (Concrete)
// - Un endpoint che torna: video consigliato + motivazione + competitor angle
// - Input: JSON config + trend ideas (manuali) + ultimo video (manuale)
// ============================================================

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const COMPETITORS_PATH = path.resolve(DATA_DIR, "competitors.json");
const WEEKLY_TRENDS_PATH = path.resolve(DATA_DIR, "weekly-trends.json");
const LAST_VIDEO_PATH = path.resolve(DATA_DIR, "last-video.json");

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Scoring V1 (semplice ma utile):
 * score = opportunity(1-10) + (10 - saturation(1-10)) + seasonality(1-10)
 * poi piccoli bonus se competitorGap=true
 */
function scoreIdea(idea) {
  const opportunity = clamp(Number(idea.opportunity ?? 6), 1, 10);
  const saturation = clamp(Number(idea.saturation ?? 5), 1, 10);
  const seasonality = clamp(Number(idea.seasonality ?? 6), 1, 10);
  const competitorGap = Boolean(idea.competitorGap);

  let score = opportunity + (10 - saturation) + seasonality;
  if (competitorGap) score += 2;

  return score;
}

router.get("/", (req, res) => {
  // Load data
  const competitors = safeReadJSON(COMPETITORS_PATH, { competitors: [] });
  const weeklyTrends = safeReadJSON(WEEKLY_TRENDS_PATH, { weekOf: "", ideas: [] });
  const lastVideo = safeReadJSON(LAST_VIDEO_PATH, {
    title: "",
    ctr: null,
    first30sDrop: null,
    whatWorked: [],
    whatToFix: [],
    nextAction: "",
  });

  const ideas = Array.isArray(weeklyTrends.ideas) ? weeklyTrends.ideas : [];

  // Pick best idea
  const ranked = ideas
    .map((i) => ({ ...i, _score: scoreIdea(i) }))
    .sort((a, b) => b._score - a._score);

  const pick = ranked[0] || null;

  // Build “why we win” angle vs competitor (V1: template)
  const competitorAngle =
    pick?.competitorAngle ||
    (pick
      ? {
          competitorsDo: ["tono allarmista", "liste fredde", "soluzioni superficiali"],
          weDo: ["storia quotidiana", "rassicurazione", "azioni pratiche semplici"],
        }
      : null);

  // Build checklist
  const checklist = [
    { key: "script", label: "Script generato", done: false },
    { key: "fliki", label: "CSV/Script pronto per Fliki", done: false },
    { key: "export", label: "Video esportato", done: false },
    { key: "thumb", label: "Thumbnail pronta (Engine in coda)", done: false },
    { key: "comment", label: "Primo commento pinnato", done: false },
    { key: "desc", label: "Descrizione + tag", done: false },
  ];

  return res.json({
    success: true,
    weekOf: weeklyTrends.weekOf || null,
    recommended: pick
      ? {
          id: pick.id || null,
          titleHook: pick.titleHook || "",
          topic: pick.topic || "",
          whyNow: pick.whyNow || [],
          angle: pick.angle || "",
          preset: pick.preset || {
            channelKey: "zen-salute",
            targetMinutes: 10,
            audience: "over60",
          },
          score: pick._score,
        }
      : null,
    competitorAngle,
    competitors: competitors.competitors || [],
    lastVideo,
    checklist,
    meta: {
      ideasCount: ideas.length,
      note: "V1 usa trend/last-video manuali. In V2 li automatizziamo.",
    },
  });
});

export default router;
