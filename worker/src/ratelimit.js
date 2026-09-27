// Rate limiting — three layers, cheapest first.
//
// 1. Burst per IP  — Workers Rate Limiting binding (RL_CHAT / RL_SPEAK in
//    wrangler.toml). Real, edge-enforced. Falls back to an in-isolate window
//    if the binding is missing (e.g. an older local wrangler).
// 2. Daily per IP  — STUB: in-isolate counter. Best-effort only: each
//    Cloudflare isolate keeps its own Map and it resets when the isolate is
//    recycled, so a determined scraper hitting many edges can exceed it.
// 3. Daily global  — STUB: same caveat.
//
// Real upgrade path for 2+3 (needs sign-off — adds a Durable Object):
// one SQLite-backed Durable Object keyed by UTC day holding exact counters.
// Until then, the hard backstop is account-side: prepaid OpenRouter credits
// and an OpenAI project monthly budget.

const burstMem = new Map(); // key -> [timestamps]
const dailyMem = new Map(); // `${day}:${key}` -> count

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

async function burst(binding, key, limit, periodSec) {
  if (binding && typeof binding.limit === 'function') {
    const { success } = await binding.limit({ key });
    return success;
  }
  const now = Date.now();
  const windowStart = now - periodSec * 1000;
  const hits = (burstMem.get(key) || []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    burstMem.set(key, hits);
    return false;
  }
  hits.push(now);
  burstMem.set(key, hits);
  return true;
}

function dailyPeek(key) {
  return dailyMem.get(`${utcDay()}:${key}`) || 0;
}

function dailyBump(key) {
  const day = utcDay();
  const k = `${day}:${key}`;
  dailyMem.set(k, (dailyMem.get(k) || 0) + 1);
  // prune yesterday's keys so the Map can't grow forever
  if (dailyMem.size > 5000) {
    for (const old of dailyMem.keys()) if (!old.startsWith(day)) dailyMem.delete(old);
  }
}

// kind: 'chat' | 'speak'
// Returns { ok: true, remainingToday } or { ok: false, reason, retryAfter }.
export async function checkLimits(env, ip, kind) {
  const binding = kind === 'chat' ? env.RL_CHAT : env.RL_SPEAK;
  const burstOk = await burst(binding, `${kind}:${ip}`, kind === 'chat' ? 6 : 8, 60);
  if (!burstOk) return { ok: false, reason: 'burst', retryAfter: 60 };

  // Daily caps only count replies (/chat). /speak is gated by the signed token,
  // which can only exist for a reply that already passed these checks.
  if (kind === 'speak') return { ok: true };

  const ipCap = Number(env.DAILY_IP_CAP || 60);
  const globalCap = Number(env.DAILY_GLOBAL_CAP || 3000);
  const ipUsed = dailyPeek(`ip:${ip}`);
  if (ipUsed >= ipCap) return { ok: false, reason: 'daily_ip', retryAfter: secondsToUtcMidnight() };
  if (dailyPeek('global') >= globalCap) return { ok: false, reason: 'daily_global', retryAfter: secondsToUtcMidnight() };

  dailyBump(`ip:${ip}`);
  dailyBump('global');
  return { ok: true, remainingToday: ipCap - ipUsed - 1 };
}

function secondsToUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}
