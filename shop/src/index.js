// 3EAS SHOP — direct sales for TRANSMISSIONS.
//
//   POST /checkout {productId}          -> { url }   Stripe Checkout (or mock) URL to send the buyer to
//   GET  /order?session_id=cs_...        -> { product, files:[{label,name,bytes,url}], expiresAt }
//   GET  /file?k=&n=&e=&s=               -> the file itself, streamed from the private VAULT bucket
//   GET  /health                         -> { ok, mock }
//
// Prices and the file list live in VAULT/catalog.json, written by
// media/pipeline.mjs. The browser only ever sends a product id; the price
// always comes from the catalog, never from the client.
//
// Payment is verified on demand: /order asks Stripe directly whether the
// session is paid, so there is no webhook to configure. The order link the
// buyer lands on (3eascortex.com/?order=cs_...) is their receipt; reopening it
// any time mints fresh download links.

const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const MOCK_SESSION_RE = /^mock_([a-z0-9][a-z0-9-]{0,79})$/;
const FILE_KEY_RE = /^(masters|mp3)\/[A-Za-z0-9._-]{1,160}$/;

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);
    try {
      if (req.method === 'OPTIONS') {
        if (!cors.ok) throw new HttpError(403, 'origin', 'Origin not allowed.');
        return new Response(null, { status: 204, headers: cors.headers });
      }
      switch (url.pathname) {
        case '/health':
          return json({ ok: true, mock: isMock(env) }, 200, cors.headers);
        case '/checkout':
          requireMethod(req, 'POST');
          requireOrigin(cors);
          await rateLimit(req, env);
          return json(await checkout(req, env), 200, cors.headers);
        case '/order':
          requireMethod(req, 'GET');
          requireOrigin(cors);
          await rateLimit(req, env);
          return json(await order(url, env), 200, cors.headers);
        case '/file':
          requireMethod(req, 'GET');
          return await file(url, env);
        default:
          throw new HttpError(404, 'not_found', 'No such route.');
      }
    } catch (e) {
      if (e instanceof HttpError) {
        // /file is opened directly in a browser tab, so answer in plain words.
        if (url.pathname === '/file') {
          return new Response(`3EAS // ${e.message}\n`, { status: e.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        return json({ error: { code: e.code, message: e.message, ...e.extra } }, e.status, cors.headers);
      }
      console.error('shop error', e && e.stack ? e.stack : e);
      return json({ error: { code: 'internal', message: 'Something broke on our side. Try again in a minute.' } }, 500, cors.headers);
    }
  },
};

// ── Routes ──────────────────────────────────────────────────────────────────

async function checkout(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'bad_json', 'Send JSON: {"productId":"..."}');
  }
  const id = String((body && body.productId) || '');
  if (!PRODUCT_ID_RE.test(id)) throw new HttpError(400, 'bad_product', 'Unknown product.');
  const product = await getProduct(env, id);
  if (!product || product.available === false) throw new HttpError(404, 'not_for_sale', 'That transmission is not for sale right now.');

  const price = Number(product.price);
  if (!Number.isInteger(price) || price < 50) throw new HttpError(500, 'bad_price', 'This product has no valid price yet.');

  const site = String(env.SITE_URL || '').replace(/\/$/, '');
  if (isMock(env)) {
    return { url: `${site}/?order=mock_${id}`, mock: true };
  }

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', String(env.CURRENCY || 'usd'));
  form.set('line_items[0][price_data][unit_amount]', String(price));
  form.set('line_items[0][price_data][product_data][name]', `3EAS — ${product.title}`);
  form.set('line_items[0][price_data][product_data][description]', describeFiles(product));
  form.set('metadata[product_id]', id);
  form.set('payment_intent_data[metadata][product_id]', id);
  form.set('success_url', `${site}/?order={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${site}/`);
  form.set('allow_promotion_codes', 'true');

  const session = await stripe(env, 'POST', '/v1/checkout/sessions', form);
  if (!session.url) throw new HttpError(502, 'stripe', 'Checkout could not start. Try again in a minute.');
  return { url: session.url };
}

async function order(url, env) {
  const sid = url.searchParams.get('session_id') || '';
  let productId;

  const mock = MOCK_SESSION_RE.exec(sid);
  if (mock) {
    if (!isMock(env)) throw new HttpError(400, 'bad_order', 'That order link is not valid.');
    productId = mock[1];
  } else if (SESSION_RE.test(sid)) {
    if (isMock(env)) throw new HttpError(400, 'bad_order', 'The shop is in test mode; real orders are not being checked.');
    const session = await stripe(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sid)}`);
    const paid = session.status === 'complete' &&
      (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
    if (!paid) throw new HttpError(402, 'unpaid', 'This order has not been paid.');
    productId = session.metadata && session.metadata.product_id;
  } else {
    throw new HttpError(400, 'bad_order', 'That order link is not valid.');
  }

  const product = productId && PRODUCT_ID_RE.test(productId) ? await getProduct(env, productId) : null;
  if (!product) throw new HttpError(404, 'gone', 'This order is paid, but the files are missing. Email passwordpills@pm.me and we will send them.');

  const ttl = Math.max(60, Math.min(86400, Number(env.LINK_TTL_SECONDS) || 3600));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const origin = url.origin;
  const files = [];
  for (const f of product.files || []) {
    if (!FILE_KEY_RE.test(f.key)) continue;
    const name = safeName(f.name || f.key.split('/').pop());
    const s = await sign(env, `${f.key}\n${name}\n${exp}`);
    const q = new URLSearchParams({ k: f.key, n: name, e: String(exp), s });
    files.push({ label: f.label || name, name, bytes: f.bytes || null, url: `${origin}/file?${q}` });
  }
  if (!files.length) throw new HttpError(404, 'gone', 'This order is paid, but the files are missing. Email passwordpills@pm.me and we will send them.');
  return { product: { id: product.id, title: product.title }, files, expiresAt: exp };
}

async function file(url, env) {
  const k = url.searchParams.get('k') || '';
  const n = url.searchParams.get('n') || '';
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') || '';
  if (!FILE_KEY_RE.test(k) || !n || n !== safeName(n) || !Number.isFinite(e) || !s) {
    throw new HttpError(400, 'bad_link', 'That download link is broken.');
  }
  if (e < Math.floor(Date.now() / 1000)) {
    throw new HttpError(410, 'expired', 'This download link expired. Reopen your order link to get a fresh one.');
  }
  const ok = await verify(env, `${k}\n${n}\n${e}`, s);
  if (!ok) throw new HttpError(403, 'bad_link', 'That download link is not valid.');

  const obj = await env.VAULT.get(k);
  if (!obj) throw new HttpError(404, 'missing', 'File not found. Email passwordpills@pm.me and we will send it.');

  const headers = new Headers();
  headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || contentTypeFor(k));
  headers.set('Content-Length', String(obj.size));
  headers.set('Content-Disposition', `attachment; filename="${n.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(n)}`);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { status: 200, headers });
}

// ── Catalog ─────────────────────────────────────────────────────────────────

let catalogCache = { at: 0, data: null };

async function getProduct(env, id) {
  if (!catalogCache.data || Date.now() - catalogCache.at > 60_000) {
    const obj = await env.VAULT.get('catalog.json');
    if (!obj) throw new HttpError(503, 'no_catalog', 'The shop is not stocked yet.');
    catalogCache = { at: Date.now(), data: await obj.json() };
  }
  const products = (catalogCache.data && catalogCache.data.products) || {};
  return Object.prototype.hasOwnProperty.call(products, id) ? products[id] : null;
}

function describeFiles(product) {
  const labels = (product.files || []).map((f) => f.label).filter(Boolean);
  return labels.length ? `Download: ${labels.join(' + ')}` : 'Digital download';
}

// ── Stripe ──────────────────────────────────────────────────────────────────

async function stripe(env, method, path, form) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(500, 'config', 'Shop is not configured yet.');
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      'Stripe-Version': '2024-06-20',
    },
    body: form ? form.toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('stripe', res.status, JSON.stringify(data && data.error));
    if (res.status === 404) throw new HttpError(404, 'bad_order', 'That order link is not valid.');
    throw new HttpError(502, 'stripe', 'Payment provider error. Try again in a minute.');
  }
  return data;
}

// ── Signing ─────────────────────────────────────────────────────────────────

async function hmacKey(env) {
  let secret = env.DL_SECRET;
  if (!secret) {
    if (!isMock(env)) throw new HttpError(500, 'config', 'Shop is not configured yet.');
    secret = 'mock-mode-secret-not-for-production';
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(env, msg) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(msg));
  return b64url(new Uint8Array(sig));
}

async function verify(env, msg, given) {
  const want = new TextEncoder().encode(await sign(env, msg));
  const got = new TextEncoder().encode(given);
  if (want.length !== got.length) return false;
  return crypto.subtle.timingSafeEqual(want, got);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isMock(env) {
  return String(env.MOCK_MODE) !== 'false';
}

function corsFor(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { ok: false, headers: {} };
  return {
    ok: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

function requireOrigin(cors) {
  if (!cors.ok) throw new HttpError(403, 'origin', 'Origin not allowed.');
}

function requireMethod(req, method) {
  if (req.method !== method) throw new HttpError(405, 'method', `Use ${method}.`);
}

async function rateLimit(req, env) {
  if (!env.RL_SHOP || typeof env.RL_SHOP.limit !== 'function') return;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const { success } = await env.RL_SHOP.limit({ key: ip });
  if (!success) throw new HttpError(429, 'slow_down', 'Too many requests. Wait a minute and try again.', { retryAfter: 60 });
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150) || 'download';
}

function contentTypeFor(key) {
  const ext = key.split('.').pop().toLowerCase();
  return {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aif: 'audio/aiff',
    aiff: 'audio/aiff',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    zip: 'application/zip',
  }[ext] || 'application/octet-stream';
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
