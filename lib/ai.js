// Shared LLM caller with automatic failover across providers/keys so a hit
// quota never interrupts generation. Order (cheapest first):
//   1. GEMINI_API_KEY    — 4 free models, each with its own quota
//   2. GEMINI_API_KEY_2  — optional second free key (another Google account)
//   3. ANTHROPIC_API_KEY — optional paid backup (also best writing quality)
// Set FORCE_ANTHROPIC=1 to put Anthropic first instead.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];

async function tryGemini(key, prompt, maxOutputTokens) {
  for (const m of GEMINI_MODELS) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens },
        }),
      }
    );
    if (r.status === 429 || r.status === 503) continue; // quota/overload → next model
    if (!r.ok) throw new Error(`Gemini API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    const cand = data.candidates?.[0];
    // MAX_TOKENS finishReason means the JSON was cut off mid-generation —
    // treat like a soft failure so the caller's retry/repair logic kicks in
    // rather than silently returning truncated (unparseable) text.
    if (cand?.finishReason === "MAX_TOKENS" && !cand?.content?.parts?.[0]?.text) continue;
    return cand?.content?.parts?.[0]?.text || null;
  }
  return null; // all models exhausted on this key
}

async function tryAnthropic(key, prompt, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (r.status === 429 || r.status === 529) return null; // rate-limited → let caller continue chain
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).content[0].text;
}

// Attempts to salvage a JSON object even if the model's output was cut off
// mid-generation (common when a batch request runs long): trims to the last
// structurally-complete element and balances any unclosed brackets/braces.
function parseJsonLoose(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found");
  let slice = text.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    // Truncated mid-string/object: cut back to the last complete "}," or "}"
    // boundary, then close any dangling arrays/objects.
    const lastComplete = Math.max(slice.lastIndexOf("},"), slice.lastIndexOf("}\n"));
    if (lastComplete > 0) slice = slice.slice(0, lastComplete + 1);
    const opens = (slice.match(/[{[]/g) || []).length;
    const closes = (slice.match(/[}\]]/g) || []).length;
    const stack = [];
    for (const ch of slice) {
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    const closer = stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    return JSON.parse(slice + closer);
  }
}

export async function ai(prompt, { maxOutputTokens = 8192, retries = 1 } = {}) {
  const chain = [];
  const g1 = process.env.GEMINI_API_KEY && (() => tryGemini(process.env.GEMINI_API_KEY, prompt, maxOutputTokens));
  const g2 = process.env.GEMINI_API_KEY_2 && (() => tryGemini(process.env.GEMINI_API_KEY_2, prompt, maxOutputTokens));
  const an = process.env.ANTHROPIC_API_KEY && (() => tryAnthropic(process.env.ANTHROPIC_API_KEY, prompt, maxOutputTokens));
  if (process.env.FORCE_ANTHROPIC && an) chain.push(an, g1, g2);
  else chain.push(g1, g2, an);
  const steps = chain.filter(Boolean);

  for (let attempt = 0; attempt <= retries; attempt++) {
    let text = null;
    for (const step of steps) {
      text = await step();
      if (text) break;
    }
    if (text === null) {
      if (!steps.length) throw new Error("No AI key set — add GEMINI_API_KEY (free) to .env.local / Vercel env");
      throw new Error("All AI keys/models are at their limit — try again in an hour, or add GEMINI_API_KEY_2 / ANTHROPIC_API_KEY as backup");
    }
    try {
      return parseJsonLoose(text);
    } catch {
      if (attempt === retries) throw new Error("AI returned malformed output — click again (a retry usually works)");
      // else: silently retry
    }
  }
}
