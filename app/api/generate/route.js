import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun,
} from "docx";
import { ai } from "../../../lib/ai";

export const maxDuration = 60;

/* ---------- structure enforcement + one-page fit ---------- */

function enforce(c, p) {
  c.roles = (c.roles || []).filter((r) => (r.bullets || []).length);
  const fixed = (p.fixedRoles || []).filter((r) => r.title);
  if (fixed.length) {
    c.roles = c.roles.slice(0, fixed.length);
    while (c.roles.length < fixed.length) c.roles.push({ descriptor: "", bullets: [] });
    c.roles = c.roles.map((r, i) => ({
      ...fixed[i],
      descriptor: (r.descriptor || "").replace(/^[-–—\s]+/, ""),
      bullets: (r.bullets || []).filter(Boolean),
    }));
  } else {
    c.roles = c.roles.slice(0, 4).map((r) => ({
      title: r.title || "", company: r.company || "", dates: r.dates || "",
      descriptor: (r.descriptor || "").replace(/^[-–—\s]+/, ""),
      bullets: (r.bullets || []).filter(Boolean),
    }));
  }
  c.skills = (c.skills || []).slice(0, 5);
  return c;
}

function fitOnePage(c, p) {
  const L = (t) => Math.max(1, Math.ceil(String(t || "").replace(/\*\*/g, "").length / 118));
  const est = () =>
    2 + 8 + L(c.summary) +
    c.roles.reduce((s, r) => s + 2 + r.bullets.reduce((x, b) => x + L(b), 0), 0) +
    (p.education || []).length +
    c.skills.reduce((s, g) => s + L(g.label + ": " + g.items), 0);
  let guard = 40;
  while (est() > 64 && guard-- > 0) {
    let fattest = -1;
    for (let i = 0; i < c.roles.length; i++)
      if (c.roles[i].bullets.length > 2 && (fattest === -1 || c.roles[i].bullets.length >= c.roles[fattest].bullets.length)) fattest = i;
    if (fattest !== -1) c.roles[fattest].bullets.pop();
    else break;
  }
  return c;
}

/* ---------- LaTeX renderer ---------- */

const esc = (s) =>
  String(s || "")
    .replace(/\\/g, "")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}");

function texDoc(c, p) {
  const ct = p.contact;
  const roleBlocks = c.roles
    .map((r) => {
      const t = r.descriptor ? `${esc(r.title)} -- ${esc(r.descriptor)}` : esc(r.title);
      return `\\role{${t}}{${esc(r.company)}}{${esc(r.dates)}}
\\begin{itemize}
${r.bullets.map((b) => `  \\item ${esc(b)}`).join("\n")}
\\end{itemize}
`;
    })
    .join("\n");
  const edu = (p.education || [])
    .map((e, i) => `${esc(e.text)} \\hfill \\textbf{${esc(e.dates)}}${i < p.education.length - 1 ? "\\\\" : ""}`)
    .join("\n");
  const skills = c.skills
    .map((g, i) => `\\textbf{${esc(g.label)}:} ${esc(g.items)}${i < c.skills.length - 1 ? "\\\\[2pt]" : ""}`)
    .join("\n");
  return `\\documentclass[9.5pt,a4paper]{article}

\\usepackage[top=0.7cm,bottom=0.7cm,left=0.95cm,right=0.95cm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}

\\definecolor{linkedincol}{RGB}{10,102,194}
\\newcommand{\\iphone}{\\raisebox{-0.5pt}{\\Mobilefone}\\,}
\\newcommand{\\iemail}{\\raisebox{-0.5pt}{\\Letter}\\,}
\\newcommand{\\ilinkedin}{\\raisebox{-1pt}{\\colorbox{linkedincol}{\\textcolor{white}{\\fontsize{6}{6}\\selectfont\\bfseries in}}}\\,}

\\titleformat{\\section}{\\normalsize\\bfseries}{}{0em}{\\MakeUppercase}[\\vspace{-7pt}\\rule{\\textwidth}{0.4pt}]
\\titlespacing*{\\section}{0pt}{3pt}{1pt}

\\setlist[itemize]{leftmargin=1.05em, itemsep=1.5pt, topsep=2pt, parsep=0pt, label=\\textbullet}
\\setlength{\\parindent}{0pt}
\\pagestyle{empty}

\\newcommand{\\role}[3]{%
  \\vspace{4pt}%
  {\\textbf{#1} \\hfill \\textbf{#3}}\\par
  {\\textbf{#2}}\\par\\vspace{0.5pt}}

\\linespread{0.94}
\\begin{document}

\\begin{center}
  {\\LARGE\\bfseries ${esc(ct.name)}}\\\\[2pt]
  ${esc(ct.location)} \\,\\textbar\\, \\iphone ${esc(ct.phone)} \\,\\textbar\\, \\iemail\\href{mailto:${ct.email}}{${esc(ct.email)}} \\,\\textbar\\, \\ilinkedin\\href{https://${ct.linkedin}}{${esc(ct.linkedin)}}
\\end{center}
\\vspace{-5pt}

\\section{Professional Summary}
${esc(c.summary)}

\\section{Experience}

${roleBlocks}
\\section{Education}
${edu}

\\section{Skills}
${skills}
\\end{document}
`;
}

/* ---------- Word renderer ---------- */

const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: 10700 }];
const runs = (t, base = {}) =>
  String(t || "").split(/\*\*/).map((part, i) => new TextRun({ text: part, ...base, bold: base.bold || i % 2 === 1 }));

function docxKids(c, p) {
  const ct = p.contact;
  const section = (t) =>
    new Paragraph({
      spacing: { before: 90, after: 30 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: "000000" } },
      children: [new TextRun({ text: t.toUpperCase(), bold: true })],
    });
  const kids = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 20, line: 240 }, children: [new TextRun({ text: ct.name, bold: true, size: 30 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40, line: 240 }, children: [new TextRun(`${ct.location}  |  ${ct.phone}  |  ${ct.email}  |  ${ct.linkedin}`)] }),
    section("Professional Summary"),
    new Paragraph({ spacing: { after: 30 }, children: runs(c.summary) }),
    section("Experience"),
  ];
  for (const r of c.roles) {
    const t = r.descriptor ? `${r.title} – ${r.descriptor}` : r.title;
    kids.push(
      new Paragraph({ tabStops: RIGHT_TAB, spacing: { before: 70 }, children: [new TextRun({ text: t, bold: true }), new TextRun({ text: `\t${r.dates}`, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: r.company, bold: true })] })
    );
    for (const b of r.bullets)
      kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 25 }, children: runs(b) }));
  }
  kids.push(section("Education"));
  for (const e of p.education || [])
    kids.push(new Paragraph({ tabStops: RIGHT_TAB, children: [...runs(e.text), new TextRun({ text: `\t${e.dates}`, bold: true })] }));
  kids.push(section("Skills"));
  for (const g of c.skills)
    kids.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: `${g.label}: `, bold: true }), ...runs(g.items)] }));
  return kids;
}

function coverDoc(c, job, p) {
  const P = (t, o = {}) => new Paragraph({ children: [new TextRun({ text: t, bold: o.bold, size: o.size })] });
  const ct = p.contact;
  const kids = [
    P(ct.name, { bold: true, size: 28 }),
    P(`${ct.location} | ${ct.phone} | ${ct.email} | ${ct.linkedin}`), P(""),
    P(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })), P(""),
    P(`Re: ${job.title} — ${job.company}`, { bold: true }), P(""),
    P(c.greeting), P(""),
  ];
  c.paragraphs.forEach((par) => kids.push(P(par), P("")));
  kids.push(P(c.closing), P(ct.name, { bold: true }));
  return kids;
}

/* ---------- prompts ---------- */

const CV_PROMPT = (p, jd) => {
  const fixed = (p.fixedRoles || []).filter((r) => r.title);
  const roleRules = fixed.length
    ? `ROLES — use EXACTLY these, in this order, titles/companies/dates verbatim (add a JD-flavoured descriptor after a dash on role 1 only): ${fixed.map((r, i) => `${i + 1}. "${r.title}", ${r.company}, ${r.dates}`).join(" ")}. Bullet counts: role 1: 5-7, role 2: 4-5, role 3: 3 (total 12-15).`
    : `ROLES — pick the 3-4 most relevant roles from the profile (official titles/dates verbatim, most recent first). 12-15 bullets total, most for the most JD-relevant role.`;
  return `${p.text}\n\n${jd}\n\nBuild this candidate's tailored one-page CV for this JD, following ALL guardrails and style rules in the profile. Extract the JD's pillars and recurring phrases; anchor each JD line to the most credible role; use JD vocabulary where truthful; never invent anything not in the profile.
${roleRules}
Bullets 18-30 words. Wrap 3-5 key phrases/metrics in ** ** for bold. Skills: EXACTLY 5 groups, labels renamed to the JD's pillars, items as one comma-separated string per group.
ALSO produce the mandatory CV Match Scorecard: keyword/ATS %, substantive % (only what's defensible from the profile — never higher than keyword %), pillar mapping, gaps (every essential/desirable NOT covered and why), 2-4 interview probe-points (include the profile's standing risks), single highest-value action.
Respond with ONLY JSON:
{"summary":"3-5 lines","roles":[{"title":"","company":"","dates":"","descriptor":"","bullets":["..."]}],"skills":[{"label":"","items":"comma-separated string"}],"scorecard":{"keyword_pct":0,"substantive_pct":0,"pillars":[""],"gaps":[""],"probes":[""],"action":""}}`;
};

/* ---------- route ---------- */

const b64 = (buf) => Buffer.from(buf).toString("base64");

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

  const { job, type, profile: p } = await req.json();
  if (!p?.text || !p?.contact?.name)
    return Response.json({ error: "No profile — create one on the Setup page first" }, { status: 400 });

  const jd = `JOB DESCRIPTION: ${job.title} at ${job.company} (${job.location}). ${job.salary ? "Salary: " + job.salary + "." : ""}\nFit notes: ${job.fit_note || "n/a"}\nFull description: ${job.description || "not available — infer typical requirements for this title conservatively"}`;
  const who = p.contact.name.replace(/\W+/g, "_");
  const slug = (job.company || "role").replace(/\W+/g, "_");

  if (type === "cover") {
    const content = await ai(`${p.text}\n\n${jd}\n\nWrite this candidate's cover letter for this job: ~150 words, SINGLE paragraph body, mirrors the JD's strongest phrases, leads with the most relevant role, truthful only per the profile guardrails. Use the real company name (${job.company}).\nRespond with ONLY JSON: {"greeting":"Dear Hiring Manager,","paragraphs":["one ~150-word paragraph"],"closing":"Yours sincerely,"}`);
    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
      sections: [{ children: coverDoc(content, job, p) }],
    });
    return Response.json({
      filename: `${who}_Cover_Letter_${slug}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: b64(await Packer.toBuffer(doc)),
    });
  }

  const content = fitOnePage(enforce(await ai(CV_PROMPT(p, jd)), p), p);

  if (type === "latex") {
    return Response.json({
      filename: `${who}_CV_${slug}.tex`,
      mime: "application/x-tex",
      data: b64(Buffer.from(texDoc(content, p), "utf-8")),
      scorecard: content.scorecard || null,
    });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 19 }, paragraph: { spacing: { line: 240 } } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 397, bottom: 397, left: 539, right: 539 },
          },
        },
        children: docxKids(content, p),
      },
    ],
  });
  return Response.json({
    filename: `${who}_CV_${slug}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    data: b64(await Packer.toBuffer(doc)),
    scorecard: content.scorecard || null,
  });
}
