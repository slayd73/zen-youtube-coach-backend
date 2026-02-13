// backend/src/services/transcriptService.js
// ============================================================
// transcriptService.js — Wrapper per Transcript Engine (layered)
// ✅ Propaga SEMPRE meta.attempts (trace/debug.attempts)
// ✅ Mai [] "muto": se manca trace, aggiunge tentativo diagnostico
// ✅ CACHE su disco: evita di rifare Whisper ogni volta
// ✅ LOCK anti-concorrenza: evita doppia trascrizione parallela
// ✅ Compatibile con 2 formati del layer:
//    A) { success, provider, text, trace?, debug? }
//    B) { ok, provider, text, kind, len, trace?, debug:{attempts} }
// ============================================================

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

import { getTranscript as layeredGetTranscript } from "./youtubeTranscriptService.js";

// ------------------------------------------------------------
// Config cache (disco)
// ------------------------------------------------------------
const CACHE_VERSION = "transcript-v1"; // cambia se cambi logica/prompt pipeline
const CACHE_TTL_MS = 0; // 0 = infinito (consigliato)
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 min: se crasha, il lock scade

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function safeMkdirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getCacheBaseDir() {
  return path.join(process.cwd(), "cache", "transcripts");
}

function buildCacheKey({ videoId, lang }) {
  return sha1(`${videoId}::${lang}::${CACHE_VERSION}`);
}

function getCacheDirForKey(key) {
  return path.join(getCacheBaseDir(), key);
}

function extractYouTubeVideoId(videoIdOrUrl) {
  if (!videoIdOrUrl) return null;
  const s = String(videoIdOrUrl).trim();

  // Se già sembra un videoId (11 char), lo accetto.
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  // youtu.be/<id>
  let m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m?.[1]) return m[1];

  // watch?v=<id>
  m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m?.[1]) return m[1];

  // shorts/<id>
  m = s.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m?.[1]) return m[1];

  // embed/<id>
  m = s.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (m?.[1]) return m[1];

  return null;
}

async function readCache({ key, ttlMs = CACHE_TTL_MS }) {
  const dir = getCacheDirForKey(key);
  const metaPath = path.join(dir, "meta.json");
  const txtPath = path.join(dir, "transcript.txt");

  try {
    const [metaRaw, txtRaw] = await Promise.all([
      fsp.readFile(metaPath, "utf-8"),
      fsp.readFile(txtPath, "utf-8"),
    ]);

    const meta = JSON.parse(metaRaw);

    if (ttlMs > 0 && meta?.createdAt) {
      const age = Date.now() - new Date(meta.createdAt).getTime();
      if (age > ttlMs) return { hit: false, reason: "ttl_expired" };
    }

    const text = (txtRaw || "").trim();
    if (text.length < 20) return { hit: false, reason: "empty_cache" };

    return { hit: true, transcript: text, meta };
  } catch {
    return { hit: false, reason: "miss" };
  }
}

async function writeCache({ key, transcript, meta = {} }) {
  const dir = getCacheDirForKey(key);
  safeMkdirSync(dir);

  const metaPath = path.join(dir, "meta.json");
  const txtPath = path.join(dir, "transcript.txt");

  const outMeta = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cacheVersion: CACHE_VERSION,
    ...meta,
  };

  await Promise.all([
    fsp.writeFile(txtPath, transcript ?? "", "utf-8"),
    fsp.writeFile(metaPath, JSON.stringify(outMeta, null, 2), "utf-8"),
  ]);

  return { ok: true, dir };
}

async function withLock(key, fn) {
  const dir = getCacheDirForKey(key);
  safeMkdirSync(dir);

  const lockPath = path.join(dir, ".lock");

  // Se lock esiste ma è vecchio (crash), lo rimuoviamo
  try {
    const st = await fsp.stat(lockPath);
    const age = Date.now() - st.mtimeMs;
    if (age > LOCK_TTL_MS) {
      await fsp.unlink(lockPath).catch(() => {});
    }
  } catch {
    // no lock
  }

  // Crea lock atomico
  try {
    const fd = await fsp.open(lockPath, "wx");
    await fd.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf-8");
    await fd.close();
  } catch {
    return { locked: true, result: null };
  }

  try {
    const result = await fn();
    return { locked: false, result };
  } finally {
    await fsp.unlink(lockPath).catch(() => {});
  }
}

// ------------------------------------------------------------
// Attempts mapping: SEMPRE parlante
// ------------------------------------------------------------
function toAttempts(tr) {
  const attempts = tr?.trace || tr?.debug?.attempts || [];

  if (!Array.isArray(attempts) || attempts.length === 0) {
    return [
      {
        method: "trace-missing",
        error:
          "Il Transcript Engine non ha restituito trace/attempts. " +
          "Controlla youtubeTranscriptService.js: deve pushare attempts e ritornarli in trace o debug.attempts.",
      },
    ];
  }

  return attempts;
}

// ------------------------------------------------------------
// Main API (compat legacy routes)
// ------------------------------------------------------------
export async function getTranscript(videoIdOrUrl, options = {}) {
  const lang = options.lang || options.language || "it";
  const debug = options.debug === true;

  const videoId = extractYouTubeVideoId(videoIdOrUrl) || null;
  const cacheKey = videoId ? buildCacheKey({ videoId, lang }) : null;

  // 0) Cache HIT immediato (se ho videoId)
  if (cacheKey) {
    const cached = await readCache({ key: cacheKey, ttlMs: CACHE_TTL_MS });
    if (cached.hit) {
      const text = (cached.transcript || "").trim();
      const attempts = [
        {
          method: "cache-hit",
          ok: true,
          info: `Cache transcript OK (key=${cacheKey})`,
        },
      ];

      return {
        success: true,
        error: false,
        provider: cached.meta?.provider || "cache",
        kind: cached.meta?.kind || "captions_or_audio",
        videoId: cached.meta?.videoId || videoId,
        continuousText: text,
        aiText: null,
        timestamp: new Date().toISOString(),
        meta: {
          lang: cached.meta?.lang || lang,
          len: text.length,
          attempts,
          cache: {
            hit: true,
            key: cacheKey,
            dir: cached.meta?.cacheDir || `cache/transcripts/${cacheKey}`,
            createdAt: cached.meta?.createdAt,
          },
        },
      };
    }
  }

  // 1) Se ho videoId, metto lock per evitare doppia Whisper parallela
  if (cacheKey) {
    const lockedRun = await withLock(cacheKey, async () => {
      // Double-check cache dopo lock (caso raro)
      const cached2 = await readCache({ key: cacheKey, ttlMs: CACHE_TTL_MS });
      if (cached2.hit) {
        const text2 = (cached2.transcript || "").trim();
        return {
          __fromCache: true,
          payload: {
            success: true,
            error: false,
            provider: cached2.meta?.provider || "cache",
            kind: cached2.meta?.kind || "captions_or_audio",
            videoId: cached2.meta?.videoId || videoId,
            continuousText: text2,
            aiText: null,
            timestamp: new Date().toISOString(),
            meta: {
              lang: cached2.meta?.lang || lang,
              len: text2.length,
              attempts: [
                { method: "cache-hit-after-lock", ok: true, info: "Cache OK" },
              ],
              cache: {
                hit: true,
                key: cacheKey,
                dir: cached2.meta?.cacheDir || `cache/transcripts/${cacheKey}`,
                createdAt: cached2.meta?.createdAt,
              },
            },
          },
        };
      }

      // 2) Pipeline reale (layered)
      const tr = await layeredGetTranscript(videoIdOrUrl, { lang, debug });
      const attempts = toAttempts(tr);

      // Normalizzazione risultati layer
      const isA = !!tr?.success;
      const isB = !!tr?.ok;

      const text = (tr?.text || "").trim();
      const provider = tr?.provider || (isA || isB ? "unknown" : "none");
      const kind = tr?.kind || "captions_or_audio";
      const resolvedVideoId = tr?.debug?.videoId || videoId || null;

      if (isA || isB) {
        // SUCCESS
        const payload = {
          success: true,
          error: false,
          provider,
          kind,
          videoId: resolvedVideoId,
          continuousText: text,
          aiText: null,
          timestamp: new Date().toISOString(),
          meta: {
            lang: tr?.lang || lang,
            len: tr?.len || text.length,
            attempts,
            cache: {
              hit: false,
              key: cacheKey,
              dir: `cache/transcripts/${cacheKey}`,
            },
          },
        };

        // Scrivo cache solo se testo è valido
        if (text.length > 20) {
          await writeCache({
            key: cacheKey,
            transcript: text,
            meta: {
              provider,
              kind,
              videoId: resolvedVideoId,
              lang: tr?.lang || lang,
              cacheDir: `cache/transcripts/${cacheKey}`,
            },
          });

          // aggiungo attempt cache-write (non sovrascrivo i tuoi attempts)
          payload.meta.attempts = [
            ...attempts,
            { method: "cache-write", ok: true, info: "Transcript salvato su cache" },
          ];
        } else {
          payload.meta.attempts = [
            ...attempts,
            { method: "cache-skip", ok: false, error: "Testo troppo corto, cache non salvata" },
          ];
        }

        return { __fromCache: false, payload };
      }

      // FAIL (ma con attempts parlanti)
      const payloadFail = {
        success: false,
        error: true,
        provider: provider || "none",
        kind: tr?.kind || "none",
        videoId: resolvedVideoId,
        continuousText: "",
        aiText: null,
        timestamp: new Date().toISOString(),
        meta: {
          lang,
          len: tr?.len || 0,
          error_code: tr?.error_code || "NO_TRANSCRIPT",
          error_message: tr?.error_message || "Transcript non disponibile",
          attempts,
          cache: {
            hit: false,
            key: cacheKey,
            dir: `cache/transcripts/${cacheKey}`,
          },
        },
      };

      return { __fromCache: false, payload: payloadFail };
    });

    // Se c'è già una trascrizione in corso, non duplicare lavoro
    if (lockedRun.locked) {
      return {
        success: false,
        error: true,
        provider: "lock",
        kind: "none",
        videoId: videoId,
        continuousText: "",
        aiText: null,
        timestamp: new Date().toISOString(),
        meta: {
          lang,
          len: 0,
          error_code: "TRANSCRIPT_IN_PROGRESS",
          error_message: "Trascrizione già in corso per questo video. Riprova tra poco.",
          attempts: [
            {
              method: "lock",
              ok: false,
              error: "TRANSCRIPT_IN_PROGRESS",
            },
          ],
          cache: {
            hit: false,
            key: cacheKey,
            dir: `cache/transcripts/${cacheKey}`,
          },
        },
      };
    }

    return lockedRun.result.payload;
  }

  // 3) Se NON riesco a estrarre videoId, fallback senza cache
  const tr = await layeredGetTranscript(videoIdOrUrl, { lang, debug });
  const attempts = toAttempts(tr);

  if (tr?.success) {
    const text = (tr.text || "").trim();
    return {
      success: true,
      error: false,
      provider: tr.provider || "unknown",
      kind: tr.kind || "captions_or_audio",
      videoId: tr?.debug?.videoId || null,
      continuousText: text,
      aiText: null,
      timestamp: new Date().toISOString(),
      meta: { lang, len: text.length, attempts },
    };
  }

  if (tr?.ok) {
    const text = (tr.text || "").trim();
    return {
      success: true,
      error: false,
      provider: tr.provider || "unknown",
      kind: tr.kind || "captions_or_audio",
      videoId: tr?.debug?.videoId || null,
      continuousText: text,
      aiText: null,
      timestamp: new Date().toISOString(),
      meta: {
        lang: tr.lang || lang,
        len: tr.len || text.length,
        attempts,
      },
    };
  }

  return {
    success: false,
    error: true,
    provider: tr?.provider || "none",
    kind: tr?.kind || "none",
    videoId: tr?.debug?.videoId || null,
    continuousText: "",
    aiText: null,
    timestamp: new Date().toISOString(),
    meta: {
      lang,
      len: tr?.len || 0,
      error_code: tr?.error_code || "NO_TRANSCRIPT",
      error_message: tr?.error_message || "Transcript non disponibile",
      attempts,
    },
  };
}
