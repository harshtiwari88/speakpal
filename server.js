import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY is not set. Exiting.");
  process.exit(1);
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── 1. Speech-to-Text ────────────────────────────────────────────────────────
// POST /api/transcribe   multipart: audio file (webm/wav/mp4/m4a)
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio file" });

  try {
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname || "audio.webm",
      contentType: req.file.mimetype || "audio/webm",
    });
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "json");
    form.append("language", "en");

    const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, ...form.getHeaders() },
      body: form,
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data?.error?.message || "Groq STT error" });
    res.json({ text: data.text || "" });
  } catch (err) {
    console.error("STT error:", err);
    res.status(500).json({ error: "Transcription failed" });
  }
});

// ── 2. LLM Chat ──────────────────────────────────────────────────────────────
// POST /api/chat   json: { messages, userName, level, preferences }
app.post("/api/chat", async (req, res) => {
  const { messages = [], userName = "there", level = "intermediate", preferences = {} } = req.body;

  const systemPrompt = `You are SpeakPal, a friendly English conversation coach.
You are speaking with ${userName}, an ${level}-level English learner.
${preferences.topics ? `They enjoy topics like: ${preferences.topics}.` : ""}
${preferences.corrections === false ? "Only correct major errors." : "Gently correct grammar/pronunciation mistakes."}

Guidelines:
- Keep replies concise (2-4 sentences) — they will be spoken aloud.
- After EACH reply, add a JSON block at the very end (after your spoken text) wrapped in <correction></correction> tags.
- Inside that JSON: { "correctedTranscript": "<user's sentence corrected if needed, or null>", "explanation": "<brief tip if corrected, or null>", "encouragement": "<one short encouraging phrase>" }
- Address ${userName} by name occasionally but not every message.
- Be warm, patient, and enthusiastic.
- Never break character. Never mention you are an AI model by name.`;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: 0.75,
        max_tokens: 300,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data?.error?.message || "Groq LLM error" });

    const raw = data.choices?.[0]?.message?.content || "";

    // Split spoken text from correction JSON
    const corrMatch = raw.match(/<correction>([\s\S]*?)<\/correction>/);
    let correction = null;
    let spokenText = raw.replace(/<correction>[\s\S]*?<\/correction>/g, "").trim();

    if (corrMatch) {
      try { correction = JSON.parse(corrMatch[1].trim()); } catch {}
    }

    res.json({ spokenText, correction, raw });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// ── 3. Text-to-Speech ────────────────────────────────────────────────────────
// POST /api/speak   json: { text, voice? }
app.post("/api/speak", async (req, res) => {
  const { text, voice = "autumn" } = req.body;
  if (!text) return res.status(400).json({ error: "No text" });

  // Orpheus has a 200-char limit per call; chunk if needed
  const chunks = chunkText(text, 200);

  try {
    const audioBuffers = await Promise.all(
      chunks.map((chunk) =>
        fetch("https://api.groq.com/openai/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "canopylabs/orpheus-v1-english",
            input: chunk,
            voice,
            response_format: "wav",
          }),
        }).then((r) => {
          if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
          return r.arrayBuffer();
        })
      )
    );

    // Concatenate WAV buffers (strip headers on all but first)
    const combined = concatWavBuffers(audioBuffers.map((b) => Buffer.from(b)));
    res.set("Content-Type", "audio/wav");
    res.send(combined);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "Speech synthesis failed" });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  // Try to split on sentence boundary
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function concatWavBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  // Each WAV: 44-byte header + PCM data
  const headerSize = 44;
  const datas = buffers.map((b) => b.slice(headerSize));
  const totalData = datas.reduce((acc, d) => acc + d.length, 0);

  // Copy first header, update sizes
  const out = Buffer.alloc(headerSize + totalData);
  buffers[0].copy(out, 0, 0, headerSize);
  out.writeUInt32LE(totalData + 36, 4);  // ChunkSize
  out.writeUInt32LE(totalData, 40);       // Subchunk2Size

  let offset = headerSize;
  for (const d of datas) {
    d.copy(out, offset);
    offset += d.length;
  }
  return out;
}

app.listen(PORT, () => console.log(`SpeakPal backend running on :${PORT}`));
