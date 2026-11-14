// Daily: put today's Democracy Now! "Headlines" video at the top of SIGNAL FEED.
// Run by .github/workflows/dn-headlines.yml (GitHub's servers can reach YouTube).
// No API key: reads the channel's public RSS feed. Node 18+ (built-in fetch), no deps.
//
//   node scripts/dn-headlines.mjs            update feed/videos.json if there's a new one
//   node scripts/dn-headlines.mjs --dry-run  print what it would do, change nothing
//   DN_RSS_FILE=sample.xml node ...          parse a saved feed instead of fetching (testing)
//
// Only the latest Headlines is kept: yesterday's is swapped out for today's, so the
// feed doesn't fill up with a new DN clip every weekday. Entries it adds carry "tag":"dn";
// nothing else in videos.json is touched.

import fs from 'node:fs';

const FEED = new URL('../feed/videos.json', import.meta.url);
const HANDLE = 'democracynow';
const DRY = process.argv.includes('--dry-run');
const UA = { 'user-agent': 'Mozilla/5.0 (3eascortex signal-feed bot)' };

async function channelId() {
  if (process.env.DN_CHANNEL_ID) return process.env.DN_CHANNEL_ID;
  const html = await (await fetch(`https://www.youtube.com/@${HANDLE}`, { headers: UA })).text();
  const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('could not find the Democracy Now! channel id');
  return m[1];
}

async function rss() {
  if (process.env.DN_RSS_FILE) return fs.readFileSync(process.env.DN_RSS_FILE, 'utf8');
  const id = await channelId();
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: UA });
  if (!r.ok) throw new Error(`feed fetch failed: ${r.status}`);
  return r.text();
}

const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const xml = await rss();
const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
  title: unxml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
  published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '',
})).filter((e) => e.id);

// Newest video whose title says Headlines (e.g. "Headlines for November 14, 2026: ...").
const pick = entries
  .filter((e) => /\bheadlines\b/i.test(e.title))
  .sort((a, b) => b.published.localeCompare(a.published))[0];

if (!pick) { console.log(`no Headlines video among ${entries.length} recent uploads; nothing to do`); process.exit(0); }

const data = JSON.parse(fs.readFileSync(FEED, 'utf8'));
const videos = data.videos || [];
if (videos.some((v) => v.id === pick.id)) { console.log(`already in the feed: ${pick.id} ${pick.title}`); process.exit(0); }

const day = pick.published ? new Date(pick.published).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase() : '';
const entry = { id: pick.id, caption: `DEMOCRACY NOW! // HEADLINES ${day}`.trim(), tag: 'dn' };
const removed = videos.filter((v) => v.tag === 'dn');
data.videos = [entry, ...videos.filter((v) => v.tag !== 'dn')];

console.log(`add ${entry.id} "${entry.caption}" (from "${pick.title}")` + (removed.length ? `; replace ${removed.map((v) => v.id).join(', ')}` : ''));
if (!DRY) fs.writeFileSync(FEED, JSON.stringify(data, null, 2) + '\n');
