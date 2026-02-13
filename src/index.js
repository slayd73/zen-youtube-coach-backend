// src/index.js — Creator Intelligence Pro™ (backend)
// Canonical Fliki endpoint: POST /api/fliki/export-csv
// Keep explicit mounts + safe autoload

import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// ---- ESM dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS (dev-friendly) + expose headers for Fliki CSV filename
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["X-Export-Filename", "x-export-filename", "Content-Disposition"],
  })
);

app.use(express.json({ limit: "5mb" }));

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// -------------------- Explicit mounts (stable) --------------------

// generate-script-pro
try {
  const mod = await import(pathToFileURL(path.join(__dirname, "routes", "generate-script-pro.js")));
  app.use("/api", mod.default);
  console.log("[mount] /api/generate-script-pro OK");
} catch (e) {
  console.error("[mount] generate-script-pro FAILED:", e?.message || e);
}

// fliki export (canonical)
try {
  const mod = await import(pathToFileURL(path.join(__dirname, "routes", "fliki-export.js")));
  app.use("/api/fliki", mod.default);
  console.log("[mount] /api/fliki/* OK");
} catch (e) {
  console.error("[mount] fliki-export FAILED:", e?.message || e);
}

// -------------------- Auto-mount other routes (safe) --------------------
const routesDir = path.join(__dirname, "routes");
try {
  const entries = fs.readdirSync(routesDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;

    // skip already explicitly mounted
    if (name === "generate-script-pro.js") continue;
    if (name === "fliki-export.js") continue;
    // hard-stop: evita versioni clonate generate-script-pro-*.js montate per errore
    if (name.startsWith("generate-script-pro")) continue;

    // skip backups/copies/spaces (as you wanted)
    if (name.includes("Copia")) continue;
    if (name.includes(" ")) continue;
    if (!name.endsWith(".js")) continue;

    const full = path.join(routesDir, name);
    try {
      const mod = await import(pathToFileURL(full));
      if (mod?.default) {
        const base = "/api/" + name.replace(/\.js$/i, "");
        app.use(base, mod.default);
        console.log("[mount]", base, "OK");
      }
    } catch (e) {
      console.error("[mount] auto route failed:", name, e?.message || e);
    }
  }
} catch (e) {
  console.error("[mount] routesDir scan failed:", e?.message || e);
}

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

export default app;
