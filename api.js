// ── Backend API Client ─────────────────────────────────────────────────────
// Base URL is injected at build time via config.js or auto-detected.
// In production, set window.SPEAKPAL_BACKEND in config.js.
// In local dev, it defaults to http://localhost:3000.

function baseUrl() {
  return (window.SPEAKPAL_BACKEND || "http://localhost:3000").replace(/\/$/, "");
}

export async function transcribe(audioBlob) {
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  const res = await fetch(`${baseUrl()}/api/transcribe`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `STT failed (${res.status})`);
  }
  return (await res.json()).text;
}

export async function chat(messages, userName, level, preferences) {
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, userName, level, preferences }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat failed (${res.status})`);
  }
  return await res.json(); // { spokenText, correction, raw }
}

export async function speak(text, voice = "autumn") {
  const res = await fetch(`${baseUrl()}/api/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw new Error(`TTS failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
