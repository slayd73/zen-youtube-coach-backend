// ============================================================
// 🧾 flikiCsv.js — Fliki CSV generator (NO DEPENDENCIES)
// - niente csv-stringify
// - Duration <= 15 fisso (Fliki Bulk friendly)
// ============================================================

function csvEscape(value = "") {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function cleanForTTS(text = "") {
  let t = String(text ?? "");
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // remove simple labels like [Hook]
  t = t.replace(/^\s*\[[^\]]+\]\s*:?/gm, "");

  // normalize quotes
  t = t.replace(/[“”]/g, '"').replace(/[’]/g, "'");

  // compress spaces/newlines
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  return t;
}

export function buildFlikiSceneCSV({ scriptText = "", presetName = "zen-salute" } = {}) {
  const header = [
    "Format",
    "Workflow type",
    "Prompt",
    "Content",
    "Duration",
    "Voice ID",
    "Aspect ratio",
    "Template ID",
    "Subtitle ID",
  ];

  const row = [
    "Video",
    "Bulk",
    "",
    cleanForTTS(scriptText),
    15,       // ✅ fisso
    "",
    "16:9",
    "",
    "",
  ];

  const csv = header.join(",") + "\n" + row.map(csvEscape).join(",");
  return { csv, presetName };
}
