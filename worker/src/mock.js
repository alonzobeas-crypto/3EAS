// Mock responses for MOCK_MODE — lets the full pipe (text -> signed token ->
// audio -> Tone.js FX -> waveform) run end to end with zero API keys.

import { TRACK_TITLES, SCENES, LINKS } from './catalog.js';

const LINES = [
  'Carrier locked. I hear you through the static, {q}.',
  'Signal received on the east side of the river. Say it again, slower.',
  'This is a test transmission. The real me is still calibrating.',
  'Lincoln Heights, 3 a.m., the antenna is humming your question back at me.',
  'Mock signal. No brain wired yet. Only the echo of {q}.',
  'Estoy aquí, entre las frecuencias. Ask me when the keys are in.',
];

export function mockReply(userText, actions) {
  if (actions && actions.length) {
    const a = actions[0];
    if (a.type === 'play_track') return `Cueing "${a.title}." Hold the frequency.`;
    if (a.type === 'stop_music') return 'Signal cut. The room is quiet now.';
    if (a.type === 'go_to_scene') return `Pulling you to ${a.name}. Hang on.`;
    if (a.type === 'open_link') return 'Opening that channel now.';
  }
  const q = (userText || 'nothing').replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase();
  const line = LINES[Math.floor(Math.random() * LINES.length)];
  return line.replace('{q}', `"${q}"`);
}

// ── Keyword-based fake tool calls ────────────────────────────────────────────
// No LLM involved in mock mode, so there's nothing to "call" a tool — this
// just pattern-matches the user's raw text well enough to exercise the full
// action pipe (worker -> client whitelist -> real site function) with zero
// keys. Every action still goes through validateAction() in tools.js before
// it's ever returned, same as a real tool call would.
function findTrackMention(lower) {
  let best = null;
  for (const title of TRACK_TITLES) {
    if (lower.includes(title.toLowerCase())) {
      if (!best || title.length > best.length) best = title;
    }
  }
  return best;
}

function findSceneMention(lower) {
  for (const s of SCENES) {
    if (s.name !== 'HOME' && lower.includes(s.name.toLowerCase())) return s.name;
  }
  if (/\bhome\b/.test(lower)) return 'HOME';
  return null;
}

function findLinkMention(lower) {
  const aliases = {
    INSTAGRAM: ['instagram', 'ig'],
    MIXCLOUD: ['mixcloud'],
    SELEXIONES_COM: ['selexiones'],
    ONNOTICEMUSIC_COM: ['on/notice', 'onnotice', 'on notice'],
    SACREDLESSONS_COM: ['sacred lessons', 'sacredlessons'],
    WORLDOFMUSICSHOP_COM: ['world of music', 'worldofmusicshop', 'shop', 'merch'],
    DONATE: ['donate', 'ko-fi', 'kofi', 'support'],
  };
  for (const link of LINKS) {
    const names = aliases[link.key] || [];
    if (names.some((n) => lower.includes(n))) return link.key;
  }
  return null;
}

export function mockActions(userText) {
  const lower = (userText || '').toLowerCase();
  const actions = [];

  if (/\b(stop|pause|kill)\b.*\b(music|jukebox|song|track)\b/.test(lower)) {
    actions.push({ type: 'stop_music' });
    return actions; // stop wins outright — don't also try to play/navigate
  }
  if (/\bplay\b/.test(lower)) {
    const title = findTrackMention(lower);
    if (title) actions.push({ type: 'play_track', title });
  }
  if (/\b(go to|take me to|show me|open)\b/.test(lower) || findSceneMention(lower)) {
    const name = findSceneMention(lower);
    if (name) actions.push({ type: 'go_to_scene', name });
  }
  const linkKey = findLinkMention(lower);
  if (linkKey) actions.push({ type: 'open_link', key: linkKey });

  return actions;
}

// ── Synthetic robot-babble WAV ──────────────────────────────────────────────
// Glottal sawtooth -> two resonant bandpass "formants" per vowel, noise bursts
// for sibilants. Not speech — just voice-shaped enough to exercise the FX.

const SR = 22050;
const FORMANTS = { a: [800, 1200], e: [500, 2000], i: [320, 2600], o: [500, 900], u: [350, 800] };
const VOWELS = 'aeiou';

function bandpass(freq, q) {
  const w = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

export function mockWav(text) {
  const clean = (text || '').toLowerCase().replace(/[^a-z ]/g, '');
  const syllables = Math.max(4, Math.min(40, Math.round(clean.length / 3)));
  const sylLen = Math.floor(SR * 0.14);
  const total = syllables * sylLen + Math.floor(SR * 0.3);
  const out = new Float32Array(total);

  let phase = 0;
  for (let s = 0; s < syllables; s++) {
    const ch = clean[s * 3] || 'a';
    const vowel = VOWELS.includes(ch) ? ch : VOWELS[(ch.charCodeAt(0) || 97) % 5];
    const [f1, f2] = FORMANTS[vowel];
    const bp1 = bandpass(f1, 6), bp2 = bandpass(f2, 9);
    const f0 = 300 + 90 * Math.sin(s * 0.9) + (s % 5 === 4 ? 120 : 0); // young, sing-song contour
    const sibilant = /[sfzcx]/.test(ch);
    const start = s * sylLen;
    for (let i = 0; i < sylLen; i++) {
      const t = i / sylLen;
      const env = Math.min(1, t * 12) * Math.min(1, (1 - t) * 5); // quick attack, short release
      phase += f0 / SR;
      const saw = 2 * (phase - Math.floor(phase)) - 1;
      let v = bp1(saw) * 1.0 + bp2(saw) * 0.6;
      if (sibilant && t < 0.3) v += (Math.random() * 2 - 1) * 0.35 * (1 - t / 0.3);
      out[start + i] = v * env * 0.9;
    }
  }

  // normalise
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.85 / peak : 1;

  const buf = new ArrayBuffer(44 + total * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + total * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, total * 2, true);
  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, out[i] * g));
    dv.setInt16(44 + i * 2, v * 0x7fff, true);
  }
  return buf;
}
