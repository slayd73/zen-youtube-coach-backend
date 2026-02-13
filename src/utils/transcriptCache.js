// backend/src/utils/transcriptCache.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

const DEFAULT_TTL_MS = 0; // 0 = infinito

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function safeMkdirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function buildCacheKey({ videoId, language = "it", version = "v1" }) {
  return sha1(`${videoId}::${language}::${version}`);
}

export function getCacheBaseDir() {
  const root = process.cwd(); // root backend dove lanci node
  return path.join(root, "cache", "transcripts");
}

export function getCacheDirForKey(key) {
  return path.join(getCacheBaseDir(), key);
}

export async function readTranscriptCache({
  key,
  ttlMs = DEFAULT_TTL_MS,
}) {
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

    if (!txtRaw || txtRaw.trim().length < 20) {
      return { hit: false, reason: "empty_cache" };
    }

    return { hit: true, transcript: txtRaw, meta };
  } catch {
    return { hit: false, reason: "miss" };
  }
}

export async function writeTranscriptCache({
  key,
  transcript,
  meta = {},
}) {
  const dir = getCacheDirForKey(key);
  safeMkdirSync(dir);

  const metaPath = path.join(dir, "meta.json");
  const txtPath = path.join(dir, "transcript.txt");

  const outMeta = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...meta,
  };

  await Promise.all([
    fsp.writeFile(txtPath, transcript ?? "", "utf-8"),
    fsp.writeFile(metaPath, JSON.stringify(outMeta, null, 2), "utf-8"),
  ]);

  return { ok: true, dir };
}

/**
 * Lock anti-concorrenza (evita doppia Whisper su stesso video).
 * Crea un file lock. Se esiste, significa "in corso".
 */
export async function withTranscriptLock(key, fn, { lockTtlMs = 10 * 60 * 1000 } = {}) {
  const dir = getCacheDirForKey(key);
  safeMkdirSync(dir);

  const lockPath = path.join(dir, ".lock");

  // se lock esiste ma è vecchio (crash), lo rimuoviamo
  try {
    const st = await fsp.stat(lockPath);
    const age = Date.now() - st.mtimeMs;
    if (age > lockTtlMs) {
      await fsp.unlink(lockPath).catch(() => {});
    }
  } catch {
    // nessun lock
  }

  // prova a creare lock in modo atomico
  try {
    const fd = await fsp.open(lockPath, "wx"); // fail se esiste
    await fd.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf-8");
    await fd.close();
  } catch (e) {
    // lock già presente
    return { locked: true, result: null };
  }

  try {
    const result = await fn();
    return { locked: false, result };
  } finally {
    await fsp.unlink(lockPath).catch(() => {});
  }
}
