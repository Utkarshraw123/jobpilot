import { ai } from "../../../lib/ai";

export const maxDuration = 60;
const BATCH = 10; // smaller batches + higher token ceiling below reduce truncation risk

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

  const { jobs, profileText } = await req.json();
  if (!profileText) return Response.json({ error: "No profile text supplied" }, { status: 400 });
  if (!jobs?.length) return Response.json({ results: [] });

  const results = [];
  let failedBatches = 0;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const list = batch
      .map((j, idx) => `${idx + 1}. id="${j.id}" | ${j.title} @ ${j.company} (${j.location || ""})\nDescription: ${(j.description || "no description available").slice(0, 800)}`)
      .join("\n\n");
    try {
      const out = await ai(
        `${profileText}\n\nBelow are ${batch.length} real job postings. For EACH one, score how well THIS SPECIFIC PERSON'S actual, confirmed experience (from the profile above) fits THIS SPECIFIC job's real requirements — not generic title-keyword matching. Be conservative and honest: if the job needs skills, seniority, or domain experience not evidenced in the profile, the score must reflect that gap. A job in a similar-sounding field the person has never actually done should score low. Keep each "why" to ONE short sentence (under 25 words) — brevity matters more than detail here.\n\nJOBS:\n${list}\n\nRespond with ONLY JSON: {"results": [{"id": "the exact id string given", "fit_score": 0-100, "why": "one short honest sentence — what matches and what's missing, grounded in the profile"}]}`,
        { maxOutputTokens: 4096, retries: 1 }
      );
      if (Array.isArray(out.results)) results.push(...out.results);
    } catch (e) {
      // One bad batch (rare, even after the internal retry) shouldn't lose
      // results already gathered from other batches.
      failedBatches++;
    }
  }
  if (!results.length && failedBatches)
    return Response.json({ error: "AI returned malformed output for every batch — click Analyze again" }, { status: 500 });
  return Response.json({ results, failedBatches });
}
