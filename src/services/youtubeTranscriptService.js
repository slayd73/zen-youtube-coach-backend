// backend/src/services/youtubeTranscriptService.js
// ============================================================
// YouTube Transcript Engine — Windows PRO (node-lib -> yt-dlp subs -> Whisper)
// - Path ASSOLUTI (fix ENOENT su Windows)
// - NO --bin (spawn diretto .exe)
// - Attempts sempre riportati (debug.attempts + trace)
// - Whisper fallback SOLO se OPENAI_API_KEY presente
// ============================================================

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import OpenAI from "openai";
import { YoutubeTranscript } from "youtube-transcript";

// ----------------------------
// Paths / Root
// ----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Questo file sta in src/services -> backend root = ../../
const BACKEND_ROOT = path.resolve(__dirname, "../../");

// ----------------------------
// ENV / Config (supporta nomi diversi)
// ----------------------------
const TMP_ROOT = resolvePath(
  process.env.TMP_DIR || "tmp/transcripts"
);

// Supporto sia YT_DLP_PATH che YTDLP_PATH (tu in passato hai usato varianti)
const YT_DLP_PATH = resolvePath(
  process.env.YT_DLP_PATH ||
    process.env.YTDLP_PATH ||
    "bin/yt-dlp.exe"
);

const FFMPEG_PATH = resolvePath(process.env.FFMPEG_PATH || "ffmpeg", {
  allowNonExisting: true, // può essere nel PATH
  allowRelativeToCwd: true,
});

// cookies file opzionale
const YT_DLP_COOKIES = process.env.YT_DLP_COOKIES || "";

// deno opzionale (runtime JS)
const DENO_PATH = resolvePath(process.env.DENO_PATH || "", {
  allowNonExisting: true,
  allowRelativeToCwd: true,
});
const USE_JS_RUNTIME = process.env.YT_DLP_USE_DENO === "1" || process.env.YTDLP_USE_DENO === "1";

// timeouts
const YT_DLP_TIMEOUT_MS = Number(process.env.YT_DLP_TIMEOUT_MS || process.env.YTDLP_TIMEOUT_MS || 90_000);
const WHISPER_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS || 180_000);

// whisper config
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-1";

// ----------------------------
// Helpers
// ----------------------------
function resolvePath(p, opts = {}) {
  const { allowNonExisting = false, allowRelativeToCwd = false } = opts;
  if (!p) return "";

  const raw = String(p).trim();
  if (!raw) return "";

  // se è assoluto, ok
  if (path.isAbsolute(raw)) return raw;

  // se vuoi consentire "ffmpeg" dal PATH senza risolverlo a file
  if (allowRelativeToCwd) return raw;

  // altrimenti risolvi rispetto alla root del backend
  return path.resolve(BACKEND_ROOT, raw);
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeRmDirSync(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function normalizeLang(lang) {
  const l = String(lang || "it").trim().toLowerCase();
  // per youtube-transcript spesso basta "it"
  return l.includes("-") ? l.split("-")[0] : l;
}

function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  const m1 = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m1?.[1]) return m1[1];

  const m2 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m2?.[1]) return m2[1];

  const m3 = s.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m3?.[1]) return m3[1];

  return null;
}

function buildYoutubeUrl(videoIdOrUrl) {
  const id = extractVideoId(videoIdOrUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : String(videoIdOrUrl);
}

function normalizeSpaces(t) {
  return String(t || "").replace(/\s+/g, " ").trim();
}

function joinTranscriptItems(items) {
  return normalizeSpaces(
    (items || [])
      .map((x) => (x?.text || "").trim())
      .filter(Boolean)
      .join(" ")
  );
}

function vttToText(vtt) {
  const lines = String(vtt || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (l === "WEBVTT") continue;
    if (/^\d+$/.test(l)) continue;
    if (l.includes("-->")) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(l)) continue;

    const cleaned = l.replace(/<[^>]+>/g, "").trim();
    if (cleaned) out.push(cleaned);
  }
  return normalizeSpaces(out.join(" "));
}

function makeRequestDir(videoId = "unknown") {
  const stamp = Date.now();
  const rand = crypto.randomBytes(4).toString("hex");
  const dir = path.join(TMP_ROOT, `${videoId}-${stamp}-${rand}`);
  ensureDirSync(dir);
  return dir;
}

function spawnWithTimeout(cmd, args, opts = {}) {
  const { timeoutMs = 60_000, cwd } = opts;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      reject(new Error(`Timeout (${timeoutMs}ms): ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function fileSizeBytes(p) {
  const st = await fsp.stat(p);
  return st.size;
}

// ----------------------------
// Layer 1 — youtube-transcript (node-lib)
// ----------------------------
async function tryYoutubeTranscript(videoIdOrUrl, lang) {
  // la libreria accetta URL o ID; io passo l’URL per coerenza
  const url = buildYoutubeUrl(videoIdOrUrl);

  // youtube-transcript: { lang: "it" }
  const items = await YoutubeTranscript.fetchTranscript(url, {
    lang: normalizeLang(lang),
  });

  const text = joinTranscriptItems(items);
  if (!text) throw new Error("youtube-transcript: testo vuoto o non disponibile");
  return { provider: "youtube-transcript", text, kind: "captions" };
}

// ----------------------------
// yt-dlp common
// ----------------------------
function assertYtDlpExists() {
  if (!YT_DLP_PATH) throw new Error("YT_DLP_PATH vuoto. Imposta YT_DLP_PATH oppure metti yt-dlp.exe in /bin.");
  if (!fs.existsSync(YT_DLP_PATH)) {
    throw new Error(`yt-dlp non trovato: ${YT_DLP_PATH} (fix: usa path assoluto o metti bin/yt-dlp.exe nella root backend).`);
  }
}

function ytDlpRuntimeArgs() {
  const args = [];
  if (YT_DLP_COOKIES) args.push("--cookies", YT_DLP_COOKIES);

  if (USE_JS_RUNTIME) {
    // Se DENO_PATH è vuoto: prova "deno" in PATH
    const spec = DENO_PATH ? `deno:${DENO_PATH}` : "deno";
    args.push("--js-runtimes", spec);
  }

  return args;
}

// ----------------------------
// Layer 2 — yt-dlp subtitles -> VTT -> text
// ----------------------------
function buildYtDlpArgsForSubs(url, workDir, lang) {
  const l = normalizeLang(lang);
  const outTemplate = path.join(workDir, "subs.%(ext)s");

  return [
    ...ytDlpRuntimeArgs(),
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-format",
    "vtt",
    "--sub-langs",
    `${l},en`,
    "-o",
    outTemplate,
    url,
  ];
}

async function pickVttFile(workDir) {
  const files = await fsp.readdir(workDir);
  const vtts = files.filter((f) => f.toLowerCase().endsWith(".vtt"));
  if (vtts.length === 0) return null;

  const it = vtts.find((f) => /(^|\.)(it)(\.|$)/i.test(f));
  if (it) return path.join(workDir, it);

  const en = vtts.find((f) => /(^|\.)(en)(\.|$)/i.test(f));
  if (en) return path.join(workDir, en);

  return path.join(workDir, vtts[0]);
}

async function tryYtDlpSubs(videoIdOrUrl, lang, requestDir) {
  assertYtDlpExists();

  const url = buildYoutubeUrl(videoIdOrUrl);
  const args = buildYtDlpArgsForSubs(url, requestDir, lang);

  const { code, stderr } = await spawnWithTimeout(YT_DLP_PATH, args, {
    timeoutMs: YT_DLP_TIMEOUT_MS,
    cwd: requestDir,
  });

  if (code !== 0) {
    throw new Error(`yt-dlp subs exit=${code}. stderr: ${stderr || "(vuoto)"}`);
  }

  const vttPath = await pickVttFile(requestDir);
  if (!vttPath) throw new Error("yt-dlp non ha prodotto nessun file .vtt");

  const vtt = await fsp.readFile(vttPath, "utf8");
  const text = vttToText(vtt);
  if (!text) throw new Error("Parsing VTT -> testo vuoto");

  return { provider: "yt-dlp-subs", text, kind: "captions", vttPath };
}

// ----------------------------
// Layer 3 — Whisper (audio) (yt-dlp -> mp3) + split via ffmpeg se >25MB
// ----------------------------
function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim());
}

function getOpenAIClient() {
  // NON creare client se manca key (evita crash a import-time)
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY mancante (Whisper disabilitato)");
  return new OpenAI({ apiKey });
}

function buildYtDlpArgsForAudio(url, workDir) {
  const outTemplate = path.join(workDir, "audio.%(ext)s");
  return [
    ...ytDlpRuntimeArgs(),
    "--no-warnings",
    "--no-playlist",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outTemplate,
    url,
  ];
}

async function findMp3(workDir) {
  const files = await fsp.readdir(workDir);
  const mp3 = files.find((f) => f.toLowerCase().endsWith(".mp3"));
  return mp3 ? path.join(workDir, mp3) : null;
}

async function ffmpegAvailable() {
  try {
    const { code } = await spawnWithTimeout(FFMPEG_PATH, ["-version"], { timeoutMs: 5_000 });
    return code === 0;
  } catch {
    return false;
  }
}

async function splitAudioIfNeeded(mp3Path, workDir) {
  const size = await fileSizeBytes(mp3Path);
  if (size <= WHISPER_MAX_BYTES) return [mp3Path];

  const ok = await ffmpegAvailable();
  if (!ok) {
    throw new Error(
      `Audio > 25MB (${Math.round(size / 1024 / 1024)}MB) e ffmpeg non disponibile. Installa ffmpeg o imposta FFMPEG_PATH.`
    );
  }

  // Segmenti 8 minuti (480s)
  const outPattern = path.join(workDir, "chunk_%03d.mp3");
  const args = ["-i", mp3Path, "-f", "segment", "-segment_time", "480", "-c", "copy", outPattern];

  const { code, stderr } = await spawnWithTimeout(FFMPEG_PATH, args, {
    timeoutMs: 120_000,
    cwd: workDir,
  });

  if (code !== 0) throw new Error(`ffmpeg split fallito exit=${code}. stderr: ${stderr || "(vuoto)"}`);

  const files = await fsp.readdir(workDir);
  const chunks = files
    .filter((f) => f.toLowerCase().startsWith("chunk_") && f.toLowerCase().endsWith(".mp3"))
    .sort()
    .map((f) => path.join(workDir, f));

  if (chunks.length === 0) throw new Error("ffmpeg split: nessun chunk generato");

  // sanity: chunk sotto 25MB
  for (const c of chunks) {
    const s = await fileSizeBytes(c);
    if (s > WHISPER_MAX_BYTES) {
      throw new Error(`Chunk ancora > 25MB (${path.basename(c)} = ${Math.round(s / 1024 / 1024)}MB). Riduci segment_time.`);
    }
  }

  return chunks;
}

async function whisperTranscribeFiles(files, lang) {
  const client = getOpenAIClient();
  let full = "";

  for (const f of files) {
    const stream = fs.createReadStream(f);
    const res = await client.audio.transcriptions.create({
      file: stream,
      model: WHISPER_MODEL,
      language: normalizeLang(lang),
      response_format: "text",
    });

    const t = String(res || "").trim();
    if (t) full += (full ? " " : "") + t;
  }

  return normalizeSpaces(full);
}

async function tryWhisper(videoIdOrUrl, lang, requestDir) {
  if (!hasOpenAIKey()) {
    throw new Error("WHISPER_DISABLED_NO_KEY");
  }

  assertYtDlpExists();

  const url = buildYoutubeUrl(videoIdOrUrl);
  const args = buildYtDlpArgsForAudio(url, requestDir);

  const { code, stderr } = await spawnWithTimeout(YT_DLP_PATH, args, {
    timeoutMs: Math.max(YT_DLP_TIMEOUT_MS, 120_000),
    cwd: requestDir,
  });

  if (code !== 0) throw new Error(`yt-dlp audio exit=${code}. stderr: ${stderr || "(vuoto)"}`);

  const mp3Path = await findMp3(requestDir);
  if (!mp3Path) throw new Error("yt-dlp audio: mp3 non trovato");

  const parts = await splitAudioIfNeeded(mp3Path, requestDir);

  const text = await Promise.race([
    whisperTranscribeFiles(parts, lang),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Whisper timeout (${WHISPER_TIMEOUT_MS}ms)`)), WHISPER_TIMEOUT_MS)),
  ]);

  if (!text) throw new Error("Whisper: testo vuoto");

  return { provider: "whisper", text, kind: "audio", mp3Path };
}

// ----------------------------
// Public API
// ----------------------------
// Ritorna:
// - okResult: { ok:true, text, provider, kind, lang, len, trace, debug:{videoId, attempts, requestDir} }
// - errResult: { ok:false, ... , debug:{...} }
function okResult({ text, provider, kind, lang, trace, debug }) {
  return {
    ok: true,
    text,
    provider,
    kind,
    lang,
    len: (text || "").length,
    trace,
    debug,
  };
}

function errResult({ provider, kind, lang, error_code, error_message, trace, debug }) {
  return {
    ok: false,
    provider: provider || "none",
    kind: kind || "none",
    lang,
    len: 0,
    error_code: error_code || "NO_TRANSCRIPT",
    error_message: error_message || "Transcript non disponibile",
    trace,
    debug,
  };
}

export async function getTranscript(videoIdOrUrl, opts = {}) {
  const lang = normalizeLang(opts.lang || opts.language || "it");

  const videoId = extractVideoId(videoIdOrUrl) || "unknown";
  ensureDirSync(TMP_ROOT);

  const requestDir = makeRequestDir(videoId);

  // attempts (quelli che vedi nella diagnose)
  const attempts = [];
  // trace (più leggibile, “step-based”)
  const trace = [];

  try {
    // 1) youtube-transcript
    try {
      const r1 = await tryYoutubeTranscript(videoIdOrUrl, lang);
      trace.push({ step: "youtube-transcript", ok: true });
      return okResult({
        text: r1.text,
        provider: r1.provider,
        kind: r1.kind,
        lang,
        trace,
        debug: { videoId, attempts, requestDir },
      });
    } catch (e) {
      attempts.push({ method: "node-lib", error: e?.message || String(e) });
      trace.push({ step: "youtube-transcript", ok: false, error: e?.message || String(e) });
    }

    // 2) yt-dlp subtitles
    try {
      const r2 = await tryYtDlpSubs(videoIdOrUrl, lang, requestDir);
      trace.push({ step: "yt-dlp-subs", ok: true, vttPath: r2.vttPath });
      return okResult({
        text: r2.text,
        provider: r2.provider,
        kind: r2.kind,
        lang,
        trace,
        debug: { videoId, attempts, requestDir },
      });
    } catch (e) {
      attempts.push({ method: "yt-dlp-subs", error: e?.message || String(e) });
      trace.push({ step: "yt-dlp-subs", ok: false, error: e?.message || String(e) });
    }

    // 3) whisper
    try {
      const r3 = await tryWhisper(videoIdOrUrl, lang, requestDir);
      trace.push({ step: "whisper", ok: true, mp3Path: r3.mp3Path || null });
      return okResult({
        text: r3.text,
        provider: r3.provider,
        kind: r3.kind,
        lang,
        trace,
        debug: { videoId, attempts, requestDir },
      });
    } catch (e) {
      // Se è disabilitato per key mancante, lo segno chiaramente
      const msg = e?.message || String(e);
      attempts.push({ method: "whisper", error: msg });
      trace.push({ step: "whisper", ok: false, error: msg });
    }

    return errResult({
      provider: "none",
      kind: "none",
      lang,
      error_code: "NO_TRANSCRIPT",
      error_message: "Transcript non disponibile (tutti i layer falliti)",
      trace,
      debug: { videoId, attempts, requestDir },
    });
  } finally {
    // Se vuoi conservare i tmp per debug: setta KEEP_TRANSCRIPT_TMP=1
    if (process.env.KEEP_TRANSCRIPT_TMP !== "1") {
      safeRmDirSync(requestDir);
    }
  }
}
