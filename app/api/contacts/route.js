export const maxDuration = 60;

// Public hiring contacts via Gemini with Google Search grounding (free tier).
export async function POST(req) {
  try {
    return await handle(req);
  } catch (e) {
    return Response.json({ error: e.message || "server error" }, { status: 500 });
  }
}

async function handle(req) {
  if (req.headers.get("x-pass") !== process.env.DASHBOARD_PASSWORD)
    return Response.json({ error: "401 wrong password" }, { status: 401 });
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
  if (!key) return Response.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const { job, applicant } = await req.json();
  const prompt = `Find publicly available hiring contacts for this job application. Company: "${job.company}" (${job.location || ""}). Role being applied for: "${job.title}".
${job.poster ? `The job posting itself was posted by: ${job.poster} — include them as the first contact.` : ""}
Search the web for: (1) recruiters / talent acquisition people at this company, (2) the hiring manager or team lead for this function, (3) the company's work email address pattern (check leadiq.com, rocketreach.co, signalhire.com results).
Rules: only real people you actually found in search results — never invent names. If you find nobody, return an empty contacts list. Label email guesses as unverified.
The applicant: ${applicant?.name || "the candidate"}, ${applicant?.headline || "a professional"}.
Respond with ONLY JSON:
{"contacts":[{"name":"","title":"","linkedin":"url or null","why":"one line","source":"where found"}],"email_pattern":"e.g. first.last@x.com (unverified) or null","outreach":"a <=90 word LinkedIn message from the applicant for this specific role, referencing one requirement they genuinely match, ending by asking for a short conversation"}`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
    }
  );
  if (!r.ok) return Response.json({ error: `Gemini ${r.status}` }, { status: 502 });
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  try {
    return Response.json(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  } catch {
    return Response.json({ contacts: [], email_pattern: null, outreach: text.slice(0, 500) });
  }
}
