# A.I. BABY — Worker

Backend for the A.I. Baby chat panel on 3eascortex.com. Holds the OpenRouter + OpenAI keys so the Pages site never does. Currently in **mock mode**: canned replies + a synthetic robot-babble WAV, so the whole pipe runs with zero accounts.

## Run locally

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run dev                         # Worker on http://127.0.0.1:8787
# second terminal, repo root:
python3 -m http.server 8080         # site on http://localhost:8080
```

Open `http://localhost:8080`, hit **A.I. BABY** bottom-right. The site auto-targets the local Worker when served from localhost.

## API

| Route | In | Out |
|---|---|---|
| `GET /health` | — | `{ ok, mock, model }` |
| `POST /chat` | `{ messages: [{ role, content }] }` (last = user) | `{ id, text, actions: [...], speak: { token, exp }, mock, remainingToday }` |
| `POST /speak` | `{ text, exp, token }` | audio bytes (`audio/wav` mock, `audio/mpeg` live) |

Errors: `{ error: { code, message, retryAfter? } }` + status (400/403/404/405/410/413/429/500).

`/speak` only voices text `/chat` actually returned (HMAC token, 5-min TTL) — the endpoint can't be abused as free TTS.

### Site navigation (`actions`)

`/chat` can return `actions: [{type, ...}]` alongside `text` — the panel executes each one against a real site function. Four types: `go_to_scene` (`{name}`), `play_track` (`{title}`), `stop_music` (`{}`), `open_link` (`{key}`).

- **Catalog** (`src/catalog.js`) is generated, not hand-written: `node scripts/gen-catalog.mjs` reads `../index.html` and extracts `TRACK_TITLES` from `SP_TRACKS` (the real site-wide jukebox — not the mostly-placeholder `TRACKS` array the Transmissions scene player uses), `SCENES` from the top-nav's `.tb-link`/`goScene()` pairs, and `LINKS` from the ACCESS scene's `.llinks` block. Re-run it whenever any of those change in `index.html`; never hand-edit `catalog.js`.
- **Tool schemas** (`src/tools.js`) are built from that catalog, so the model's `enum` options can never list a scene/track/link that doesn't actually exist. Live mode passes these as `tools`/`tool_choice:'auto'` to OpenRouter; `toolCallsToActions()` parses and validates whatever comes back.
- **Mock mode** (`src/mock.js`, `mockActions()`) fakes the same action shapes via keyword matching on the raw user text ("play X", "go to X", "stop the music", link-name mentions) — no LLM involved, but every action still passes through the same `validateAction()` both modes share.
- **Defense in depth, both ends validate independently**: the worker validates against the catalog before ever returning an action; the client (`index.html`, the `aibRunActions`/`AIB_SCENES` block right before `transmit()`) validates again against the real DOM before calling anything — scene names are read live off the actual `.tb-link` elements, link keys resolve to the actual `<a data-aib-key>` hrefs already in the ACCESS section, and `play_track` calls `spPlayTitle()`, which itself only ever matches against `SP_TRACKS`. Nothing here is ever `eval`'d.
- **`spPlayTitle(title)`** (new, in `index.html` next to `spSkip`/`spStop`) reuses the existing crossfade engine rather than duplicating it — splices the match to the front of the shuffle bag so the next natural pick lands on it. One known limitation: if the jukebox hasn't started yet this session, `spStart()` always reshuffles from scratch, so a cold-start `play_track` plays a random track first rather than the requested one. Already-playing (the common case) plays the exact requested track.

## Cost guards

- Per-IP burst: 6 chats/min, 8 speaks/min (Workers Rate Limiting binding, edge-enforced)
- Per-IP daily: 60 replies · global daily: 3000 replies — **best-effort stub** (in-isolate memory, see `src/ratelimit.js`)
- Input capped at 500 chars/message, 10 messages of history, 220 max LLM tokens, 600 chars max to TTS
- CORS allowlist; no-Origin requests rejected in prod
- Hard backstop: prepaid OpenRouter credits + a monthly budget on the OpenAI project

## Going live (later)

```bash
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SPEAK_SECRET     # openssl rand -hex 32
# wrangler.toml: MOCK_MODE = "false"; confirm LLM_MODEL slug on openrouter.ai/models
npm run deploy
```

Then set `PROD_WORKER_URL` in `index.html` (search `PROD_WORKER_URL`) to the deployed `*.workers.dev` URL. Until that's set, the trigger stays hidden on the live site.

## Where to tune

- Persona: `src/persona.js` (fill the `[[ ]]` slots)
- Voice FX: `FX` object at the top of the A.I. BABY script in `index.html` (pitch paths, octave-jump / stutter / dropout odds, crusher, delay)
- TTS voice: `TTS_VOICE` in `wrangler.toml`
