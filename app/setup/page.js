"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const F = ({ label, hint, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontWeight: 650, display: "block", marginBottom: 3 }}>{label}</label>
    {hint && <div className="meta" style={{ marginBottom: 4 }}>{hint}</div>}
    {children}
  </div>
);
const Section = ({ title, children }) => (
  <div className="job" style={{ marginBottom: 16 }}>
    <h3 style={{ marginBottom: 12 }}>{title}</h3>
    {children}
  </div>
);
const inp = { width: "100%", padding: "8px 10px", border: "1px solid #cfd8e3", borderRadius: 8, font: "inherit" };
const EMPTY = {
  name: "", location: "", phone: "", email: "", linkedin: "", headline: "",
  cvText: "", extra: "", queries: "", searchLocation: "", dreamCompanies: "",
  neverMention: "", education: "", sponsorshipNeeded: "unsure",
  fixedRoles: [{ title: "", company: "", dates: "" }, { title: "", company: "", dates: "" }, { title: "", company: "", dates: "" }],
};

function fromProfile(p) {
  const roles = (p.fixedRoles || []).map((r) => ({ title: r.title || "", company: r.company || "", dates: r.dates || "" }));
  while (roles.length < 3) roles.push({ title: "", company: "", dates: "" });
  return {
    name: p.contact?.name || "", location: p.contact?.location || "", phone: p.contact?.phone || "",
    email: p.contact?.email || "", linkedin: p.contact?.linkedin || "", headline: p.headline || "",
    cvText: p.raw?.cvText || "", extra: p.raw?.extra || "",
    queries: (p.queries || []).join("\n"), searchLocation: p.location || "",
    dreamCompanies: (p.dreamCompanies || []).join("\n"), neverMention: p.raw?.neverMention || "",
    education: (p.education || []).map((e) => `${e.text} | ${e.dates}`).join("\n"),
    sponsorshipNeeded: p.sponsorshipNeeded || "unsure", fixedRoles: roles,
  };
}

function SetupInner() {
  const editId = useSearchParams().get("edit");
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  useEffect(() => {
    if (!editId) return;
    const profiles = JSON.parse(localStorage.getItem("jp_profiles") || "{}");
    if (profiles[editId]) setF(fromProfile(profiles[editId]));
  }, [editId]);

  const pw = () => {
    let p = localStorage.getItem("pw") || "";
    if (!p) { p = prompt("Dashboard password:") || ""; localStorage.setItem("pw", p); }
    return p;
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/parse-cv", { method: "POST", headers: { "x-pass": pw() }, body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `server error ${r.status}`);
      setF((prev) => ({ ...prev, cvText: d.text }));
      setUploadMsg(`Extracted ${d.chars.toLocaleString()} characters from "${file.name}" — review it below and edit anything that got garbled before continuing.`);
    } catch (err) {
      setUploadMsg(`Upload failed: ${err.message}`);
    }
    setUploading(false);
    e.target.value = "";
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setRole = (i, k) => (e) => {
    const fixedRoles = f.fixedRoles.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r));
    setF({ ...f, fixedRoles });
  };

  const save = async () => {
    if (!f.name || !f.cvText) { setMsg("Name and CV text are required."); return; }
    if (!f.searchLocation && !f.location) { setMsg("A location is required (fill 'Location' or 'Job search location') so job scans know where to search."); return; }
    setBusy(true); setMsg("Building your master profile…");
    try {
      const education = f.education.split("\n").filter(Boolean).map((line) => {
        const m = line.match(/^(.*?)\s*[|;]\s*(.+)$/);
        return m ? { text: m[1].trim(), dates: m[2].trim() } : { text: line.trim(), dates: "" };
      });
      const body = { ...f, education, fixedRoles: f.fixedRoles.filter((r) => r.title) };
      const r = await fetch("/api/profile-build", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pass": pw() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `server error ${r.status}`);
      const built = await r.json();
      const id = editId || (f.name.toLowerCase().replace(/\W+/g, "-") + "-" + Date.now().toString(36).slice(-4));
      const profile = {
        id, label: f.name,
        contact: { name: f.name, location: f.location, phone: f.phone, email: f.email, linkedin: f.linkedin.replace(/^https?:\/\//, "") },
        headline: f.headline || built.headline || "",
        text: built.text,
        raw: { cvText: f.cvText, extra: f.extra, neverMention: f.neverMention },
        fixedRoles: f.fixedRoles.filter((r) => r.title),
        education,
        // Guaranteed non-empty: typed queries, else AI suggestions, else the
        // fixed role titles, else the headline itself — a profile must
        // never save with zero searchable queries.
        queries: [
          f.queries.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
          (built.queries || []).filter(Boolean),
          f.fixedRoles.map((r) => r.title).filter(Boolean),
          [f.headline || built.headline].filter(Boolean),
        ].find((arr) => arr.length > 0) || [],
        location: f.searchLocation || f.location,
        dreamCompanies: f.dreamCompanies.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        sponsorshipNeeded: f.sponsorshipNeeded,
      };
      const profiles = JSON.parse(localStorage.getItem("jp_profiles") || "{}");
      profiles[id] = profile;
      localStorage.setItem("jp_profiles", JSON.stringify(profiles));
      localStorage.setItem("jp_active", id);
      window.location.href = "/";
    } catch (e) {
      setMsg(`Failed: ${e.message}`);
      if (String(e.message).includes("401")) localStorage.removeItem("pw");
    }
    setBusy(false);
  };

  const remove = () => {
    if (!editId) return;
    if (!confirm(`Delete the profile "${f.name}"? This also removes its saved jobs. This can't be undone.`)) return;
    const profiles = JSON.parse(localStorage.getItem("jp_profiles") || "{}");
    delete profiles[editId];
    localStorage.setItem("jp_profiles", JSON.stringify(profiles));
    localStorage.removeItem(`jp_jobs_${editId}`);
    const remaining = Object.keys(profiles);
    if (remaining.length) localStorage.setItem("jp_active", remaining[0]);
    else localStorage.removeItem("jp_active");
    window.location.href = remaining.length ? "/" : "/setup";
  };

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 18 }}>
        <h1>{editId ? `Edit profile — ${f.name || "…"}` : "Set up a new profile"}</h1>
        <p>
          {editId
            ? "Update anything below — re-upload a CV, adjust roles, tune search settings. Saving rebuilds the master profile."
            : "Upload a CV, answer a few questions — everything else (job scans, tailored CVs, cover letters, contacts) configures itself."}{" "}
          <a href="/">← back to dashboard</a>
        </p>
      </header>

      <Section title="Contact details">
        <F label="Full name *"><input style={inp} value={f.name} onChange={set("name")} placeholder="e.g. Utkarsh Rawat" /></F>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <F label="Location"><input style={inp} value={f.location} onChange={set("location")} placeholder="London, United Kingdom" /></F>
          <F label="Phone"><input style={inp} value={f.phone} onChange={set("phone")} placeholder="+44 …" /></F>
          <F label="Email"><input style={inp} value={f.email} onChange={set("email")} placeholder="you@email.com" /></F>
          <F label="LinkedIn"><input style={inp} value={f.linkedin} onChange={set("linkedin")} placeholder="linkedin.com/in/you" /></F>
        </div>
      </Section>

      <Section title="CV & background">
        <F label={editId ? "Replace CV (optional)" : "Upload your CV (recommended)"} hint="PDF, DOCX, or TXT — parses the real file instead of relying on manual copy-paste, so nothing gets missed or garbled.">
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleUpload} disabled={uploading} />
          {uploading && <div className="meta" style={{ marginTop: 4 }}>Parsing…</div>}
          {uploadMsg && <div className="meta" style={{ marginTop: 4, color: uploadMsg.startsWith("Upload failed") ? "#b00020" : "#0a7a3d" }}>{uploadMsg}</div>}
        </F>
        <F label="CV text *" hint="Auto-filled after upload — check it over (or paste/edit manually here).">
          <textarea style={{ ...inp, height: 180 }} value={f.cvText} onChange={set("cvText")} />
        </F>
        <F label="Extra context" hint="Anything the CV doesn't say: confirmed achievements, tools you've really used, preferences, career story. More detail = better CVs.">
          <textarea style={{ ...inp, height: 110 }} value={f.extra} onChange={set("extra")} />
        </F>
      </Section>

      <Section title="Official job titles + dates">
        <F label="Locked roles (recommended)" hint="These get locked exactly as typed — CVs will never alter them (background checks verify titles). Leave blank to let the AI use the CV's roles.">
          {f.fixedRoles.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.4fr", gap: 8, marginBottom: 6 }}>
              <input style={inp} placeholder={`Role ${i + 1} official title`} value={r.title} onChange={setRole(i, "title")} />
              <input style={inp} placeholder="Company" value={r.company} onChange={setRole(i, "company")} />
              <input style={inp} placeholder="Jan 2024 – Present" value={r.dates} onChange={setRole(i, "dates")} />
            </div>
          ))}
        </F>
        <F label="Education" hint="One per line: text | dates — e.g. **MSc International Business**, University of Sussex — Merit | 2023 – 2024">
          <textarea style={{ ...inp, height: 60 }} value={f.education} onChange={set("education")} />
        </F>
      </Section>

      <Section title="Job search settings">
        <F label="Job search location"><input style={inp} value={f.searchLocation} onChange={set("searchLocation")} placeholder="London, United Kingdom" /></F>
        <F label="Target role searches" hint="One per line or comma-separated; blank = AI suggests from CV. Room for 20+ at a glance.">
          <textarea style={{ ...inp, height: 220, fontFamily: "inherit" }} value={f.queries} onChange={set("queries")}
            placeholder={"product manager\nbusiness analyst\ndata analyst\n..."} />
        </F>
        <F label="Dream companies" hint="One per line or comma-separated — powers the ⭐ Dream tab (optional). Room for 20+ at a glance.">
          <textarea style={{ ...inp, height: 220, fontFamily: "inherit" }} value={f.dreamCompanies} onChange={set("dreamCompanies")}
            placeholder={"Google\nMicrosoft\nStripe\n..."} />
        </F>
        <F label="Do you need visa sponsorship?" hint="Powers the 🛂 Sponsorship tab — searches are boosted with sponsorship-related terms and postings are flagged by detected language.">
          <select style={inp} value={f.sponsorshipNeeded} onChange={set("sponsorshipNeeded")}>
            <option value="yes">Yes — I need visa sponsorship</option>
            <option value="no">No — I already have the right to work</option>
            <option value="unsure">Show me both — let me filter</option>
          </select>
        </F>
      </Section>

      <Section title="CV writing rules">
        <F label="Never mention on CVs" hint="e.g. a stopgap job, visa status, anything private"><input style={inp} value={f.neverMention} onChange={set("neverMention")} /></F>
        <F label="One-line headline" hint="Used in outreach messages; blank = AI suggests"><input style={inp} value={f.headline} onChange={set("headline")} placeholder="a fintech product professional, London" /></F>
      </Section>

      <div className="actions">
        <button className="primary" onClick={save} disabled={busy} style={{ padding: "12px 22px", fontSize: 15 }}>
          {busy ? "Building profile…" : editId ? "Save changes" : "Build profile & open dashboard"}
        </button>
        {editId && (
          <button onClick={remove} disabled={busy} style={{ padding: "12px 22px", fontSize: 15, background: "#fde8e8", color: "#b00020" }}>
            Delete this profile
          </button>
        )}
      </div>
      {msg && <p className="msg" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}

export default function Setup() {
  return (
    <Suspense fallback={<div className="wrap"><p>Loading…</p></div>}>
      <SetupInner />
    </Suspense>
  );
}
