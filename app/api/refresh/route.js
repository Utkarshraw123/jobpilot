import crypto from "crypto";

export const maxDuration = 60;

const EXCLUDE = /\b(senior|lead|head|director|principal|vp|vice president|chief|manager|engineer|developer|scientist|nurse|architect|intern|software|devops)\b/i;

// Sponsorship-language detection (checked against title+description text).
const SPONSOR_YES = /\b(visa sponsorship|sponsorship available|can sponsor|will sponsor|able to sponsor|able to offer sponsorship|skilled worker visa|tier ?2 (visa|sponsor)|certificate of sponsorship|sponsor a visa|sponsorship for the right candidate|offers? visa sponsorship)\b/i;
const SPONSOR_NO = /\b(no visa sponsorship|unable to sponsor|cannot sponsor|can ?not offer sponsorship|not able to (provide|offer) sponsorship|must (already )?have the right to work|existing right to work required|no sponsorship (is )?available|does not offer sponsorship|will not sponsor)\b/i;

function classifySponsorship(text) {
  if (SPONSOR_NO.test(text)) return "no";
  if (SPONSOR_YES.test(text)) return "yes";
  return "unclear";
}

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
  if (!process.env.APIFY_TOKEN) return Response.json({ error: "APIFY_TOKEN not set" }, { status: 500 });

  const { mode, queries, location, dreamCompanies, seniorOk } = await req.json();
  if (!queries?.length || !location)
    return Response.json({ error: "No profile search settings — create a profile on the Setup page" }, { status: 400 });

  const dream = mode === "dream";
  const sponsor = mode === "sponsor";
  const input = dream
    ? {
        keyword: ["analyst", "associate", ...queries.slice(0, 2)],
        locations: [location],
        companyInclude: (dreamCompanies || []).slice(0, 60),
        publishedAt: "r604800",
        maxItems: 150,
        saveOnlyUniqueItems: true,
      }
    : sponsor
    ? {
        // Combine the profile's own target roles with sponsorship-qualified
        // variants so LinkedIn's search surfaces postings that mention it.
        keyword: [
          ...queries.slice(0, 3).map((q) => `${q} visa sponsorship`),
          ...queries.slice(0, 2).map((q) => `${q} sponsorship available`),
        ],
        locations: [location],
        publishedAt: "r604800",
        maxItems: 150,
        saveOnlyUniqueItems: true,
      }
    : {
        keyword: queries.slice(0, 6),
        locations: [location],
        publishedAt: "r604800",
        maxItems: 150,
        saveOnlyUniqueItems: true,
      };

  const r = await fetch(
    `https://api.apify.com/v2/acts/cheap_scraper~linkedin-job-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=55`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
  );
  if (!r.ok) return Response.json({ error: `Apify ${r.status}` }, { status: 502 });
  const items = await r.json();

  // Heuristic score from the profile's own queries.
  const qWords = [...new Set(queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((w) => w.length > 3))];
  const locWord = (location.split(",")[0] || "").toLowerCase();
  const score = (j) => {
    const hay = `${j.title}`.toLowerCase();
    let s = 10;
    if (qWords.some((w) => hay.includes(w))) s += 40;
    if (/\b(junior|entry|graduate|associate|analyst)\b/i.test(hay)) s += 18;
    if ((j.location || "").toLowerCase().includes(locWord)) s += 15;
    return Math.min(s + (dream ? 8 : 0), 92);
  };

  const jobs = items
    .filter((i) => i.jobUrl && i.jobTitle && (seniorOk || !EXCLUDE.test(i.jobTitle)))
    .map((i) => {
      const description = (i.jobDescription || "").slice(0, 4000);
      const j = {
        id: crypto.createHash("sha1").update(i.jobUrl).digest("hex").slice(0, 12),
        title: i.jobTitle,
        company: i.companyName,
        location: i.location,
        posted_date: String(i.publishedAt || "").slice(0, 10),
        salary: Array.isArray(i.salaryInfo) && i.salaryInfo.length ? i.salaryInfo.join("–") : null,
        url: i.jobUrl,
        source: "linkedin",
        description,
        poster: i.posterFullName || null,
        dream,
        sponsorTab: sponsor,
      };
      j.score = score(j);
      j.sponsorship = classifySponsorship(`${i.jobTitle} ${description}`);
      j.fit_note = dream
        ? "Why: dream-company watchlist hit — open the posting to judge fit. Missing: full-description review happens when you generate the CV."
        : sponsor
        ? `Why: sponsorship-focused search — detected sponsorship language: ${j.sponsorship}. Missing: verify directly with the employer before relying on this.`
        : "Why: heuristic title match vs your search queries — open the posting to judge. Missing: full-description review happens when you generate the CV.";
      return j;
    })
    .filter((j) => j.score >= (dream || sponsor ? 40 : 50))
    .sort((a, b) => b.score - a.score);

  return Response.json(jobs);
}
