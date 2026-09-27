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
| `POST /chat` | `{ messages: [{ role, content }] }` (last = user) | `{ id, text, speak: { token, exp }, mock, remainingToday }` |
| `POST /speak` | `{ text, exp, token }` | audio bytes (`audio/wav` mock, `audio/mpeg` live) |

Errors: `{ error: { code, message, retryAfter? } }` + status (400/403/404/405/410/413/429/500).

`/speak` only voices text `/chat` actually returned (HMAC token, 5-min TTL) — the endpoint can't be abused as free TTS.

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
