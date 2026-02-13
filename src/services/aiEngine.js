// ======================================================================
// 🧠 aiEngine.js — REWRITE (2026-01-29)
// Obiettivi:
// - Compatibilità totale con call sites esistenti:
//   callAIModel(prompt)
//   callAIModel(prompt, options)
//   callAIModel(prompt, "text"|"json", options)
//   callAIModel(optionsObject)
// - Supporto messages[] (se passati)
// - Provider routing robusto (inferisce provider dal model se serve)
// - Timeout per-call (client timeout)
// - Error mapping coerente (code/status/provider/retryAfterMs)
// - Fallback Groq->OpenAI su 429 (one-shot) se allowFallback=true
//   (se fallback fallisce: rilancia come 429 AI_RATE_LIMIT con retryAfterMs)
// ======================================================================

import OpenAI from "openai";

// -------------------- ENV --------------------
const ENV_DEFAULT_PROVIDER = String(process.env.AI_PROVIDER || "groq").toLowerCase();
const ENV_DEFAULT_FALLBACK_PROVIDER = String(process.env.AI_FALLBACK_PROVIDER || "openai").toLowerCase();

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();

const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").trim();

const DEFAULT_MODEL_OPENAI =
  process.env.AI_MODEL_OPENAI ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini";

const DEFAULT_MODEL_GROQ =
  process.env.AI_MODEL_GROQ ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);
const DEFAULT_TEMPERATURE = Number(process.env.AI_TEMPERATURE || 0.7);
const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 2400);

// Fallback switch (compat)
const ENABLE_FALLBACK_OPENAI =
  String(process.env.ENABLE_FALLBACK_OPENAI || "1") === "1";

// -------------------- Helpers --------------------
function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function inferProviderFromModel(model) {
  const m = String(model || "").toLowerCase().trim();
  if (!m) return null;

  // euristiche “buone abbastanza”
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.includes("openai")) return "openai";
  if (m.startsWith("llama") || m.includes("mixtral") || m.includes("gemma") || m.includes("qwen")) return "groq";

  return null;
}

function pickProvider(explicitProvider, model, envDefaultProvider) {
  if (explicitProvider) return String(explicitProvider).toLowerCase();
  const inferred = inferProviderFromModel(model);
  return inferred || String(envDefaultProvider || "groq").toLowerCase();
}

function makeClient(provider, timeoutMs) {
  const t = Number(timeoutMs || DEFAULT_TIMEOUT_MS);

  if (provider === "openai") {
    if (!OPENAI_API_KEY) {
      const e = new Error("Missing OPENAI_API_KEY");
      e.code = "AI_AUTH_MISSING";
      e.status = 401;
      e.provider = "openai";
      throw e;
    }
    return new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL, timeout: t });
  }

  // groq (OpenAI-compatible)
  if (!GROQ_API_KEY) {
    const e = new Error("Missing GROQ_API_KEY");
    e.code = "AI_AUTH_MISSING";
    e.status = 401;
    e.provider = "groq";
    throw e;
  }
  return new OpenAI({ apiKey: GROQ_API_KEY, baseURL: GROQ_BASE_URL, timeout: t });
}

function parseRetryAfterMsFromText(msg) {
  const s = String(msg || "");
  // es: "Please try again in 2m1.8s"
  const m = s.match(/try again in\s+(\d+)m([\d.]+)s/i);
  if (!m) return null;
  const minutes = Number(m[1] || 0);
  const seconds = Number(m[2] || 0);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.round((minutes * 60 + seconds) * 1000));
}

function mapError(err, providerHint) {
  const provider = providerHint || err?._provider || err?.provider || "unknown";

  const status =
    err?.status ||
    err?.response?.status ||
    err?.response?.statusCode ||
    err?.httpStatus ||
    null;

  const message =
    err?.message ||
    err?.response?.data?.error?.message ||
    err?.error?.message ||
    String(err);

  let code =
    err?.code ||
    err?.response?.data?.error?.code ||
    err?.error?.code ||
    null;

  // normalizza rate limit
  if (Number(status) === 429) code = code || "AI_RATE_LIMIT";

  const retryAfterMs =
    err?.retryAfterMs ??
    parseRetryAfterMsFromText(message) ??
    null;

  return {
    code: String(code || "AI_CALL_ERROR"),
    status: Number.isFinite(Number(status)) ? Number(status) : 500,
    provider: String(provider),
    message: String(message || "AI error"),
    retryAfterMs,
  };
}

// -------------------- Arg parsing (compat totale) --------------------
function normalizeArgs(a, b, c) {
  const defaults = {
    provider: null, // se null: inferito da model o env
    fallbackProvider: ENV_DEFAULT_FALLBACK_PROVIDER,
    allowFallback: ENABLE_FALLBACK_OPENAI,

    model: null,
    fallbackModel: null,

    system: "You are a helpful assistant.",
    prompt: "",
    messages: null,

    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    jsonMode: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,

    sanitizeOutput: false, // lasciato per compat
  };

  // 1) callAIModel(optionsObject)
  if (isPlainObject(a)) {
    const o = a;
    const explicitProvider = Object.prototype.hasOwnProperty.call(o, "provider");
    const model = o.model ?? null;

    const provider = pickProvider(
      explicitProvider ? o.provider : null,
      model,
      ENV_DEFAULT_PROVIDER
    );

    const jsonMode =
      o.jsonMode === true ||
      (typeof b === "string" && b.toLowerCase() === "json") ||
      false;

    return {
      ...defaults,
      ...o,
      provider,
      model,
      jsonMode,
      timeoutMs: Number(o.timeoutMs ?? defaults.timeoutMs),
      temperature: o.temperature ?? defaults.temperature,
      maxTokens: o.maxTokens ?? defaults.maxTokens,
      allowFallback: o.allowFallback ?? defaults.allowFallback,
      fallbackProvider: String(o.fallbackProvider ?? defaults.fallbackProvider).toLowerCase(),
      fallbackModel: o.fallbackModel ?? null,
    };
  }

  // 2) callAIModel(promptString, options?) OR callAIModel(promptString, mode, options)
  const prompt = String(a ?? "");
  let mode = null;
  let opts = null;

  if (typeof b === "string") {
    mode = b.toLowerCase();
    opts = isPlainObject(c) ? c : null;
  } else if (isPlainObject(b)) {
    opts = b;
  } else {
    opts = null;
  }

  const explicitProvider = opts && Object.prototype.hasOwnProperty.call(opts, "provider");
  const model = opts?.model ?? null;

  const provider = pickProvider(
    explicitProvider ? opts.provider : null,
    model,
    ENV_DEFAULT_PROVIDER
  );

  const jsonMode = mode === "json" ? true : Boolean(opts?.jsonMode);

  return {
    ...defaults,
    ...(opts || {}),
    provider,
    prompt,
    model,
    jsonMode,
    timeoutMs: Number((opts && opts.timeoutMs) ?? defaults.timeoutMs),
    temperature: (opts && opts.temperature) ?? defaults.temperature,
    maxTokens: (opts && opts.maxTokens) ?? defaults.maxTokens,
    allowFallback: (opts && opts.allowFallback) ?? defaults.allowFallback,
    fallbackProvider: String((opts && opts.fallbackProvider) ?? defaults.fallbackProvider).toLowerCase(),
    fallbackModel: (opts && opts.fallbackModel) ?? null,
  };
}

// -------------------- Core call --------------------
async function doCall(provider, cfg) {
  const client = makeClient(provider, cfg.timeoutMs);

  // model di default coerente col provider
  const model =
    cfg.model ||
    (provider === "openai" ? DEFAULT_MODEL_OPENAI : DEFAULT_MODEL_GROQ);

  // messages: se forniti usali, altrimenti system+prompt
  const messages = Array.isArray(cfg.messages) && cfg.messages.length
    ? cfg.messages
    : [
        { role: "system", content: String(cfg.system || "You are a helpful assistant.") },
        { role: "user", content: String(cfg.prompt || "") },
      ];

  const payload = {
    model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  };

  if (cfg.jsonMode) {
    payload.response_format = { type: "json_object" };

    // safety: se il system non parla di JSON, aggiungi hint
    const sys = String(messages?.[0]?.content || "");
    if (!sys.toLowerCase().includes("json")) {
      messages[0].content = sys + " (Reply strictly in JSON format).";
    }
  }

  const res = await client.chat.completions.create(payload);
  const out = res?.choices?.[0]?.message?.content;
  const text = typeof out === "string" ? out.trim() : "";

  if (!text) {
    const e = new Error("AI Engine: empty response");
    e.code = "AI_EMPTY";
    e.status = 502;
    e.provider = provider;
    throw e;
  }

  return text;
}

// -------------------- Public API --------------------
export async function callAIModel(a, b, c) {
  const cfg = normalizeArgs(a, b, c);

  if (cfg.messages == null && !String(cfg.prompt || "").trim()) {
    const e = new Error("AI Engine: missing prompt");
    e.code = "AI_BAD_INPUT";
    e.status = 400;
    e.provider = cfg.provider || ENV_DEFAULT_PROVIDER;
    throw e;
  }

  const provider = String(cfg.provider || ENV_DEFAULT_PROVIDER).toLowerCase();
  const fallbackProvider = String(cfg.fallbackProvider || "openai").toLowerCase();

  // 1) primary
  try {
    return await doCall(provider, cfg);
  } catch (err) {
    if (err && typeof err === "object") err._provider = provider;
    const primary = mapError(err, provider);

    const canFallback =
      cfg.allowFallback === true &&
      provider === "groq" &&
      fallbackProvider === "openai" &&
      Number(primary.status) === 429;

    if (!canFallback) {
      const e = new Error(primary.message);
      e.code = primary.code;
      e.status = primary.status;
      e.provider = primary.provider;
      e.retryAfterMs = primary.retryAfterMs ?? null;
      throw e;
    }

    // 2) fallback one-shot (OpenAI)
    try {
      const fbCfg = { ...cfg, provider: "openai" };
      // IMPORTANT: se non specifichi fallbackModel, usa DEFAULT_MODEL_OPENAI
      fbCfg.model = cfg.fallbackModel || DEFAULT_MODEL_OPENAI;

      return await doCall("openai", fbCfg);
    } catch (fbErr) {
      if (fbErr && typeof fbErr === "object") fbErr._provider = "openai";
      const fb = mapError(fbErr, "openai");

      // requisito: se fallback fallisce dopo 429 Groq -> rilancia come 429
      const e = new Error(`Rate limit: groq 429, fallback openai failed (${fb.code})`);
      e.code = "AI_RATE_LIMIT";
      e.status = 429;
      e.provider = "groq->openai";
      e.retryAfterMs = primary.retryAfterMs ?? (fb.status === 429 ? fb.retryAfterMs : null) ?? 15000;
      e.primaryError = primary;
      e.fallbackError = fb;
      throw e;
    }
  }
}
