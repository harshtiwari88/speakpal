import * as Store from "./store.js";
import * as API from "./api.js";

// ── State ──────────────────────────────────────────────────────────────────
let prefs = Store.load();
let callActive = false;
let muted = false;
let mediaRecorder = null;
let audioChunks = [];
let silenceTimer = null;
let conversationHistory = [];  // [{ role, content }]
let currentAudio = null;       // HTMLAudioElement for TTS
let isAISpeaking = false;
let webSpeechFallback = false;
let recognition = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const screens = { onboard: $("screen-onboard"), app: $("screen-app"), settings: $("screen-settings") };

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  prefs = Store.load();
  if (prefs.onboardDone && prefs.userName) {
    showScreen("app");
    renderEmptyState();
  } else {
    showScreen("onboard");
  }
  bindOnboard();
  bindApp();
  bindSettings();
  registerSW();
});

// ── Onboarding ─────────────────────────────────────────────────────────────
function bindOnboard() {
  $("btn-onboard-start").addEventListener("click", () => {
    const name = $("input-name").value.trim();
    if (!name) { shake($("input-name")); return; }
    const level = $("input-level").value;
    prefs = Store.load();
    Store.save({ userName: name, level, onboardDone: true });
    prefs = Store.load();
    showScreen("app");
    renderEmptyState();
  });
  $("input-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-onboard-start").click();
  });
}

// ── App Screen ─────────────────────────────────────────────────────────────
function bindApp() {
  $("btn-start").addEventListener("click", startCall);
  $("btn-end").addEventListener("click", endCall);
  $("btn-mute").addEventListener("click", toggleMute);
  $("btn-open-settings").addEventListener("click", () => showScreen("settings"));
}

// ── Settings ───────────────────────────────────────────────────────────────
function bindSettings() {
  $("btn-back-settings").addEventListener("click", () => showScreen("app"));
  $("btn-save-settings").addEventListener("click", saveSettings);
  // Populate fields when opening settings
  $("btn-open-settings").addEventListener("click", populateSettings);
}

function populateSettings() {
  prefs = Store.load();
  $("set-name").value = prefs.userName || "";
  $("set-level").value = prefs.level || "intermediate";
  $("set-voice").value = prefs.voice || "autumn";
  $("set-corrections").checked = prefs.corrections !== false;
  $("set-topics").value = prefs.topics || "";
}

function saveSettings() {
  const name = $("set-name").value.trim();
  if (!name) { shake($("set-name")); return; }
  Store.save({
    userName: name,
    level: $("set-level").value,
    voice: $("set-voice").value,
    corrections: $("set-corrections").checked,
    topics: $("set-topics").value.trim(),
  });
  prefs = Store.load();
  toast("Settings saved ✓");
  showScreen("app");
}

// ── Call Flow ──────────────────────────────────────────────────────────────
async function startCall() {
  callActive = true;
  prefs = Store.load();
  conversationHistory = [];

  $("btn-start").style.display = "none";
  $("btn-end").style.display = "";
  $("btn-mute").style.display = "";

  clearFeed();
  setStatus("listening", "Listening…");
  setWave(true);

  // Personalized greeting via AI
  await triggerAIGreeting();

  if (!isAISpeaking) startListening();
}

function endCall() {
  callActive = false;
  stopRecording();
  stopAI();
  clearInterval(silenceTimer);
  if (recognition) recognition.abort();

  $("btn-start").style.display = "";
  $("btn-end").style.display = "none";
  $("btn-mute").style.display = "none";
  $("btn-mute").classList.remove("muted");
  muted = false;

  setStatus("idle", "Call ended. Tap 🎙 to start again.");
  setWave(false);
  $("live-transcript").textContent = "Say something…";
  $("live-transcript").classList.remove("active");
}

function toggleMute() {
  muted = !muted;
  $("btn-mute").classList.toggle("muted", muted);
  if (muted) {
    stopRecording();
    setStatus("idle", "Muted");
    setWave(false);
  } else {
    setStatus("listening", "Listening…");
    setWave(true);
    startListening();
  }
}

// ── AI Greeting ────────────────────────────────────────────────────────────
async function triggerAIGreeting() {
  const name = prefs.userName || "there";
  const levelMap = { beginner: "beginner", intermediate: "intermediate", advanced: "advanced" };
  const lvl = levelMap[prefs.level] || "intermediate";
  const greeting = `Hey ${name}! Ready to practice your English today? I'm your SpeakPal coach. What would you like to talk about?`;

  addBubble("ai", greeting);

  try {
    await playTTS(greeting);
  } catch {
    // TTS failed – continue text only
  }
}

// ── Recording & STT ────────────────────────────────────────────────────────
async function startListening() {
  if (!callActive || muted) return;

  // Try Web Speech API first (browser built-in, zero latency)
  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    startWebSpeech();
    return;
  }

  // Fallback to MediaRecorder → Groq Whisper
  await startMediaRecorder();
}

function startWebSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    $("live-transcript").textContent = transcript;
    $("live-transcript").classList.add("active");
  };

  recognition.onend = async () => {
    const text = $("live-transcript").textContent.trim();
    if (text && text !== "Say something…" && callActive && !muted) {
      await handleUserUtterance(text);
    } else if (callActive && !muted && !isAISpeaking) {
      startWebSpeech(); // restart
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== "aborted" && e.error !== "no-speech") {
      console.warn("SpeechRecognition error:", e.error, "– switching to Whisper");
      webSpeechFallback = true;
      startMediaRecorder();
    } else if (callActive && !muted && !isAISpeaking) {
      startWebSpeech();
    }
  };

  recognition.start();
  $("live-transcript").textContent = "Say something…";
  $("live-transcript").classList.remove("active");
}

async function startMediaRecorder() {
  if (!callActive || muted) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!audioChunks.length || !callActive) return;
      const blob = new Blob(audioChunks, { type: mimeType });
      await processAudioBlob(blob);
    };

    mediaRecorder.start();

    // Auto-stop after 8 s silence detection (simplified: fixed duration)
    silenceTimer = setTimeout(() => stopRecording(), 8000);
  } catch (err) {
    setStatus("error", "Microphone access denied");
    toast("⚠ Microphone access needed");
  }
}

function stopRecording() {
  clearTimeout(silenceTimer);
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

async function processAudioBlob(blob) {
  if (blob.size < 1000) {
    // Too short – likely silence
    if (callActive && !muted && !isAISpeaking) startListening();
    return;
  }
  setStatus("thinking", "Transcribing…");
  setWave(false);

  try {
    const text = await API.transcribe(blob);
    if (!text.trim()) {
      if (callActive && !muted && !isAISpeaking) startListening();
      return;
    }
    await handleUserUtterance(text);
  } catch (err) {
    setStatus("error", "Transcription error – try again");
    toast("⚠ " + err.message);
    setTimeout(() => { if (callActive && !muted) startListening(); }, 1500);
  }
}

// ── Turn Handler ───────────────────────────────────────────────────────────
async function handleUserUtterance(text) {
  $("live-transcript").textContent = "Say something…";
  $("live-transcript").classList.remove("active");

  addBubble("user", text);
  conversationHistory.push({ role: "user", content: text });

  setStatus("thinking", "Thinking…");
  setWave(false);

  try {
    const result = await API.chat(
      conversationHistory,
      prefs.userName,
      prefs.level,
      { topics: prefs.topics, corrections: prefs.corrections }
    );

    const { spokenText, correction } = result;
    conversationHistory.push({ role: "assistant", content: spokenText });

    // Keep history bounded (last 12 turns = 6 exchanges)
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

    addBubble("ai", spokenText);

    // Show correction if present
    if (correction && correction.correctedTranscript) {
      addBubble("correction", `✏ <strong>Correction:</strong> ${correction.correctedTranscript}${correction.explanation ? `<br><span style="opacity:.75">💡 ${correction.explanation}</span>` : ""}`);
    }
    if (correction?.encouragement) {
      addBubble("encouragement", correction.encouragement);
    }

    // Speak the response
    setStatus("speaking", "Speaking…");
    setWave(false);
    try {
      await playTTS(spokenText);
    } catch {
      // TTS failed – silent fallback
    }

    if (callActive && !muted) {
      setStatus("listening", "Listening…");
      setWave(true);
      startListening();
    }
  } catch (err) {
    setStatus("error", "Error – try again");
    toast("⚠ " + err.message);
    setTimeout(() => { if (callActive && !muted) startListening(); }, 1500);
  }
}

// ── TTS ────────────────────────────────────────────────────────────────────
async function playTTS(text) {
  isAISpeaking = true;
  stopAI();
  try {
    const url = await API.speak(text, prefs.voice || "autumn");
    await new Promise((resolve, reject) => {
      currentAudio = new Audio(url);
      currentAudio.onended = () => { isAISpeaking = false; resolve(); };
      currentAudio.onerror = () => { isAISpeaking = false; reject(new Error("Audio playback failed")); };
      currentAudio.play().catch(reject);
    });
  } finally {
    isAISpeaking = false;
  }
}

function stopAI() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  isAISpeaking = false;
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
function renderEmptyState() {
  const feed = $("transcript-feed");
  feed.innerHTML = `<div class="empty-state">
    <div class="icon">🎙</div>
    <p>Tap the mic button below<br>to start your English session</p>
  </div>`;
}

function clearFeed() {
  $("transcript-feed").innerHTML = "";
}

function addBubble(type, html) {
  const feed = $("transcript-feed");
  const div = document.createElement("div");
  div.className = `bubble ${type}`;
  div.innerHTML = html;
  feed.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

function setStatus(state, text) {
  const dot = document.querySelector(".dot");
  dot.className = `dot ${state}`;
  $("status-text").textContent = text;
}

function setWave(on) {
  document.querySelector(".waveform").classList.toggle("active", on);
}

function shake(el) {
  el.style.animation = "none";
  el.offsetHeight; // reflow
  el.style.animation = "shake .3s ease";
  setTimeout(() => (el.style.animation = ""), 400);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

// ── Service Worker ─────────────────────────────────────────────────────────
function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
}
