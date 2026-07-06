import { ai } from "../../../lib/ai";

export const maxDuration = 60;

export async function POST(req) {
  try {
    if (req.headers.get("x-pass") !== process.env.DASHBOARD_PASSWORD)
      return Response.json({ error: "401 wrong password" }, { status: 401 });
    const f = await req.json();
    const out = await ai(`You are building a "master career profile" that will drive automatic CV tailoring, job scoring, and outreach for a job seeker. Turn the raw inputs below into a dense, factual master profile text block.

RAW INPUTS
Name: ${f.name}. Location: ${f.location}. Phone: ${f.phone}. Email: ${f.email}. LinkedIn: ${f.linkedin}.
One-line headline: ${f.headline || "(suggest one)"}
Target roles / search queries: ${f.queries || "(suggest 4-6 from the CV)"}
Fixed official roles (titles/dates must never be altered on a CV): ${JSON.stringify(f.fixedRoles || [])}
Education: ${JSON.stringify(f.education || [])}
Things to NEVER mention on CVs: ${f.neverMention || "none given"}
CV TEXT:\n${f.cvText}
EXTRA CONTEXT (confirmed facts, achievements, preferences):\n${f.extra || "none"}

Write the master profile block with these sections: EXPERIENCE (each role: official title, company, dates, then "Core verifiable:" facts strictly from the CV, then "Additionally confirmed:" facts strictly from the extra context — never invent anything); EDUCATION; TOOLS; HONESTY GUARDRAILS (never replace official titles — only append a descriptor after a dash; never invent named tools/systems; only include claims from this profile; never mention: ${f.neverMention || "—"}); STYLE (summary 3-5 lines; JD-anchored bullets, most recent role carries most JD-aligned bullets; use JD vocabulary where truthful; skills as exactly 5 bold-labelled category lines renamed to the JD's pillars); STANDING INTERVIEW RISKS (infer 2-3 from the career history, e.g. short tenures or title-vs-duties mismatches).

QUERIES — these drive real job-board searches, so precision matters far more than variety. Only suggest queries if "Target roles / search queries" above is empty; if it has content, copy it through unchanged (split on commas). When you must suggest:
- Each query must be a job title the person has ALREADY held, OR the exact next-seniority step of a role they've already held (e.g. "Analyst" → "Senior Analyst" is fine; "Analyst" → "Trader" is NOT, unless trading is explicitly in the CV).
- Never suggest an adjacent-sounding or "logical next step" title that isn't grounded in specific CV content — e.g. do not suggest "Trading Operations", "Investment Banking Associate", or any finance/industry jargon just because the CV mentions a bank or financial-services employer. The employer's industry is not the person's function.
- If in doubt, prefer a narrower, duller, more literal title over a broader or more exciting-sounding one.
- 3-5 queries, not 4-6 — fewer, correct queries beat more, loosely-related ones.

Respond with ONLY JSON: {"text": "the full master profile block", "queries": ["3-5 job search query strings, each traceable to a specific line in the CV"], "headline": "one line: '<a/an> <specialism> professional, <city>' — the specialism must match an actual held job title, not an inferred industry"}`);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e.message || "server error" }, { status: 500 });
  }
}
