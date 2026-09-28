// AI BABY — Cloudflare Worker
//
//   GET  /health  -> { ok, mock, model }
//   POST /chat    -> { id, text, speak: { token, exp }, mock, remainingToday }
//        body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }  (last = user)
//   POST /speak   -> audio bytes (audio/wav in mock, audio/mpeg live)
//        body: { text, exp, token }  — token comes from /chat; only text the
//        bot actually said can be voiced, so /speak can't be used as free TTS.
//
// Errors: { error: { code, message, retryAfter? } } with a matching HTTP status.

import { checkLimits } from './ratelimit.js';
import { PERSONA } from './persona.js';
import { mockReply, mockActions, mockWav } from './mock.js';
import { TOOLS, toolCallsToActions, validateAction } from './tools.js';

const SPEAK_TTL_SEC = 300;
const MAX_BODY_BYTES = 16 * 1024;
const DEV_SPEAK_SECRET = 'dev-only-not-a-secret';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return cors ? new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } })
                  : new Response(null, { status: 403 });
    }

    if (!originAllowed(env, origin)) return err(null, 403, 'origin', 'Origin not allowed');

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json(cors, 200, { ok: true, mock: isMock(env), model: env.LLM_MODEL });
      }
      if (url.pathname === '/chat') {
        if (request.method !== 'POST') return err(cors, 405, 'method', 'POST only');
        return await handleChat(request, env, cors);
      }
      if (url.pathname === '/speak') {
        if (request.method !== 'POST') return err(cors, 405, 'method', 'POST only');
        return await handleSpeak(request, env, cors);
      }
      return err(cors, 404, 'not_found', 'No such frequency');
    } catch (e) {
      console.error('unhandled', e && e.stack || e);
      return err(cors, 500, 'internal', 'Signal lost');
    }
  },
};

// ── /chat ───────────────────────────────────────────────────────────────────
async function handleChat(request, env, cors) {
  const body = await readJson(request);
  if (!body.ok) return err(cors, body.status, 'bad_request', body.message);

  const maxIn = Number(env.MAX_INPUT_CHARS || 500);
  const maxHist = Number(env.MAX_HISTORY || 10);
  const msgs = Array.isArray(body.data.messages) ? body.data.messages : null;
  if (!msgs || !msgs.length) return err(cors, 400, 'bad_request', 'messages[] required');

  const history = msgs.slice(-maxHist).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, maxIn),
  }));
  const last = history[history.length - 1];
  if (last.role !== 'user' || !last.content.trim()) return err(cors, 400, 'bad_request', 'Last message must be non-empty user text');

  const lim = await checkLimits(env, clientIp(request), 'chat');
  if (!lim.ok) return err(cors, 429, lim.reason, 'Signal saturated', lim.retryAfter);

  let text, actions;
  if (isMock(env)) {
    await sleep(350 + Math.random() * 500); // feel the latency in the UI
    actions = mockActions(last.content); // already validated shapes, but re-validate anyway below for one code path
    text = mockReply(last.content, actions);
  } else {
    const llmResult = await callLLM(env, history);
    text = llmResult.text;
    actions = llmResult.actions;
  }
  actions = actions.map((a) => validateAction(a)).filter(Boolean);
  text = cleanForSpeech(text).slice(0, Number(env.MAX_SPEAK_CHARS || 600));
  if (!text) text = 'Static. Only static.';

  const exp = Math.floor(Date.now() / 1000) + SPEAK_TTL_SEC;
  const token = await sign(speakSecret(env), `${exp}.${text}`);

  return json(cors, 200, {
    id: crypto.randomUUID(),
    text,
    actions,
    speak: { token, exp },
    mock: isMock(env),
    remainingToday: lim.remainingToday,
  });
}

// ── /speak ──────────────────────────────────────────────────────────────────
async function handleSpeak(request, env, cors) {
  const body = await readJson(request);
  if (!body.ok) return err(cors, body.status, 'bad_request', body.message);
  const { text, exp, token } = body.data || {};
  if (typeof text !== 'string' || typeof token !== 'string' || typeof exp !== 'number') {
    return err(cors, 400, 'bad_request', 'text, exp, token required');
  }
  if (exp < Math.floor(Date.now() / 1000)) return err(cors, 410, 'expired', 'Transmission expired');
  const expected = await sign(speakSecret(env), `${exp}.${text}`);
  if (!timingSafeEqual(expected, token)) return err(cors, 403, 'bad_token', 'Unsigned transmission');

  const lim = await checkLimits(env, clientIp(request), 'speak');
  if (!lim.ok) return err(cors, 429, lim.reason, 'Signal saturated', lim.retryAfter);

  if (isMock(env)) {
    return new Response(mockWav(text), { headers: { ...cors, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
  }
  const audio = await callTTS(env, text);
  return new Response(audio, { headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}

// ── Upstream placeholders (unused while MOCK_MODE="true") ───────────────────
// Written against the public API docs; untested until keys exist.
async function callLLM(env, history) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://3eascortex.com',
      'X-Title': 'AI BABY',
    },
    body: JSON.stringify({
      // OpenRouter tries these in order if the first is down/rate-limited.
      models: [env.LLM_MODEL, env.LLM_FALLBACK_MODEL].filter(Boolean),
      messages: [{ role: 'system', content: PERSONA }, ...history],
      max_tokens: Number(env.LLM_MAX_TOKENS || 220),
      temperature: 0.9,
      tools: TOOLS,
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  return {
    text: msg?.content || '',
    // toolCallsToActions already validates each call's shape against the
    // catalog — a hallucinated tool name or an out-of-catalog title/scene
    // is silently dropped there, not trusted through to the client.
    actions: toolCallsToActions(msg?.tool_calls),
  };
}

async function callTTS(env, text) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.TTS_MODEL || 'tts-1', voice: env.TTS_VOICE || 'shimmer', input: text, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`openai tts ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.arrayBuffer();
}

// ── helpers ─────────────────────────────────────────────────────────────────
function isMock(env) {
  return String(env.MOCK_MODE).toLowerCase() !== 'false';
}

function speakSecret(env) {
  if (env.SPEAK_SECRET) return env.SPEAK_SECRET;
  if (isMock(env)) return DEV_SPEAK_SECRET;
  throw new Error('SPEAK_SECRET not set');
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function originAllowed(env, origin) {
  if (!origin) return String(env.ALLOW_NO_ORIGIN).toLowerCase() === 'true';
  return allowedOrigins(env).includes(origin);
}

function corsHeaders(env, origin) {
  if (!origin || !allowedOrigins(env).includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) return { ok: false, status: 413, message: 'Body too large' };
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, message: 'Body too large' };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, message: 'Invalid JSON' };
  }
}

// Strip markdown/emoji so TTS doesn't read "asterisk asterisk".
function cleanForSpeech(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>~|]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(cors, status, data) {
  return new Response(JSON.stringify(data), { status, headers: { ...(cors || {}), 'Content-Type': 'application/json' } });
}

function err(cors, status, code, message, retryAfter) {
  const headers = { ...(cors || {}), 'Content-Type': 'application/json' };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify({ error: { code, message, ...(retryAfter ? { retryAfter } : {}) } }), { status, headers });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
