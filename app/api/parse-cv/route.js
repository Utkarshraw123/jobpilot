export const maxDuration = 30;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(req) {
  try {
    if (req.headers.get("x-pass") !== process.env.DASHBOARD_PASSWORD)
      return Response.json({ error: "401 wrong password" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    if (!file) return Response.json({ error: "No file received" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "File too large (max 8MB)" }, { status: 400 });

    const name = (file.name || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let text;

    if (name.endsWith(".docx")) {
      const mammoth = (await import("mammoth")).default;
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (name.endsWith(".pdf")) {
      const pdfParse = (await import("pdf-parse")).default;
      text = (await pdfParse(buf)).text;
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buf.toString("utf-8");
    } else if (name.endsWith(".doc")) {
      return Response.json({ error: "Old .doc format isn't supported — please save as .docx or .pdf and re-upload." }, { status: 400 });
    } else {
      return Response.json({ error: "Unsupported file type — upload a .pdf, .docx, or .txt" }, { status: 400 });
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 40)
      return Response.json({ error: "Barely any text was extracted — the file may be a scanned image. Try a different export or paste the text manually." }, { status: 400 });

    return Response.json({ text, chars: text.length });
  } catch (e) {
    return Response.json({ error: `Couldn't parse that file: ${e.message || e}` }, { status: 500 });
  }
}
