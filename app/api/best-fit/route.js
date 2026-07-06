import { ai } from "../../../lib/ai";

export const maxDuration = 60;
const BATCH = 20;

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
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const list = batch
      .map((j, idx) => `${idx + 1}. id="${j.id}" | ${j.title} @ ${j.company} (${j.location || ""})\nDescription: ${(j.description || "no description available").slice(0, 800)}`)
      .join("\n\n");
    const out = await ai(`${profileText}\n\nBelow are ${batch.length} real job postings. For EACH one, score how well THIS SPECIFIC PERSON'S actual, confirmed experience (from the profile above) fits THIS SPECIFIC job's real requirements — not generic title-keyword matching. Be conservative and honest: if the job needs skills, seniority, or domain experience not evidenced in the profile, the score must reflect that gap. A job in a similar-sounding field the person has never actually done should score low.\n\nJOBS:\n${list}\n\nRespond with ONLY JSON: {"results": [{"id": "the exact id string given", "fit_score": 0-100, "why": "one honest sentence — what matches and what's missing, grounded in the profile"}]}`);
    if (Array.isArray(out.results)) results.push(...out.results);
  }
  return Response.json({ results });
}
