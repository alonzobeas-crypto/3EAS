// Democracy Now! "Headlines" in SIGNAL FEED, one per weekday, a fresh set each week.
// Run by .github/workflows/dn-headlines.yml (GitHub's servers can reach YouTube).
// No API key: reads the channel's public RSS feed plus its in-channel search for
// "headlines" (the RSS only holds the last ~15 uploads, which DN fills in a day or two).
// Node 18+ (built-in fetch), no deps.
//
//   node scripts/dn-headlines.mjs            update feed/videos.json
//   node scripts/dn-headlines.mjs --dry-run  print what it would do, change nothing
//   DN_RSS_FILE=a.xml DN_SEARCH_FILE=b.html DN_TODAY=2026-11-14 node ...   offline test
//
// The week: keeps every Headlines from Monday of the current week (New York time) on,
// newest first, at the top of the feed. On a Saturday/Sunday "the current week" is the
// one that just ended, so the weekend shows Mon–Fri; the next Monday's run drops last
// week's and starts over. Entries it adds carry "tag":"dn"; nothing else is touched.

import fs from 'node:fs';

const FEED = new URL('../feed/videos.json', import.meta.url);
const HANDLE = 'democracynow';
const DRY = process.argv.includes('--dry-run');
const HDR = { 'user-agent': 'Mozilla/5.0 (3eascortex signal-feed bot)', 'accept-language': 'en-US,en;q=0.9' };
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const get = async (url) => { const r = await fetch(url, { headers: HDR }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.text(); };
const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function channelId() {
  if (process.env.DN_CHANNEL_ID) return process.env.DN_CHANNEL_ID;
  const html = await get(`https://www.youtube.com/@${HANDLE}`);
  const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('could not find the Democracy Now! channel id');
  return m[1];
}

// "Headlines for November 13, 2026: ..." -> "2026-11-13"
function dateFromTitle(t) {
  const m = t.match(/headlines\b[^0-9a-z]*(?:for\s+)?([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
const nyDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

async function fromRss() {
  const xml = process.env.DN_RSS_FILE ? fs.readFileSync(process.env.DN_RSS_FILE, 'utf8')
    : await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${await channelId()}`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const title = unxml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    return { id: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1], title, date: dateFromTitle(title) || (pub ? nyDate(pub) : null) };
  });
}

async function fromSearch() {
  const html = process.env.DN_SEARCH_FILE ? fs.readFileSync(process.env.DN_SEARCH_FILE, 'utf8')
    : await get(`https://www.youtube.com/@${HANDLE}/search?query=headlines`);
  return html.split('"videoRenderer":{').slice(1).map((chunk) => {
    const id = (chunk.match(/^"videoId":"([\w-]{11})"/) || [])[1];
    const raw = (chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1];
    let title = '';
    try { title = raw ? JSON.parse(`"${raw}"`) : ''; } catch { title = raw || ''; }
    return { id, title, date: dateFromTitle(title) };   // search results carry no machine date
  });
}

// Monday (New York) of the week that contains `today`; Sat/Sun count as the week just ended.
function weekStart(today) {
  const d = new Date(today + 'T12:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const today = process.env.DN_TODAY || nyDate(Date.now());
const monday = weekStart(today);
let found = [];
for (const src of [fromRss, fromSearch]) {
  try { found.push(...await src()); } catch (e) { console.log(`${src.name}: ${e.message}`); }
}
// one Headlines per day: the "Headlines for <date>" clip, dated this week, newest first
const byDay = new Map();
for (const v of found) {
  if (!v.id || !v.date || !/\bheadlines\b/i.test(v.title)) continue;
  if (v.date < monday || v.date > today) continue;
  if (!byDay.has(v.date)) byDay.set(v.date, v);
}
const week = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));

const data = JSON.parse(fs.readFileSync(FEED, 'utf8'));
const rest = (data.videos || []).filter((v) => v.tag !== 'dn');
const before = (data.videos || []).filter((v) => v.tag === 'dn').map((v) => v.id).join(',');
const label = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
const dn = week.map((v) => ({ id: v.id, caption: `DEMOCRACY NOW! // HEADLINES ${label(v.date)}`, tag: 'dn', date: v.date }));

console.log(`week of ${monday} (today ${today}): ${dn.length} Headlines found` + dn.map((v) => `\n  ${v.date} ${v.id}`).join(''));
if (!dn.length && before) { console.log('nothing found this run; leaving the current ones in place'); process.exit(0); }
if (dn.map((v) => v.id).join(',') === before) { console.log('no change'); process.exit(0); }
data.videos = [...dn, ...rest];
if (!DRY) fs.writeFileSync(FEED, JSON.stringify(data, null, 2) + '\n');
console.log(DRY ? '(dry run, nothing written)' : 'feed/videos.json updated');
