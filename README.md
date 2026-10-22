# 🎙 SpeakPal – AI English Conversation Coach

A mobile-first PWA for real-time spoken English practice.  
**100% free-tier stack — no credit card required.**

---

## Architecture

```
Browser (GitHub Pages PWA)
    │  mic → MediaRecorder / Web Speech API
    │  audio blob / user text
    ▼
Express Backend (Render free tier)
    ├── POST /api/transcribe  → Groq Whisper Large v3 Turbo (STT)
    ├── POST /api/chat        → Groq Llama 3.3 70B (LLM)
    └── POST /api/speak       → Groq Orpheus v1 English (TTS)
```

One **Groq API key** powers all three services.

---

## Free-Tier Limits (verified October 2026)

| Service | Model | Free Limit |
|---------|-------|------------|
| **STT** | `whisper-large-v3-turbo` | 2 000 req/day, 7 200 audio-seconds/hr |
| **LLM** | `llama-3.3-70b-versatile` | ~14 400 req/day (rate-capped) |
| **TTS** | `canopylabs/orpheus-v1-english` | 100 req/day (free tier) |
| **Backend** | Render free web service | 750 hrs/month (always-on for 1 app) |
| **Frontend** | GitHub Pages | Unlimited static hosting |

> ⚠ **Render free tier cold-starts** after 15 min of inactivity (~30 s delay on first request).  
> ⚠ Groq free tier has **no SLA** and rate limits reset daily.  
> ⚠ You must **accept Orpheus model terms** in the Groq Playground before TTS works.

---

## Project Structure

```
speakpal/
├── .github/workflows/deploy.yml   ← GitHub Actions → GitHub Pages
├── frontend/                      ← deployed to GitHub Pages
│   ├── index.html
│   ├── config.js                  ← set SPEAKPAL_BACKEND URL here
│   ├── manifest.json
│   ├── sw.js                      ← Service Worker
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                 ← main UI + call logic
│   │   ├── api.js                 ← backend API client
│   │   └── store.js               ← localStorage prefs
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── backend/
    ├── server.js                  ← Express proxy (Groq APIs)
    ├── package.json
    ├── .env.example               ← copy to .env, never commit .env
    └── .gitignore
```

---

## Setup: Step-by-Step

### 1. Get a free Groq API key

1. Go to <https://console.groq.com> → sign up (no credit card).
2. **API Keys** → **Create API Key** → copy it.
3. Go to <https://console.groq.com/playground?model=canopylabs/orpheus-v1-english> and **accept the model terms** (one click). Required for TTS.

---

### 2. Deploy the Backend on Render

#### a. Push code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create speakpal --public --push
# or: git remote add origin https://github.com/YOUR_USERNAME/speakpal && git push -u origin main
```

#### b. Create a Render Web Service

1. Go to <https://render.com> → **New → Web Service**
2. Connect your GitHub repo, select the **`speakpal`** repository.
3. Configure:
   | Field | Value |
   |-------|-------|
   | **Root directory** | `backend` |
   | **Runtime** | Node |
   | **Build command** | `npm install` |
   | **Start command** | `npm start` |
   | **Instance type** | Free |

4. Under **Environment Variables**, add:
   ```
   GROQ_API_KEY   = gsk_YOUR_KEY_HERE
   ALLOWED_ORIGIN = https://YOUR_USERNAME.github.io
   PORT           = 3000
   ```
5. Click **Deploy**. Note the URL, e.g. `https://speakpal-backend.onrender.com`.

---

### 3. Set the Backend URL in the Frontend

Edit `frontend/config.js`:

```js
window.SPEAKPAL_BACKEND = "https://speakpal-backend.onrender.com";
```

Commit and push:

```bash
git add frontend/config.js
git commit -m "Set backend URL"
git push
```

---

### 4. Deploy the Frontend to GitHub Pages

#### Enable GitHub Pages in the repo:

1. GitHub → repo → **Settings → Pages**
2. **Source**: `GitHub Actions`
3. The workflow in `.github/workflows/deploy.yml` will fire on every push to `main`.
4. Your app will be live at `https://YOUR_USERNAME.github.io/speakpal/`

---

### 5. Add to Android Home Screen

1. Open Chrome on Android → navigate to your GitHub Pages URL.
2. Tap the **⋮ menu → Add to Home screen**.
3. Accept — SpeakPal installs as a standalone app with no browser chrome.

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env          # fill in GROQ_API_KEY
npm install
npm run dev                   # hot-reload on :3000

# Frontend (separate terminal)
cd frontend
npx serve .                   # static server on :3000 or :5000
# OR open index.html directly in browser (some features need HTTPS for mic)
```

> For mic access locally, use `localhost` (Chrome grants mic on localhost without HTTPS).

---

## Environment Variables Reference

| Variable | Where | Description |
|----------|-------|-------------|
| `GROQ_API_KEY` | backend `.env` | Your Groq API key (never in frontend) |
| `ALLOWED_ORIGIN` | backend `.env` | CORS origin, e.g. your Pages URL |
| `PORT` | backend `.env` | Default `3000` |
| `window.SPEAKPAL_BACKEND` | `frontend/config.js` | Backend base URL |

---

## Features

- **Personalized onboarding** — saves name + level in `localStorage`
- **Personalized greeting** — AI addresses user by name at call start
- **Settings** — change name, level, topics, AI voice, correction toggle
- **Call controls** — Start, Mute, End
- **Live transcription** — real-time text as you speak
- **Grammar corrections** — inline corrected sentence + tip after each turn
- **Encouragement** — motivational phrase each turn
- **TTS** — AI responses spoken aloud via Groq Orpheus (6 voice options)
- **STT priority**: Web Speech API (zero latency, browser-native) → Groq Whisper fallback
- **PWA** — installable, offline shell, works like a native app

---

## Honest Disclosure

- **TTS (Orpheus) is 100 req/day on free tier.** A typical 10-minute session uses ~10–15 TTS calls, so ~6–8 sessions per day are covered.
- **Render free instances spin down** after 15 min idle. The first request after idle takes up to 30 s — the app shows "Thinking…" during this.
- **No real-time duplex audio** — this uses turn-based STT→LLM→TTS, not WebRTC or WebSocket streaming. Latency is typically 2–4 s per turn.
- The backend proxy keeps your Groq key secret from the browser. **Do not add `GROQ_API_KEY` to any frontend file.**

---

## Upgrading Beyond Free Tier

| Need | Upgrade |
|------|---------|
| More TTS calls | Groq paid ($0.05/1M chars) |
| Faster backend | Render Starter ($7/mo, no cold starts) |
| Real-time streaming | Groq streaming TTS (same endpoint, `stream: true`) |
| Better STT accuracy | Groq `whisper-large-v3` (same free tier) |
