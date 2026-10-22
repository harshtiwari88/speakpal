// ── Local Storage Store ────────────────────────────────────────────────────
const KEY = "speakpal_prefs";

const defaults = {
  userName: "",
  level: "intermediate",
  voice: "autumn",       // Orpheus voice
  corrections: true,
  topics: "",
  onboardDone: false,
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...data }));
  } catch {}
}

export function clear() {
  localStorage.removeItem(KEY);
}
