// routes/fliki-export.js
// Mounted at: /api/fliki
// Canonical endpoint: POST /api/fliki/export-csv

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildFlikiSceneCSV } from "../utils/flikiCsv.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/exports (fuori da src)
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return n
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 180);
}

// Debug mount: GET /api/fliki
router.get("/", (_req, res) => {
  res.json({
    ok: true,
    mount: "/api/fliki",
    endpoints: ["POST /api/fliki/export-csv"],
  });
});

router.options("/export-csv", (_req, res) => res.sendStatus(204));

router.post("/export-csv", (req, res) => {
  try {
    ensureDir(EXPORTS_DIR);

    // accetta alias, così non ti impicchi sui nomi
    const { scriptText, script, text, preset = "zen-salute", filename } = req.body || {};
    const content = String(scriptText ?? script ?? text ?? "").trim();

    if (content.length < 20) {
      return res.status(400).json({
        success: false,
        error: "BAD_REQUEST",
        message: "Manca il testo. Invia scriptText (o script/text) con almeno 20 caratteri.",
      });
    }

    const out = buildFlikiSceneCSV({
      scriptText: content,
      presetName: String(preset || "zen-salute").trim(),
    });

    const csv = typeof out === "string" ? out : out?.csv;
    if (!csv || !String(csv).trim()) {
      return res.status(500).json({
        success: false,
        error: "CSV_EMPTY",
        message: "CSV vuoto: buildFlikiSceneCSV non ha prodotto output valido.",
      });
    }

    const base = safeName(filename) || `fliki-${Date.now()}.csv`;
    const finalName = base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;

    const absPath = path.resolve(EXPORTS_DIR, finalName);
    if (!absPath.startsWith(EXPORTS_DIR)) {
      return res.status(400).json({ success: false, error: "INVALID_FILENAME" });
    }

    fs.writeFileSync(absPath, csv, "utf8");

    // download friendly
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${finalName}"`);

    // headers custom (devono essere exposed dal CORS in index.js)
    res.setHeader("X-Export-Filename", finalName);
    res.setHeader("X-Export-Url", `/api/exports/${finalName}`);

    // ridondanza utile: anche se CORS globale già espone
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Export-Filename,X-Export-Url,Content-Disposition"
    );

    return res.status(200).send(csv);
  } catch (err) {
    console.error("❌ fliki-export:", err?.message || err);
    return res.status(500).json({ success: false, error: "EXPORT_FAILED", message: err?.message });
  }
});

export default router;
