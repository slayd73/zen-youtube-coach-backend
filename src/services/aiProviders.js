// aiProviders.js
const Groq = require("groq-sdk");
const OpenAI = require("openai");

// Client GROQ (sempre, perché usiamo Groq come base gratuita)
const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Client OpenAI (solo se hai messo OPENAI_API_KEY nelle env)
let openaiClient = null;
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Modelli di default
const GROQ_MODEL = "llama-3.1-70b-versatile";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// ---- FUNZIONI DI BASE PER I DUE MOTORI ----

async function generateWithGroq({ systemPrompt, userPrompt, temperature = 0.8 }) {
  console.log("[AI] Using Groq:", GROQ_MODEL);

  const completion = await groqClient.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature
  });

  return completion.choices[0].message.content.trim();
}

async function generateWithOpenAI({ systemPrompt, userPrompt, temperature = 0.8, model = OPENAI_MODEL }) {
  if (!openaiClient) {
    throw new Error("OpenAI non configurato: manca OPENAI_API_KEY.");
  }

  console.log("[AI] Using OpenAI:", model);

  const completion = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature
  });

  return completion.choices[0].message.content.trim();
}

module.exports = {
  generateWithGroq,
  generateWithOpenAI
};
