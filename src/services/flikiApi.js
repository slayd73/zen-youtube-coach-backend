// src/services/flikiApi.js
// POST {VITE_API_BASE}/fliki/export-csv  (VITE_API_BASE deve includere /api)

function getApiBase() {
  const raw =
    (import.meta?.env?.VITE_API_BASE ||
      import.meta?.env?.VITE_API_BASE_URL ||
      import.meta?.env?.VITE_API_URL ||
      "").trim();

  const base = (raw || "http://localhost:4000/api").replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

async function parseError(res) {
  // prova JSON → fallback testo
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json();
      return j?.error || j?.message || JSON.stringify(j);
    }
  } catch {}

  try {
    const t = await res.text();
    return t?.slice(0, 500) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function extractFilename(res) {
  // 1) header custom
  const x = res.headers.get("x-export-filename") || res.headers.get("X-Export-Filename");
  if (x) return x;

  // 2) content-disposition (anche utf8)
  const cd = res.headers.get("content-disposition") || "";
  // filename*=UTF-8''...
  const mStar = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (mStar?.[1]) {
    try {
      return decodeURIComponent(mStar[1].trim().replace(/["']/g, ""));
    } catch {
      return mStar[1].trim().replace(/["']/g, "");
    }
  }
  // filename="..."
  const m = cd.match(/filename\s*=\s*"([^"]+)"/i);
  if (m?.[1]) return m[1];

  return `fliki-${Date.now()}.csv`;
}

/**
 * Scarica CSV Fliki Bulk come file
 * @param {{ scriptText: string, preset?: string, filename?: string }} payload
 * @param {string} token optional Clerk Bearer
 * @param {number} timeoutMs default 30000
 */
export async function exportFlikiCsvDownload(payload = {}, token, timeoutMs = 30000) {
  const apiBase = getApiBase();

  const headers = { "Content-Type": "application/json" };
  const t = String(token || "").trim();
  if (t) headers["Authorization"] = `Bearer ${t}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${apiBase}/fliki/export-csv`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e?.name === "AbortError" ? "Fliki export timeout (client)." : (e?.message || "Errore rete export Fliki."));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const msg = await parseError(res);
    throw new Error(`Fliki export failed: ${msg}`);
  }

  const blob = await res.blob();
  const filename = extractFilename(res);

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);

  return { ok: true, filename };
}
