#!/usr/bin/env node
// 3EAS MEDIA PIPELINE
//
// Drop audio into one of two folders and run this script:
//
//   media/inbox/jukebox/        free, full-length, plays in the site-wide shuffle
//   media/inbox/transmissions/  for sale: public preview clip + private files for buyers
//
//   node media/pipeline.mjs              process the inbox and upload to Cloudflare R2
//   node media/pipeline.mjs --dry-run    show what would happen; encode into media/.build, upload nothing
//   node media/pipeline.mjs --local      upload into the local test buckets (for `npm run dev` in shop/)
//   node media/pipeline.mjs --sync       no new audio: re-publish catalog.json and the site track lists
//                                        (run this after changing a price in media/catalog.json)
//   add --replace to re-process a track whose name is already in the catalog
//
// Filename tags (optional, stripped from the title):
//   "3EAS - River Viper [$7].wav"      sell for $7 instead of the default price
//   "3EAS - River Viper [@1:15].wav"   start the preview at 1:15
//
// Merch lives in media/merch.json (see media/merch.example.json). Photos go in
// media/merch-photos/. Every run, including --sync, re-checks merch.json,
// uploads any new photos and republishes prices, sizes and stock.
//
// Needs: Node 18+, ffmpeg/ffprobe on PATH, and `npx wrangler login` done once in shop/.
// After it finishes: commit and push index.html + media/catalog.json.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(MEDIA);
const SHOP = path.join(ROOT, 'shop');
const INDEX = path.join(ROOT, 'index.html');
const CATALOG = path.join(MEDIA, 'catalog.json');
const MERCH = path.join(MEDIA, 'merch.json');
const BUILD = path.join(MEDIA, '.build');
const LOCAL_PUBLIC = path.join(MEDIA, '.local-public');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const LOCAL = args.has('--local');
const SYNC = args.has('--sync');
const REPLACE = args.has('--replace');
for (const a of args) {
  if (!['--dry-run', '--local', '--sync', '--replace'].includes(a)) die(`Unknown option ${a}`);
}
if (DRY && LOCAL) die('Pick one of --dry-run or --local.');

const cfg = readJson(path.join(MEDIA, 'config.json'));
const PUBLIC_BASE = LOCAL ? 'http://localhost:8080/media/.local-public' : cfg.publicBase.replace(/\/$/, '');
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a']);
const LOSSLESS = new Set(['.wav', '.aif', '.aiff', '.flac']);


function main() {
  preflight();
  const catalog = readJson(CATALOG);
  catalog.jukebox ||= [];
  catalog.transmissions ||= [];

  const results = { added: [], skipped: [], failed: [] };
  if (!SYNC) {
    for (const section of ['jukebox', 'transmissions']) {
      const dir = path.join(MEDIA, 'inbox', section);
      fs.mkdirSync(dir, { recursive: true });
      const files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase())).sort();
      for (const f of files) {
        const src = path.join(dir, f);
        try {
          const entry = processFile(section, src, catalog);
          if (!entry) { results.skipped.push(`${section}/${f}`); continue; }
          results.added.push(`${section}: ${entry.title}`);
          if (!DRY) {
            const done = path.join(MEDIA, 'done', section);
            fs.mkdirSync(done, { recursive: true });
            fs.renameSync(src, path.join(done, f));
          }
        } catch (e) {
          results.failed.push(`${section}/${f}: ${e.message}`);
          console.error(`  ✗ ${f}: ${e.message}`);
        }
      }
    }
    if (!results.added.length && !results.failed.length) {
      console.log('Inbox is empty. Drop audio into media/inbox/jukebox or media/inbox/transmissions.');
    }
  }

  const merch = buildMerch(catalog);

  // Publish: vault catalog (prices, files, stock for the shop) and the site's lists.
  const vaultCatalog = {
    version: 1,
    shipping: merch.shipping,
    intlCountries: merch.intlCountries,
    products: Object.fromEntries([
      ...catalog.transmissions.map((t) => [t.id, {
        id: t.id, kind: 'digital', title: t.title, price: t.price, available: t.available !== false, files: t.files,
      }]),
      ...merch.vault.map((m) => [m.id, m]),
    ]),
  };
  fs.mkdirSync(BUILD, { recursive: true });
  const vaultPath = path.join(BUILD, 'vault-catalog.json');
  fs.writeFileSync(vaultPath, JSON.stringify(vaultCatalog, null, 2));
  if (DRY) {
    console.log('\n[dry run] Would upload catalog.json to the vault and update index.html.');
  } else {
    upload('vault', 'catalog.json', vaultPath, 'application/json', 'no-store');
    writeJson(CATALOG, catalog);
    updateIndex(catalog, merch.site);
  }

  console.log('\n── Done ──');
  for (const a of results.added) console.log(`  + ${a}`);
  for (const s of results.skipped) console.log(`  = skipped (already in catalog): ${s}`);
  for (const f of results.failed) console.log(`  ✗ ${f}`);
  if (!DRY) {
    console.log(`\nJukebox: ${catalog.jukebox.length} pipeline tracks · Transmissions for sale: ${catalog.transmissions.length} · Merch items: ${merch.site.length}`);
    if (LOCAL) console.log('Local test run: index.html now points at localhost. Do NOT commit it; `git checkout index.html media/catalog.json` to undo.');
    else console.log('Next: commit and push index.html and media/catalog.json.');
  }
  if (results.failed.length) process.exitCode = 1;
}

// ── One file ────────────────────────────────────────────────────────────────

function processFile(section, src, catalog) {
  const file = path.basename(src);
  const ext = path.extname(file).toLowerCase();
  const { title, price, previewStart } = parseName(path.basename(file, path.extname(file)));
  const id = slugify(title);
  if (!id) throw new Error('could not make a name from this filename');
  const list = catalog[section];
  const existing = list.findIndex((t) => t.id === id);
  if (existing !== -1 && !REPLACE) return null;

  console.log(`\n▶ ${section}: ${title}`);
  const hash = sha1(src).slice(0, 8);
  const info = probe(src);
  const work = path.join(BUILD, section, `${id}-${hash}`);
  fs.mkdirSync(work, { recursive: true });
  const displayTitle = title.toUpperCase();

  let entry;
  if (section === 'jukebox') {
    const out = path.join(work, 'jukebox.mp3');
    const m = measure(src, cfg.jukebox.lufs, cfg.jukebox.truePeak);
    encode(src, out, [
      '-af', loudnormFilter(cfg.jukebox.lufs, cfg.jukebox.truePeak, m),
      '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', cfg.jukebox.bitrate,
    ], title);
    const key = `jukebox/${id}-${hash}.mp3`;
    upload('public', key, out, 'audio/mpeg', 'public, max-age=31536000, immutable');
    console.log(`  loudness ${m.input_i} → ${cfg.jukebox.lufs} LUFS · ${fmtTime(info.duration)}`);
    entry = { id, title: displayTitle, src: `${PUBLIC_BASE}/${key}`, gain: cfg.jukebox.gain, added: today() };
  } else {
    const files = [];
    const niceName = safeFileName(title);
    if (LOSSLESS.has(ext)) {
      const key = `masters/${id}-${hash}${ext}`;
      upload('vault', key, src, contentType(ext), 'private, no-store');
      const bits = info.bits ? `${info.bits}-bit ` : '';
      const khz = info.sampleRate ? `${+(info.sampleRate / 1000).toFixed(1)}kHz` : '';
      files.push({ key, name: `${niceName}${ext}`, label: `${ext.slice(1).toUpperCase()} master · ${bits}${khz}`.trim(), bytes: fs.statSync(src).size });
    }
    // Buyer's MP3 is made from the original, not the loudness-matched copy.
    let mp3 = src;
    if (ext !== '.mp3') {
      mp3 = path.join(work, 'buyer.mp3');
      encode(src, mp3, ['-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '320k'], title);
    }
    const mp3Key = `mp3/${id}-${hash}.mp3`;
    upload('vault', mp3Key, mp3, 'audio/mpeg', 'private, no-store');
    files.push({ key: mp3Key, name: `${niceName}.mp3`, label: ext === '.mp3' ? 'MP3' : 'MP3 · 320k', bytes: fs.statSync(mp3).size });

    const p = cfg.preview;
    let start = previewStart ?? p.start;
    let len = Math.min(p.seconds, info.duration);
    if (start + len > info.duration) start = Math.max(0, (info.duration - len) / 2);
    const fadeOutAt = Math.max(0, len - p.fadeOut);
    const prev = path.join(work, 'preview.mp3');
    encode(src, prev, [
      '-ss', start.toFixed(2), '-t', len.toFixed(2),
      '-af', `afade=t=in:d=${p.fadeIn},afade=t=out:st=${fadeOutAt.toFixed(2)}:d=${p.fadeOut},loudnorm=I=${p.lufs}:TP=-1:LRA=11`,
      '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', p.bitrate,
    ], `${title} (preview)`, true);
    const prevKey = `previews/${id}-${hash}.mp3`;
    upload('public', prevKey, prev, 'audio/mpeg', 'public, max-age=31536000, immutable');
    console.log(`  preview ${fmtTime(start)}–${fmtTime(start + len)} · price $${((price ?? cfg.defaultPrice) / 100).toFixed(2)}`);
    entry = {
      id, title: displayTitle, price: price ?? cfg.defaultPrice, preview: `${PUBLIC_BASE}/${prevKey}`,
      files, available: true, added: today(),
    };
  }

  if (existing !== -1) list.splice(existing, 1, entry);
  else list.push(entry);
  return entry;
}

// ── Merch ───────────────────────────────────────────────────────────────────

const MERCH_CATEGORIES = new Set(['apparel', 'media', 'print']);

function buildMerch(catalog) {
  const empty = { site: [], vault: [], shipping: {}, intlCountries: [] };
  if (!fs.existsSync(MERCH)) return empty;
  const m = readJson(MERCH);
  const errors = [];
  const shipping = {};
  for (const [name, r] of Object.entries(m.shipping || {})) {
    const us = dollars(r && r.us), intl = dollars(r && r.intl);
    if (us === null || intl === null) errors.push(`shipping "${name}" needs "us" and "intl" prices in dollars`);
    shipping[name] = { us, intl };
  }
  const intlCountries = (m.intlCountries || []).map((c) => String(c).toUpperCase());
  for (const c of intlCountries) if (!/^[A-Z]{2}$/.test(c)) errors.push(`intlCountries: "${c}" is not a 2-letter country code`);

  const txIds = new Set(catalog.transmissions.map((t) => t.id));
  const seen = new Set();
  const items = [];
  (m.products || []).forEach((p, i) => {
    const where = `product ${i + 1}${p && p.title ? ` (${p.title})` : ''}`;
    const title = String((p && p.title) || '').replace(/[<>]/g, '').trim();
    if (!title) { errors.push(`${where}: needs a "title"`); return; }
    const id = p.id ? String(p.id) : slugify(title);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) errors.push(`${where}: id "${id}" must be lowercase letters, numbers and dashes`);
    if (seen.has(id) || txIds.has(id)) errors.push(`${where}: id "${id}" is already used`);
    seen.add(id);
    const price = dollars(p.price);
    if (price === null || price < 50) errors.push(`${where}: "price" must be at least 0.50 (dollars)`);
    if (!MERCH_CATEGORIES.has(p.category)) errors.push(`${where}: "category" must be apparel, media or print`);
    if (!['self', 'pod'].includes(p.fulfillment)) errors.push(`${where}: "fulfillment" must be "self" (you ship it) or "pod" (Printful)`);
    if (!shipping[p.shipping]) errors.push(`${where}: "shipping" must be one of: ${Object.keys(shipping).join(', ') || '(none defined)'}`);
    if (p.bundle && !txIds.has(p.bundle)) errors.push(`${where}: "bundle" ${p.bundle} is not a transmission in media/catalog.json`);

    // Variants: "sizes" {label: number} or a single "stock"/"printful" number.
    let variants = [];
    if (p.sizes && typeof p.sizes === 'object') {
      variants = Object.entries(p.sizes).map(([label, n]) => ({ id: slugify(label) || 'one', label: String(label).toUpperCase(), n }));
    } else {
      variants = [{ id: 'one', label: 'ONE SIZE', n: p.fulfillment === 'pod' ? p.printful : p.stock }];
    }
    if (!variants.length) errors.push(`${where}: "sizes" is empty`);
    const vids = new Set();
    for (const v of variants) {
      if (vids.has(v.id)) errors.push(`${where}: two sizes both become "${v.id}"`);
      vids.add(v.id);
      if (p.fulfillment === 'self' && !(Number.isInteger(v.n) && v.n >= 0)) errors.push(`${where}: stock for ${v.label} must be a whole number (0 or more)`);
      if (p.fulfillment === 'pod' && !(Number.isInteger(v.n) && v.n > 0)) errors.push(`${where}: ${v.label} needs its Printful sync variant id`);
    }
    const images = Array.isArray(p.images) ? p.images : [];
    for (const img of images) if (!fs.existsSync(path.join(MEDIA, img))) errors.push(`${where}: photo not found: media/${img}`);
    items.push({ p, id, title, price, variants, images });
  });
  if (errors.length) die(`media/merch.json has problems:\n  - ${errors.join('\n  - ')}`);

  catalog.merchImages ||= {};
  const site = [];
  const vault = [];
  for (const { p, id, title, price, variants, images } of items) {
    const urls = images.map((img) => merchImage(catalog, id, path.join(MEDIA, img)));
    const available = p.available !== false;
    vault.push({
      id, kind: 'physical', title: title.toUpperCase(), category: p.category, price, available,
      fulfillment: p.fulfillment, shipping: p.shipping, bundle: p.bundle || null, image: urls[0] || null,
      variants: variants.map((v) => (p.fulfillment === 'self'
        ? { id: v.id, label: v.label, stock: v.n }
        : { id: v.id, label: v.label, printful: v.n })),
    });
    if (!available) continue;
    const bundle = p.bundle ? catalog.transmissions.find((t) => t.id === p.bundle) : null;
    site.push({
      id, title: title.toUpperCase(), category: p.category, price, desc: String(p.description || ''),
      images: urls, fulfillment: p.fulfillment,
      ship: shipping[p.shipping],
      variants: variants.map((v) => ({ id: v.id, label: v.label })),
      bundle: bundle ? bundle.title : null,
    });
  }
  if (site.length) console.log(`\nMerch: ${site.length} item(s) listed`);
  return { site, vault, shipping, intlCountries };
}

// Photos are resized to 1400px JPEGs and uploaded once; the key includes a
// hash of the original, so swapping a photo publishes a new URL.
function merchImage(catalog, id, src) {
  const hash = sha1(src).slice(0, 8);
  const key = `merch/${id}-${hash}.jpg`;
  const cacheKey = `${PUBLIC_BASE}|${key}`;
  if (catalog.merchImages[cacheKey]) return catalog.merchImages[cacheKey];
  const out = path.join(BUILD, 'merch', `${id}-${hash}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', "scale='min(1400,iw)':-2", '-q:v', '4', '-frames:v', '1', out]);
  upload('public', key, out, 'image/jpeg', 'public, max-age=31536000, immutable');
  const url = `${PUBLIC_BASE}/${key}`;
  if (!DRY) catalog.merchImages[cacheKey] = url;
  return url;
}

function dollars(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// ── ffmpeg ──────────────────────────────────────────────────────────────────

function probe(src) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=sample_rate,bits_per_raw_sample,bits_per_sample:format=duration', '-of', 'json', src]);
  const j = JSON.parse(r);
  const s = (j.streams && j.streams[0]) || {};
  const duration = Number(j.format && j.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe could not read the audio');
  return {
    duration,
    sampleRate: Number(s.sample_rate) || null,
    bits: Number(s.bits_per_raw_sample) || Number(s.bits_per_sample) || null,
  };
}

function measure(src, lufs, tp) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af',
    `loudnorm=I=${lufs}:TP=${tp}:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(r.stderr || '');
  if (r.status !== 0 || !m) throw new Error('loudness measurement failed');
  return JSON.parse(m[0]);
}

function loudnormFilter(lufs, tp, m) {
  return `loudnorm=I=${lufs}:TP=${tp}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

function encode(src, out, opts, title, inputOptsFirst) {
  // -ss/-t before -i = fast, accurate-enough seek for previews.
  const pre = inputOptsFirst ? opts.slice(0, 4) : [];
  const post = inputOptsFirst ? opts.slice(4) : opts;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...pre, '-i', src, '-vn', '-map_metadata', '-1',
    ...post, '-id3v2_version', '3', '-metadata', `title=${title}`, '-metadata', 'artist=3EAS', out]);
}

// ── Upload ──────────────────────────────────────────────────────────────────

function upload(which, key, file, type, cacheControl) {
  const bucket = which === 'public' ? cfg.publicBucket : cfg.vaultBucket;
  if (DRY) { console.log(`  [dry run] ${bucket}/${key}`); return; }
  if (LOCAL && which === 'public') {
    const dest = path.join(LOCAL_PUBLIC, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    console.log(`  → local ${key}`);
    return;
  }
  const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file,
    '--content-type', type, '--cache-control', cacheControl, LOCAL ? '--local' : '--remote'],
  { cwd: SHOP, encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(`upload to ${bucket}/${key} failed:\n${(r.stderr || r.stdout || '').trim().slice(-800)}`);
  console.log(`  → ${bucket}/${key}`);
}

// ── Site ────────────────────────────────────────────────────────────────────

const JB_OPEN = '/* ▼ MEDIA PIPELINE: jukebox (generated from media/catalog.json, do not hand-edit) ▼ */';
const JB_CLOSE = '/* ▲ MEDIA PIPELINE: jukebox ▲ */';
const TX_OPEN = '/* ▼ MEDIA PIPELINE: transmissions (generated from media/catalog.json, do not hand-edit) ▼ */';
const TX_CLOSE = '/* ▲ MEDIA PIPELINE: transmissions ▲ */';
const MX_OPEN = '/* ▼ MEDIA PIPELINE: merch (generated from media/merch.json, do not hand-edit) ▼ */';
const MX_CLOSE = '/* ▲ MEDIA PIPELINE: merch ▲ */';

function updateIndex(catalog, merchSite) {
  let html = fs.readFileSync(INDEX, 'utf8');
  const jb = catalog.jukebox.map((t) => `  {title:${js(t.title)},src:${js(t.src)},gain:${Number(t.gain) || 1}},`);
  const tx = catalog.transmissions.filter((t) => t.available !== false).map((t, i) =>
    `  {id:${1000 + i},title:${js(t.title)},artist:'3EAS',type:'release',dur:0,src:${js(t.preview)},buy:{id:${js(t.id)},price:${Number(t.price)}}},`);
  html = replaceBlock(html, JB_OPEN, JB_CLOSE, jb);
  html = replaceBlock(html, TX_OPEN, TX_CLOSE, tx);
  const mx = (merchSite || []).map((m) => `  ${JSON.stringify(m).replace(/</g, '\\u003c')},`);
  html = replaceBlock(html, MX_OPEN, MX_CLOSE, mx);
  fs.writeFileSync(INDEX, html);
  console.log(`\nindex.html updated: ${jb.length} jukebox + ${tx.length} transmissions + ${mx.length} merch from the pipeline.`);
}

function replaceBlock(html, open, close, lines) {
  const a = html.indexOf(open);
  const b = html.indexOf(close);
  if (a === -1 || b === -1 || b < a) die(`Marker missing in index.html: ${open}`);
  const body = lines.length ? `\n${lines.join('\n')}\n  ` : '\n  ';
  return html.slice(0, a + open.length) + body + html.slice(b);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function preflight() {
  if (!fs.existsSync(INDEX)) die('Run this from inside the 3eas repo (index.html not found).');
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(bin, ['-version']).status !== 0) die(`${bin} not found. Install it first (Mac: brew install ffmpeg).`);
  }
  if (!DRY && !fs.existsSync(path.join(SHOP, 'node_modules', 'wrangler'))) {
    die('Wrangler is not installed yet. Run: cd shop && npm install && npx wrangler login');
  }
}

function parseName(stem) {
  let price = null;
  let previewStart = null;
  let title = stem.replace(/\[\s*\$\s*(\d+(?:\.\d{1,2})?)\s*\]/, (_, p) => { price = Math.round(parseFloat(p) * 100); return ''; });
  title = title.replace(/\[\s*@\s*(\d+):(\d{2})\s*\]/, (_, m, s) => { previewStart = Number(m) * 60 + Number(s); return ''; });
  title = title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (price !== null && price < 50) throw new Error(`price tag is under $0.50, Stripe's minimum`);
  return { title, price, previewStart };
}

function slugify(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

function safeFileName(s) {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function contentType(ext) {
  return { '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' }[ext] || 'application/octet-stream';
}

function sha1(file) {
  return createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function run(bin, a) {
  const r = spawnSync(bin, a, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || '').trim().slice(-400)}`);
  return r.stdout;
}

function js(v) { return JSON.stringify(String(v)); }
function fmtTime(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

main();
