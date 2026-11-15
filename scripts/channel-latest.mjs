// Keep the single newest upload from a YouTube channel in SIGNAL FEED; when the channel
// posts again, the new video replaces the old one.
// Run by .github/workflows/channel-latest.yml (GitHub's servers can reach YouTube).
// No API key: reads the channel's public RSS feed. Node 18+ (built-in fetch), no deps.
//
//   node scripts/channel-latest.mjs <handle> <tag> "<CAPTION PREFIX>"
//   e.g. node scripts/channel-latest.mjs bobbyowsinskimedia bobby "BOBBY OWSINSKI"
//   --dry-run                         print what it would do, change nothing
//   CH_RSS_FILE=a.xml node ...        parse a saved feed instead of fetching (offline test)
//
// The entry it writes carries "tag":"<tag>" and "date"; any older entry with that tag is
// removed. Shorts are skipped (the feed favours full uploads from these channels).

import fs from 'node:fs';

const [handle, tag, prefix] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!handle || !tag || !prefix) { console.error('usage: channel-latest.mjs <handle> <tag> "<CAPTION PREFIX>"'); process.exit(2); }
const DRY = process.argv.includes('--dry-run');
const FEED = new URL('../feed/videos.json', import.meta.url);
const HDR = { 'user-agent': 'Mozilla/5.0 (3eascortex signal-feed bot)', 'accept-language': 'en-US,en;q=0.9' };
const get = async (url) => { const r = await fetch(url, { headers: HDR }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.text(); };
const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function rss() {
  if (process.env.CH_RSS_FILE) return fs.readFileSync(process.env.CH_RSS_FILE, 'utf8');
  const html = await get(`https://www.youtube.com/@${handle}`);
  const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error(`could not find the channel id for @${handle}`);
  return get(`https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`);
}

const xml = await rss();
const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
  title: unxml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
  published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '',
  short: /youtube\.com\/shorts\//.test(e),
})).filter((e) => e.id && !e.short).sort((a, b) => b.published.localeCompare(a.published));

const pick = entries[0];
if (!pick) { console.log(`@${handle}: no uploads found; nothing to do`); process.exit(0); }

const data = JSON.parse(fs.readFileSync(FEED, 'utf8'));
const videos = data.videos || [];
if (videos.some((v) => v.tag === tag && v.id === pick.id)) { console.log(`@${handle}: already up: ${pick.id} ${pick.title}`); process.exit(0); }

const title = pick.title.toUpperCase().replace(/\s+/g, ' ').slice(0, 90);
const entry = { id: pick.id, caption: `${prefix} // ${title}`, tag, date: pick.published.slice(0, 10) };
const old = videos.filter((v) => v.tag === tag).map((v) => v.id);
// keep it next to the other auto entries: right after the Democracy Now! block
const rest = videos.filter((v) => v.tag !== tag);
const at = rest.filter((v) => v.tag === 'dn').length;
rest.splice(at, 0, entry);
data.videos = rest;
console.log(`@${handle}: add ${entry.id} "${entry.caption}"` + (old.length ? `; replace ${old.join(', ')}` : ''));
if (!DRY) fs.writeFileSync(FEED, JSON.stringify(data, null, 2) + '\n');
