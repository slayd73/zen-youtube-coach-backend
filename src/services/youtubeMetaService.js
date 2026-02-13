// backend/src/services/youtubeMetaService.js
// ============================================================
// YouTube Meta Service (NO Google API) — via yt-dlp
// - Extract real metadata: title, description, upload date, duration, views, likes...
// - Windows-friendly (uses yt-dlp.exe in /bin)
// - Has timeout + small in-memory cache
// ============================================================

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default: backend/bin/yt-dlp.exe (override via env if you want)
const DEFAULT_YTDLP_PATH = path.resolve(__dirname, "../../bin/yt-dlp.exe");
const YTDLP_PATH = process.env.YTDLP_PATH
  ? path.resolve(process.env.YTDLP_PATH)
  : DEFAULT_YTDLP_PATH;

const DEFAULT_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 25000);
const CACHE_TTL_MS = Number(process.env.YTDLP_CACHE_TTL_MS || 10 * 60 * 1000);

// simple cache: url -> { expiresAt, data }
const cache = new Map();

function now() {
  return Date.now();
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(key, data) {
  cache.set(key, { data, expiresAt: now() + CACHE_TTL_MS });
}

function runYtDlpJson(videoUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!videoUrl || typeof videoUrl !== "string") {
      return reject(new Error("Invalid videoUrl"));
    }

    const args = [
      "-J",
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      videoUrl,
    ];

    const child = spawn(YTDLP_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error(`yt-dlp timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);

      if (code !== 0) {
        return reject(
          new Error(
            `yt-dlp exit code ${code}. stderr: ${stderr.slice(0, 600)}`
          )
        );
      }

      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (e) {
        reject(new Error("yt-dlp returned non-JSON output"));
      }
    });
  });
}

function normalizeMeta(j) {
  // yt-dlp keys can vary by extractor/version
  const id = j?.id || null;

  const title = j?.title || null;
  const description = j?.description || null;

  // upload_date can be YYYYMMDD
  const uploadDate = j?.upload_date || null;
  const publishedAt =
    j?.timestamp
      ? new Date(j.timestamp * 1000).toISOString()
      : uploadDate && uploadDate.length === 8
      ? new Date(
          `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(
            6,
            8
          )}T00:00:00Z`
        ).toISOString()
      : j?.release_timestamp
      ? new Date(j.release_timestamp * 1000).toISOString()
      : null;

  const durationSec =
    typeof j?.duration === "number" ? j.duration : null;

  const viewCount =
    typeof j?.view_count === "number" ? j.view_count : null;

  const likeCount =
    typeof j?.like_count === "number" ? j.like_count : null;

  const commentCount =
    typeof j?.comment_count === "number" ? j.comment_count : null;

  // channel info (optional)
  const channelId = j?.channel_id || null;
  const channelTitle = j?.channel || j?.uploader || null;
  const channelUrl = j?.channel_url || null;

  return {
    id,
    title,
    description,
    publishedAt,
    durationSec,
    viewCount,
    likeCount,
    commentCount,
    channel: {
      id: channelId,
      title: channelTitle,
      url: channelUrl,
    },
  };
}

/**
 * getVideoMeta(videoUrl) -> { ok, meta, raw? }
 */
export async function getVideoMeta(videoUrl, opts = {}) {
  const key = String(videoUrl || "").trim();
  if (!key) {
    return { ok: false, meta: null, error: "Missing videoUrl" };
  }

  const cached = getCached(key);
  if (cached) return { ok: true, meta: cached, cached: true };

  try {
    const raw = await runYtDlpJson(key, opts);
    const meta = normalizeMeta(raw);

    // minimal validity: id + title + duration or viewCount (at least something)
    if (!meta.id || !meta.title) {
      return {
        ok: false,
        meta: null,
        error: "yt-dlp did not return minimal required fields (id/title).",
      };
    }

    setCached(key, meta);
    return { ok: true, meta, cached: false };
  } catch (e) {
    return {
      ok: false,
      meta: null,
      error: e?.message ? String(e.message) : "yt-dlp failed",
    };
  }
}
