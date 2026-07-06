"use client";
import { useEffect, useMemo, useState } from "react";

const STATUSES = ["shortlisted", "CV ready", "applied", "outreach sent", "interview", "offer", "rejected", "skipped"];
const band = (s) => (s >= 75 ? "s-hi" : s >= 50 ? "s-mid" : "s-lo");
const COOLDOWN = 24 * 60 * 60 * 1000;

export default function Dashboard() {
  const [profiles, setProfiles] = useState({});
  const [pid, setPid] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [tab, setTab] = useState("all");
  const [sponsorFilter, setSponsorFilter] = useState("yes");
  const [bestFitMin, setBestFitMin] = useState(70);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [scorecards, setScorecards] = useState({});
  const [contacts, setContacts] = useState({});
  const [tick, setTick] = useState(0);

  const active = pid ? profiles[pid] : null;
  const jobsKey = (id) => `jp_jobs_${id}`;
  const scanKey = (id, mode) => `jp_scan_${mode}_${id}`;

  useEffect(() => {
    const ps = JSON.parse(localStorage.getItem("jp_profiles") || "{}");
    setProfiles(ps);
    const ids = Object.keys(ps);
    if (!ids.length) { window.location.href = "/setup"; return; }
    const a = localStorage.getItem("jp_active");
    const id = ps[a] ? a : ids[0];
    setPid(id);
    setJobs(JSON.parse(localStorage.getItem(jobsKey(id)) || "[]"));
  }, []);

  const switchProfile = (id) => {
    if (id === "__new") { window.location.href = "/setup"; return; }
    localStorage.setItem("jp_active", id);
    setPid(id); setOpen(null); setScorecards({}); setContacts({});
    setJobs(JSON.parse(localStorage.getItem(jobsKey(id)) || "[]"));
  };
  const persist = (next) => { setJobs(next); localStorage.setItem(jobsKey(pid), JSON.stringify(next)); };
  const pw = () => {
    let p = localStorage.getItem("pw") || "";
    if (!p) { p = prompt("Dashboard password:") || ""; localStorage.setItem("pw", p); }
    return p;
  };
  const fmtLeft = (ms) => `${Math.floor(ms / 3600000)}h ${Math.ceil((ms % 3600000) / 60000)}m`;
  const remaining = pid ? Math.max(0, COOLDOWN - (Date.now() - (+localStorage.getItem(scanKey(pid, tab)) || 0))) : 0;

  const refresh = async (mode = tab) => {
    if (!active) return;
    const key = scanKey(pid, mode);
    const left = COOLDOWN - (Date.now() - (+localStorage.getItem(key) || 0));
    if (left > 0) { setMsg(`Already scanned recently — next scan in ${fmtLeft(left)}`); return; }
    if (mode === "dream" && !active.dreamCompanies?.length) { setMsg("No dream companies set for this profile — add them in Setup."); return; }
    setBusy("refresh"); setMsg("");
    try {
      const r = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pass": pw() },
        body: JSON.stringify({ mode, queries: active.queries, location: active.location, dreamCompanies: active.dreamCompanies, seniorOk: active.seniorOk }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `server error ${r.status} — try again`);
      const fresh = await r.json();
      const current = JSON.parse(localStorage.getItem(jobsKey(pid)) || "[]");
      const known = new Set(current.map((j) => j.id));
      const added = fresh.filter((j) => !known.has(j.id)).map((j) => ({ ...j, isNew: true, status: "shortlisted" }));
      persist([...added, ...current.map((j) => ({ ...j, isNew: false }))].sort((a, b) => b.score - a.score));
      localStorage.setItem(key, String(Date.now()));
      setTick((t) => t + 1);
      setMsg(`${added.length} new ${mode === "dream" ? "dream-company " : ""}jobs found (${fresh.length} scanned)`);
    } catch (e) { setMsg(`Refresh failed: ${e.message}`); if (String(e.message).includes("401")) localStorage.removeItem("pw"); }
    setBusy("");
  };

  const generate = async (job, type) => {
    setBusy(job.id + type); setMsg("");
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pass": pw() },
        body: JSON.stringify({ job, type, profile: active }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `server error ${r.status} — try again`);
      const d = await r.json();
      const bytes = Uint8Array.from(atob(d.data), (ch) => ch.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
      a.download = d.filename;
      a.click();
      if (d.scorecard) setScorecards((s) => ({ ...s, [job.id]: d.scorecard }));
      if (type === "cv") setStatus(job.id, "CV ready");
    } catch (e) { setMsg(`Generation failed: ${e.message}`); if (String(e.message).includes("401")) localStorage.removeItem("pw"); }
    setBusy("");
  };

  const findContacts = async (job) => {
    setBusy(job.id + "con"); setMsg("");
    try {
      const r = await fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pass": pw() },
        body: JSON.stringify({ job, applicant: { name: active.contact.name, headline: active.headline } }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `server error ${r.status} — try again`);
      setContacts({ ...contacts, [job.id]: await r.json() });
    } catch (e) { setMsg(`Contacts failed: ${e.message}`); if (String(e.message).includes("401")) localStorage.removeItem("pw"); }
    setBusy("");
  };

  const setStatus = (id, status) => persist(jobs.map((j) => (j.id === id ? { ...j, status } : j)));

  const analyzeBestFit = async () => {
    if (!active?.text) return;
    const candidates = jobs.filter((j) => j.fitScore == null).sort((a, b) => b.score - a.score).slice(0, 40);
    if (!candidates.length) { setMsg("Every scanned job already has a fit analysis. Scan for more jobs first."); return; }
    setBusy("bestfit"); setMsg("");
    try {
      const r = await fetch("/api/best-fit", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pass": pw() },
        body: JSON.stringify({
          jobs: candidates.map((j) => ({ id: j.id, title: j.title, company: j.company, location: j.location, description: j.description })),
          profileText: active.text,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `server error ${r.status} — try again`);
      const { results, failedBatches } = await r.json();
      const byId = Object.fromEntries(results.map((x) => [x.id, x]));
      const next = jobs.map((j) => (byId[j.id] ? { ...j, fitScore: byId[j.id].fit_score, fitWhy: byId[j.id].why } : j));
      persist(next);
      const strong = results.filter((x) => x.fit_score >= bestFitMin).length;
      const retryNote = failedBatches ? " Some jobs weren't analyzed due to a hiccup — click Analyze again to retry just those." : "";
      setMsg(`Analyzed ${results.length} jobs — ${strong} scored ${bestFitMin}+ for genuine fit.${retryNote}`);
    } catch (e) { setMsg(`Analysis failed: ${e.message}`); if (String(e.message).includes("401")) localStorage.removeItem("pw"); }
    setBusy("");
  };

  const shown = useMemo(() => {
    if (tab === "bestfit")
      return jobs.filter((j) => j.fitScore != null && j.fitScore >= bestFitMin && `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.fitScore - a.fitScore);
    return jobs.filter((j) => {
      const inTab = tab === "dream" ? j.dream : tab === "sponsor" ? j.sponsorTab : !j.dream && !j.sponsorTab;
      const sponsorOk = tab !== "sponsor" || sponsorFilter === "all" || j.sponsorship === sponsorFilter;
      return inTab && sponsorOk && j.score >= minScore && `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q.toLowerCase());
    });
  }, [jobs, q, minScore, tab, sponsorFilter, bestFitMin]);
  const stats = {
    total: jobs.length,
    strong: jobs.filter((j) => j.score >= 75).length,
    applied: jobs.filter((j) => ["applied", "outreach sent", "interview", "offer"].includes(j.status)).length,
  };

  if (!pid) return <div className="wrap"><p>Loading…</p></div>;

  return (
    <div className="wrap">
      <header>
        <h1>JobPilot</h1>
        <p>Scans the last 7 days · scores fit vs the active profile (0–100) · one-page tailored CVs</p>
      </header>

      {active && (!active.queries?.length || !active.location) && (
        <div className="job" style={{ borderColor: "#e0a800", background: "#fff8e6" }}>
          <b>⚠️ This profile is missing search settings</b> — {active.label} won't be able to scan for jobs until
          you add at least one target search and a location.{" "}
          <a href={`/setup?edit=${pid}`}><button className="primary">Fix it now</button></a>
        </div>
      )}

      <div className="bar" style={{ marginBottom: 4 }}>
        <select value={pid} onChange={(e) => switchProfile(e.target.value)} style={{ fontWeight: 650 }}>
          {Object.values(profiles).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="__new">＋ New profile…</option>
        </select>
        <a href={`/setup?edit=${pid}`}><button className="ghost">⚙️ Edit profile</button></a>
        <button className={tab === "all" ? "primary" : "ghost"} onClick={() => setTab("all")}>All jobs</button>
        <button className={tab === "dream" ? "primary" : "ghost"} onClick={() => setTab("dream")}>
          ⭐ Dream companies {jobs.filter((j) => j.dream && j.isNew).length > 0 && <span className="badge new">{jobs.filter((j) => j.dream && j.isNew).length} new</span>}
        </button>
        <button className={tab === "sponsor" ? "primary" : "ghost"} onClick={() => setTab("sponsor")}>
          🛂 Sponsorship {jobs.filter((j) => j.sponsorTab && j.isNew).length > 0 && <span className="badge new">{jobs.filter((j) => j.sponsorTab && j.isNew).length} new</span>}
        </button>
        <button className={tab === "bestfit" ? "primary" : "ghost"} onClick={() => setTab("bestfit")}>
          🎯 Best Fit {jobs.filter((j) => j.fitScore >= bestFitMin).length > 0 && <span className="badge new">{jobs.filter((j) => j.fitScore >= bestFitMin).length}</span>}
        </button>
      </div>
      {tab === "sponsor" && (
        <div className="bar" style={{ marginTop: -4 }}>
          <span className="meta">Show:</span>
          <select value={sponsorFilter} onChange={(e) => setSponsorFilter(e.target.value)}>
            <option value="all">All scanned</option>
            <option value="yes">Sponsorship confirmed</option>
            <option value="no">No sponsorship mentioned</option>
            <option value="unclear">Unclear — verify directly</option>
          </select>
        </div>
      )}
      {tab === "bestfit" && (
        <div className="bar" style={{ marginTop: -4 }}>
          <span className="meta">Minimum genuine fit:</span>
          <select value={bestFitMin} onChange={(e) => setBestFitMin(+e.target.value)}>
            <option value={60}>60+</option>
            <option value={70}>70+</option>
            <option value={80}>80+</option>
          </select>
          <span className="meta">{jobs.filter((j) => j.fitScore == null).length} scanned jobs not yet analyzed</span>
        </div>
      )}
      <div className="bar">
        <div className="stat"><b>{stats.total}</b>tracked</div>
        <div className="stat"><b>{stats.strong}</b>strong (75+)</div>
        <div className="stat"><b>{stats.applied}</b>in progress</div>
        {tab === "bestfit" ? (
          <button className="primary" onClick={analyzeBestFit} disabled={busy === "bestfit"}>
            {busy === "bestfit" ? "Analyzing against your CV…" : "🧠 Analyze best fit"}
          </button>
        ) : (
          <button className="primary" onClick={() => refresh(tab)} disabled={busy === "refresh"}>
            {busy === "refresh" ? "Scanning LinkedIn…" : remaining > 0 ? `↻ Next scan in ${fmtLeft(remaining)}` : tab === "dream" ? "↻ Scan dream companies" : tab === "sponsor" ? "↻ Scan sponsorship jobs" : "↻ Scan for new jobs"}
          </button>
        )}
        <input type="text" placeholder="Search title / company…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tab !== "bestfit" && (
          <select value={minScore} onChange={(e) => setMinScore(+e.target.value)}>
            <option value={0}>All scores</option>
            <option value={50}>50+ (partial)</option>
            <option value={75}>75+ (strong)</option>
          </select>
        )}
        {msg && <span className="msg">{msg}</span>}
      </div>

      {shown.length === 0 && tab === "bestfit" && (
        <p className="meta" style={{ margin: "30px 0" }}>
          No best-fit jobs yet — click <b>🧠 Analyze best fit</b> to compare your scanned jobs against your actual CV
          (scan for jobs first in the other tabs if you haven't already).
        </p>
      )}
      {shown.length === 0 && tab !== "bestfit" && <p className="meta" style={{ margin: "30px 0" }}>No jobs yet for {active?.label} — hit ↻ Scan to pull the last 7 days.</p>}

      {shown.map((j) => (
        <div className="job" key={j.id}>
          <div className="head" onClick={() => setOpen(open === j.id ? null : j.id)}>
            <span className={`score ${band(tab === "bestfit" ? j.fitScore : j.score)}`}>{tab === "bestfit" ? j.fitScore : j.score}</span>
            <span>
              <span className="title">{j.title}</span> — {j.company}{" "}
              {j.isNew && <span className="badge new">NEW</span>}
              {j.sponsorTab && j.sponsorship === "yes" && <span className="badge new">🛂 sponsorship confirmed</span>}
              {j.sponsorTab && j.sponsorship === "no" && <span className="badge">🛂 no sponsorship mentioned</span>}
              <div className="meta">
                {j.location} · {j.source} · posted {j.posted_date} {j.salary ? `· ${j.salary}` : ""}
              </div>
            </span>
            <span className="badge" style={{ marginLeft: "auto" }}>{j.status}</span>
          </div>
          {open === j.id && (
            <div className="detail">
              <div className="note">
                {tab === "bestfit" && j.fitWhy
                  ? `CV-based fit (${j.fitScore}/100): ${j.fitWhy}`
                  : (j.fit_note || "").replace("Why: ", "Why it fits: ").replace(" Missing: ", "\nWhat's missing: ")}
              </div>
              <div className="actions">
                <a href={j.url} target="_blank" rel="noreferrer"><button className="ghost">Open posting ↗</button></a>
                <button className="primary" onClick={() => generate(j, "cv")} disabled={busy === j.id + "cv"}>
                  {busy === j.id + "cv" ? "Writing CV…" : "Generate CV (.docx)"}
                </button>
                <button onClick={() => generate(j, "cover")} disabled={busy === j.id + "cover"}>
                  {busy === j.id + "cover" ? "Writing letter…" : "Cover letter (.docx)"}
                </button>
                <button onClick={() => generate(j, "latex")} disabled={busy === j.id + "latex"}>
                  {busy === j.id + "latex" ? "Writing LaTeX…" : "LaTeX CV (.tex)"}
                </button>
                <button onClick={() => findContacts(j)} disabled={busy === j.id + "con"}>
                  {busy === j.id + "con" ? "Searching…" : "Find contacts"}
                </button>
                <select value={j.status} onChange={(e) => setStatus(j.id, e.target.value)}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              {scorecards[j.id] && (
                <div className="detail">
                  <p><b>CV Match Scorecard</b> — Keyword/ATS: <b>{scorecards[j.id].keyword_pct}%</b> · Substantive: <b>{scorecards[j.id].substantive_pct}%</b></p>
                  {scorecards[j.id].pillars?.length > 0 && <p className="meta">Pillars: {scorecards[j.id].pillars.join(" · ")}</p>}
                  {scorecards[j.id].gaps?.length > 0 && <p className="meta">Gaps: {scorecards[j.id].gaps.join(" · ")}</p>}
                  {scorecards[j.id].probes?.length > 0 && <p className="meta">Interview probe-points: {scorecards[j.id].probes.join(" · ")}</p>}
                  {scorecards[j.id].action && <p className="meta"><b>One action:</b> {scorecards[j.id].action}</p>}
                </div>
              )}
              {contacts[j.id] && (
                <div className="detail">
                  {contacts[j.id].contacts.length === 0 && <p className="meta">No public contacts found — try the company's LinkedIn People tab.</p>}
                  {contacts[j.id].contacts.map((c, i) => (
                    <p key={i} style={{ marginBottom: 6 }}>
                      <b>{c.name}</b> — {c.title}{" "}
                      {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
                      <span className="meta"><br />{c.why} <i>({c.source})</i></span>
                    </p>
                  ))}
                  {contacts[j.id].email_pattern && <p className="meta">Email pattern: {contacts[j.id].email_pattern}</p>}
                  {contacts[j.id].outreach && (
                    <p style={{ marginTop: 8 }}>
                      <b>Outreach draft</b> <button className="ghost" onClick={() => navigator.clipboard.writeText(contacts[j.id].outreach)}>copy</button>
                      <span className="note" style={{ display: "block" }}>{contacts[j.id].outreach}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <footer>
        Profiles and statuses save in this browser. CVs are AI-tailored from the active profile — always read before sending. <a href="/setup">＋ add another profile</a>
      </footer>
    </div>
  );
}
