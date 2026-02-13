// src/services/callAIModel.js
import { debugId } from "../utils/textSanitizer.js";

function parseRetryAfterMs(res) {
  // Preferisci header Retry-After (sec) se presente
  const ra = res.headers.get("retry-after");
  if (ra) {
    const sec = Number(ra);
    if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 120000);
  }
  // Alcuni provider espongono reset ms/epoch in header custom: se non c'è, fallback
  return 15000;
}

async function safeReadJson(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  // fallback: prova testo e wrappa
  const t = await res.text();
  return { _nonJsonBody: t };
}

export class AIHTTPError extends Error {
  constructor({ message, status, provider, retryAfterMs, details, requestId }) {
    super(message);
    this.name = "AIHTTPError";
    this.status = status;
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
    this.details = details;
    this.requestId = requestId;
  }
}

/**
 * Chiamata singola al provider (NO retry).
 * Se 429: lancia AIHTTPError con retryAfterMs.
 */
export async function callChatCompletions({
  providerName,
  baseUrl,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs,
}) {
  const requestId = debugId();
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Authorization": `Bearer ${apiKey}`,
  };

  // Alcuni gateway gradiscono un header per tracing
  headers["X-Request-Id"] = requestId;

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(t);
    const msg = err?.name === "AbortError"
      ? `AI timeout dopo ${timeoutMs}ms`
      : `AI fetch error: ${String(err?.message || err)}`;
    throw new AIHTTPError({
      message: msg,
      status: 0,
      provider: providerName,
      retryAfterMs: null,
      details: { cause: String(err?.stack || err) },
      requestId,
    });
  } finally {
    clearTimeout(t);
  }

  const status = res.status;
  const body = await safeReadJson(res);

  if (!res.ok) {
    const retryAfterMs = status === 429 ? parseRetryAfterMs(res) : null;

    // Prova a estrarre un messaggio errore “umano”
    const providerMsg =
      body?.error?.message ||
      body?.message ||
      body?._nonJsonBody ||
      `HTTP ${status}`;

    throw new AIHTTPError({
      message: providerMsg,
      status,
      provider: providerName,
      retryAfterMs,
      details: body,
      requestId,
    });
  }

  // OpenAI-compatible
  const content =
    body?.choices?.[0]?.message?.content ??
    body?.choices?.[0]?.text ??
    "";

  return {
    requestId,
    raw: body,
    content: String(content ?? ""),
    model,
    provider: providerName,
  };
}
