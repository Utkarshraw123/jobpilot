// Shared LLM caller with automatic failover across providers/keys so a hit
// quota never interrupts generation. Order (cheapest first):
//   1. GEMINI_API_KEY    — 4 free models, each with its own quota
//   2. GEMINI_API_KEY_2  — optional second free key (another Google account)
//   3. ANTHROPIC_API_KEY — optional paid backup (also best writing quality)
// Set FORCE_ANTHROPIC=1 to put Anthropic first instead.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];

async function tryGemini(key, prompt) {
  for (const m of GEMINI_MODELS) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      }
    );
    if (r.status === 429 || r.status === 503) continue; // quota/overload → next model
    if (!r.ok) throw new Error(`Gemini API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).candidates[0].content.parts[0].text;
  }
  return null; // all models exhausted on this key
}

async function tryAnthropic(key, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (r.status === 429 || r.status === 529) return null; // rate-limited → let caller continue chain
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).content[0].text;
}

export async function ai(prompt) {
  const chain = [];
  const g1 = process.env.GEMINI_API_KEY && (() => tryGemini(process.env.GEMINI_API_KEY, prompt));
  const g2 = process.env.GEMINI_API_KEY_2 && (() => tryGemini(process.env.GEMINI_API_KEY_2, prompt));
  const an = process.env.ANTHROPIC_API_KEY && (() => tryAnthropic(process.env.ANTHROPIC_API_KEY, prompt));
  if (process.env.FORCE_ANTHROPIC && an) chain.push(an, g1, g2);
  else chain.push(g1, g2, an);

  let text = null;
  for (const step of chain.filter(Boolean)) {
    text = await step();
    if (text) break;
  }
  if (text === null) {
    if (!chain.filter(Boolean).length)
      throw new Error("No AI key set — add GEMINI_API_KEY (free) to .env.local / Vercel env");
    throw new Error("All AI keys/models are at their limit — try again in an hour, or add GEMINI_API_KEY_2 / ANTHROPIC_API_KEY as backup");
  }
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("AI returned malformed output — click again (a retry usually works)");
  }
}
