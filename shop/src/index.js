// 3EAS SHOP — direct sales from 3eascortex.com. No store in the middle.
//
//   POST /checkout {productId, variant?, region?}  -> { url }  Stripe Checkout (or mock) URL
//   GET  /order?session_id=cs_...                  -> what they bought + download links
//   GET  /file?k=&n=&e=&s=                         -> a file streamed from the private VAULT bucket
//   GET  /stock                                    -> units left per merch size (ship-from-studio items)
//   POST /stripe-webhook                           -> Stripe calls this when a merch order is paid
//   GET  /health                                   -> { ok, mock }
//
// Two kinds of product, both listed in VAULT/catalog.json (written by media/pipeline.mjs):
//   digital   TRANSMISSIONS. Payment is checked on demand when the buyer opens their order link.
//   physical  merch. Stripe collects the shipping address. The webhook then either counts the
//             unit as sold (fulfillment "self": you ship it from the studio) or sends the order
//             to Printful (fulfillment "pod": they print and ship it).
// The browser only ever sends ids; prices, stock and shipping always come from the catalog.

const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,19}$/;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const MOCK_SESSION_RE = /^mock_([a-z0-9][a-z0-9-]{0,79})(?:~([a-z0-9][a-z0-9-]{0,19}))?$/;
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
        case '/stock':
          requireMethod(req, 'GET');
          requireOrigin(cors);
          return json(await stock(env), 200, cors.headers);
        case '/file':
          requireMethod(req, 'GET');
          return await file(url, env);
        case '/stripe-webhook':
          requireMethod(req, 'POST');
          return json(await webhook(req, env), 200, {});
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
  guardMock(env);
  let body;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'bad_json', 'Send JSON: {"productId":"..."}');
  }
  const id = String((body && body.productId) || '');
  if (!PRODUCT_ID_RE.test(id)) throw new HttpError(400, 'bad_product', 'Unknown product.');
  const catalog = await getCatalog(env);
  const product = findProduct(catalog, id);
  if (!product || product.available === false) throw new HttpError(404, 'not_for_sale', 'That item is not for sale right now.');

  const price = Number(product.price);
  if (!Number.isInteger(price) || price < 50) throw new HttpError(500, 'bad_price', 'This item has no valid price yet.');

  const site = String(env.SITE_URL || '').replace(/\/$/, '');
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', String(env.CURRENCY || 'usd'));
  form.set('line_items[0][price_data][unit_amount]', String(price));
  form.set('metadata[product_id]', id);
  form.set('payment_intent_data[metadata][product_id]', id);
  form.set('success_url', `${site}/?order={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${site}/`);
  form.set('allow_promotion_codes', 'true');

  if (product.kind === 'physical') {
    const variant = pickVariant(product, body.variant);
    const region = body.region === 'intl' ? 'intl' : 'us';
    if (product.fulfillment === 'self') {
      const left = await remaining(env, product, variant);
      if (left < 1) throw new HttpError(409, 'sold_out', `${product.title}${variantSuffix(variant)} is sold out.`);
    }
    const rates = (catalog.shipping || {})[product.shipping];
    const rate = rates && Number(rates[region]);
    if (!Number.isInteger(rate) || rate < 0) throw new HttpError(500, 'no_shipping', 'Shipping is not set up for this item.');
    const countries = region === 'us' ? ['US'] : (catalog.intlCountries || []).filter((c) => /^[A-Z]{2}$/.test(c) && c !== 'US');
    if (!countries.length) throw new HttpError(400, 'no_intl', 'International shipping is not available yet.');

    if (isMock(env)) return { url: `${site}/?order=mock_${id}~${variant.id}`, mock: true };

    form.set('line_items[0][price_data][product_data][name]', `3EAS — ${product.title}${variantSuffix(variant)}`);
    if (product.image) form.set('line_items[0][price_data][product_data][images][0]', product.image);
    countries.forEach((c, i) => form.set(`shipping_address_collection[allowed_countries][${i}]`, c));
    form.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    form.set('shipping_options[0][shipping_rate_data][display_name]', region === 'us' ? 'US shipping' : 'International shipping');
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(rate));
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', String(env.CURRENCY || 'usd'));
    if (product.fulfillment === 'pod') form.set('phone_number_collection[enabled]', 'true');
    form.set('metadata[kind]', 'physical');
    form.set('metadata[variant]', variant.id);
    form.set('metadata[region]', region);
  } else {
    if (isMock(env)) return { url: `${site}/?order=mock_${id}`, mock: true };
    form.set('line_items[0][price_data][product_data][name]', `3EAS — ${product.title}`);
    form.set('line_items[0][price_data][product_data][description]', describeFiles(product));
    form.set('metadata[kind]', 'digital');
  }

  const session = await stripe(env, 'POST', '/v1/checkout/sessions', form);
  if (!session.url) throw new HttpError(502, 'stripe', 'Checkout could not start. Try again in a minute.');
  return { url: session.url };
}

async function order(url, env) {
  guardMock(env);
  const sid = url.searchParams.get('session_id') || '';
  let productId, variantId, shipTo = null;

  const mock = MOCK_SESSION_RE.exec(sid);
  if (mock) {
    if (!isMock(env)) throw new HttpError(400, 'bad_order', 'That order link is not valid.');
    productId = mock[1];
    variantId = mock[2];
    shipTo = { name: 'TEST BUYER', city: 'Los Angeles', region: 'CA', country: 'US' };
  } else if (SESSION_RE.test(sid)) {
    if (isMock(env)) throw new HttpError(400, 'bad_order', 'The shop is in test mode; real orders are not being checked.');
    const session = await stripe(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sid)}`);
    if (!isPaid(session)) throw new HttpError(402, 'unpaid', 'This order has not been paid.');
    productId = session.metadata && session.metadata.product_id;
    variantId = session.metadata && session.metadata.variant;
    const sd = session.shipping_details || (session.collected_information && session.collected_information.shipping_details);
    if (sd && sd.address) shipTo = { name: sd.name || '', city: sd.address.city || '', region: sd.address.state || '', country: sd.address.country || '' };
  } else {
    throw new HttpError(400, 'bad_order', 'That order link is not valid.');
  }

  const catalog = await getCatalog(env);
  const product = productId && PRODUCT_ID_RE.test(productId) ? findProduct(catalog, productId) : null;
  const missing = 'This order is paid, but the item is missing from the shop. Email passwordpills@pm.me and we will sort it out.';
  if (!product) throw new HttpError(404, 'gone', missing);

  if (product.kind === 'physical') {
    const variant = (product.variants || []).find((v) => v.id === variantId) || null;
    const bundle = product.bundle ? findProduct(catalog, product.bundle) : null;
    const dl = bundle ? await signedFiles(env, bundle, url.origin) : { files: [], exp: null };
    return {
      product: { id: product.id, title: product.title },
      physical: { variant: variant && variant.label !== 'ONE SIZE' ? variant.label : null, fulfillment: product.fulfillment, shipTo },
      bundle: bundle ? { id: bundle.id, title: bundle.title } : null,
      files: dl.files,
      expiresAt: dl.exp,
    };
  }

  const dl = await signedFiles(env, product, url.origin);
  if (!dl.files.length) throw new HttpError(404, 'gone', missing);
  return { product: { id: product.id, title: product.title }, files: dl.files, expiresAt: dl.exp };
}

async function signedFiles(env, product, origin) {
  const ttl = Math.max(60, Math.min(86400, Number(env.LINK_TTL_SECONDS) || 3600));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const files = [];
  for (const f of product.files || []) {
    if (!FILE_KEY_RE.test(f.key)) continue;
    const name = safeName(f.name || f.key.split('/').pop());
    const s = await sign(env, `${f.key}\n${name}\n${exp}`);
    const q = new URLSearchParams({ k: f.key, n: name, e: String(exp), s });
    files.push({ label: f.label || name, name, bytes: f.bytes || null, url: `${origin}/file?${q}` });
  }
  return { files, exp };
}

async function stock(env) {
  const catalog = await getCatalog(env);
  const out = {};
  for (const p of Object.values(catalog.products || {})) {
    if (p.kind !== 'physical' || p.available === false) continue;
    const sold = p.fulfillment === 'self' ? await getSold(env, p.id) : {};
    out[p.id] = {};
    for (const v of p.variants || []) {
      out[p.id][v.id] = p.fulfillment === 'self' ? Math.max(0, (Number(v.stock) || 0) - (sold[v.id] || 0)) : null;
    }
  }
  return { products: out };
}

// Stripe → us, once per paid checkout. Only merch needs it: counts the sale
// against stock, or hands the order to Printful. Answering non-2xx makes
// Stripe retry for up to three days, so failures are loud, not lost.
async function webhook(req, env) {
  const raw = await req.text();
  await verifyStripeSignature(env, req.headers.get('Stripe-Signature') || '', raw);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_json', 'Bad event body.');
  }
  const type = event && event.type;
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') return { ok: true, ignored: type };
  const session = event.data && event.data.object;
  if (!session || !isPaid(session)) return { ok: true, ignored: 'unpaid' };
  const meta = session.metadata || {};
  if (meta.kind !== 'physical') return { ok: true, ignored: 'digital' };

  requireKv(env);
  const doneKey = `done:${session.id}`;
  if (await env.STOCK.get(doneKey)) return { ok: true, duplicate: true };

  const catalog = await getCatalog(env);
  const product = findProduct(catalog, meta.product_id);
  if (!product || product.kind !== 'physical') throw new HttpError(500, 'unknown_product', `Paid order for unknown product ${meta.product_id}`);
  const variant = (product.variants || []).find((v) => v.id === meta.variant);
  if (!variant) throw new HttpError(500, 'unknown_variant', `Paid order for unknown variant ${meta.variant}`);

  let result;
  if (product.fulfillment === 'pod') {
    result = await printfulOrder(env, session, product, variant);
  } else {
    const sold = await getSold(env, product.id);
    sold[variant.id] = (sold[variant.id] || 0) + 1;
    await env.STOCK.put(`sold:${product.id}`, JSON.stringify(sold));
    result = { counted: true, sold: sold[variant.id] };
  }
  await env.STOCK.put(doneKey, JSON.stringify({ at: new Date().toISOString(), product: product.id, variant: variant.id, ...result }), { expirationTtl: 60 * 60 * 24 * 90 });
  return { ok: true, ...result };
}

// ── Merch helpers ───────────────────────────────────────────────────────────

function pickVariant(product, given) {
  const variants = product.variants || [];
  const want = String(given || (variants.length === 1 ? variants[0].id : ''));
  if (!VARIANT_RE.test(want)) throw new HttpError(400, 'pick_size', 'Pick a size first.');
  const v = variants.find((x) => x.id === want);
  if (!v) throw new HttpError(400, 'pick_size', 'That size does not exist.');
  return v;
}

function variantSuffix(v) {
  return v && v.label && v.label !== 'ONE SIZE' ? ` (${v.label})` : '';
}

async function getSold(env, productId) {
  requireKv(env);
  const raw = await env.STOCK.get(`sold:${productId}`);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function remaining(env, product, variant) {
  const sold = await getSold(env, product.id);
  return (Number(variant.stock) || 0) - (sold[variant.id] || 0);
}

function requireKv(env) {
  if (!env.STOCK) throw new HttpError(500, 'config', 'Stock storage is not set up.');
}

async function printfulOrder(env, session, product, variant) {
  const sd = session.shipping_details || (session.collected_information && session.collected_information.shipping_details) || {};
  const a = sd.address || {};
  const cd = session.customer_details || {};
  const body = {
    external_id: (await sha256hex(session.id)).slice(0, 32),
    shipping: 'STANDARD',
    recipient: {
      name: sd.name || cd.name || '',
      address1: a.line1 || '',
      address2: a.line2 || '',
      city: a.city || '',
      state_code: a.state || '',
      country_code: a.country || '',
      zip: a.postal_code || '',
      email: cd.email || '',
      phone: cd.phone || '',
    },
    items: [{ sync_variant_id: Number(variant.printful), quantity: 1 }],
  };
  if (!env.PRINTFUL_TOKEN) {
    if (isMock(env)) {
      await env.STOCK.put(`pod:${session.id}`, JSON.stringify(body), { expirationTtl: 60 * 60 * 24 });
      return { printful: 'mock', draft: body.external_id };
    }
    throw new HttpError(500, 'config', 'PRINTFUL_TOKEN is not set; print-on-demand order not sent.');
  }
  const confirm = String(env.PRINTFUL_AUTO_CONFIRM) === 'true';
  const res = await fetch(`https://api.printful.com/orders${confirm ? '?confirm=true' : ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_TOKEN}`,
      'Content-Type': 'application/json',
      ...(env.PRINTFUL_STORE_ID ? { 'X-PF-Store-Id': String(env.PRINTFUL_STORE_ID) } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) return { printful: 'already_sent', draft: body.external_id };
  if (!res.ok) {
    console.error('printful', res.status, JSON.stringify(data));
    throw new HttpError(502, 'printful', `Printful rejected the order (${res.status}).`);
  }
  return { printful: confirm ? 'confirmed' : 'draft', printfulId: data && data.result && data.result.id };
}

async function verifyStripeSignature(env, header, raw) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(500, 'config', 'STRIPE_WEBHOOK_SECRET is not set.');
  const parts = Object.create(null);
  const sigs = [];
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'v1') sigs.push(v);
    else if (k && v) parts[k.trim()] = v.trim();
  }
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new HttpError(400, 'bad_signature', 'Missing Stripe signature.');
  if (Math.abs(Date.now() / 1000 - t) > 300) throw new HttpError(400, 'stale', 'Stripe event is too old.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const want = new TextEncoder().encode([...mac].map((b) => b.toString(16).padStart(2, '0')).join(''));
  for (const s of sigs) {
    const got = new TextEncoder().encode(s.trim());
    if (got.length === want.length && crypto.subtle.timingSafeEqual(got, want)) return;
  }
  throw new HttpError(400, 'bad_signature', 'Stripe signature does not match.');
}

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isPaid(session) {
  return session.status === 'complete' &&
    (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
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

async function getCatalog(env) {
  if (!catalogCache.data || Date.now() - catalogCache.at > 60_000) {
    const obj = await env.VAULT.get('catalog.json');
    if (!obj) throw new HttpError(503, 'no_catalog', 'The shop is not stocked yet.');
    catalogCache = { at: Date.now(), data: await obj.json() };
  }
  return catalogCache.data;
}

function findProduct(catalog, id) {
  const products = (catalog && catalog.products) || {};
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

// Mock mode hands out free "paid" orders, so it only ever runs against a
// localhost site. Deployed with MOCK_MODE still "true", the shop stays shut
// instead of giving files away.
function guardMock(env) {
  if (isMock(env) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(String(env.SITE_URL || ''))) {
    throw new HttpError(503, 'not_open', 'The shop is not open yet.');
  }
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
