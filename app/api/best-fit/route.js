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

  const batches = [];
  for (let i = 0; i < jobs.length; i += BATCH) batches.push(jobs.slice(i, i + BATCH));

  // Run all batches CONCURRENTLY — sequential round-trips were summing past
  // Vercel's 60s function limit and causing 504s. Wall-clock time for
  // parallel batches is bounded by the slowest single batch, not the total.
  const settled = await Promise.allSettled(
    batches.map((batch) => {
      const list = batch
        .map((j, idx) => `${idx + 1}. id="${j.id}" | ${j.title} @ ${j.company} (${j.location || ""})\nDescription: ${(j.description || "no description available").slice(0, 800)}`)
        .join("\n\n");
      return ai(
        `${profileText}\n\nBelow are ${batch.length} real job postings. For EACH one, score how well THIS SPECIFIC PERSON'S actual, confirmed experience (from the profile above) fits THIS SPECIFIC job's real requirements — not generic title-keyword matching. Be conservative and honest: if the job needs skills, seniority, or domain experience not evidenced in the profile, the score must reflect that gap. A job in a similar-sounding field the person has never actually done should score low. Keep each "why" to ONE short sentence (under 25 words) — brevity matters more than detail here.\n\nJOBS:\n${list}\n\nRespond with ONLY JSON: {"results": [{"id": "the exact id string given", "fit_score": 0-100, "why": "one short honest sentence — what matches and what's missing, grounded in the profile"}]}`,
        { maxOutputTokens: 4096, retries: 1 }
      );
    })
  );

  const results = [];
  let failedBatches = 0;
  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value?.results)) results.push(...s.value.results);
    else failedBatches++;
  }
  if (!results.length && failedBatches)
    return Response.json({ error: "AI returned malformed output for every batch — click Analyze again" }, { status: 500 });
  return Response.json({ results, failedBatches });
}
