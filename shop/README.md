# 3EAS SHOP

Sells TRANSMISSIONS and merch straight from 3eascortex.com. No store in the middle: Stripe takes the card, Cloudflare holds the files, the money lands in your Stripe account.

```
visitor hears a 90s preview ──▶ BUY $5 ──▶ Stripe Checkout ──▶ back to 3eascortex.com/?order=cs_...
                                                                   │
                         Worker asks Stripe "is this paid?" ◀──────┘
                                   │ yes
                         one-hour signed links ──▶ WAV master + MP3 from the private vault
```

The order link is the buyer's receipt. Reopening it any time gives fresh download links.

## Pieces

| Piece | Where | What it holds |
|---|---|---|
| `3eas-media` R2 bucket | public, served at `media.3eascortex.com` | jukebox MP3s, 90s previews |
| `3eas-vault` R2 bucket | private | sale masters, buyer MP3s, `catalog.json` (prices) |
| `3eas-shop` Worker | this folder | `/checkout`, `/order`, `/file`, `/stock`, `/stripe-webhook` |
| `STOCK` KV store | Cloudflare | how many of each studio-shipped item have sold |
| `media/pipeline.mjs` | repo | encodes, uploads, writes the site's track lists |

## Test it on your computer (no accounts needed)

```bash
cd shop && npm install && cp .dev.vars.example .dev.vars
npm run dev                               # shop on http://127.0.0.1:8788, mock mode
# second terminal, repo root:
mkdir -p media/inbox/transmissions
cp "~/Music/Some Track.wav" media/inbox/transmissions/
node media/pipeline.mjs --local
python3 -m http.server 8080               # site on http://localhost:8080
```

Open `http://localhost:8080`, go to TRANSMISSIONS, pick the track, hit BUY. Mock mode skips Stripe and drops you on a paid order with working downloads. Afterwards: `git checkout index.html media/catalog.json` (the local run points them at localhost).

## Going live, once

1. **Cloudflare account** (free). R2 asks for a card on file; the free tier covers 10GB and streaming is never billed.
2. **Move 3eascortex.com's DNS to Cloudflare.** Cloudflare dashboard → Add a site → copy your current records (the GitHub Pages ones) → at Namecheap set the two nameservers Cloudflare gives you. Namecheap stays the registrar, GitHub Pages keeps hosting the site.
3. **Buckets.** R2 → create `3eas-media` and `3eas-vault`. On `3eas-media` → Settings → Custom domain → `media.3eascortex.com`. Leave `3eas-vault` with no public access.
4. **Stripe test run, on your computer.** Stripe Dashboard → Developers → API keys → copy the test key (`sk_test_...`). In `shop/.dev.vars` add `STRIPE_SECRET_KEY=sk_test_...` and `MOCK_MODE=false`, run `npm run dev` and the site locally as above, and buy with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). You should land back on your local site with both downloads working.
5. **Stock storage** (skip if no merch yet): `npx wrangler kv namespace create STOCK` and paste the id into `wrangler.toml`.
6. **Fill the vault:** `node media/pipeline.mjs` (uploads for real this time), then commit and push `index.html` and `media/catalog.json`.
7. **Deploy with the live key only.** A deployed test key would let anyone who finds the Worker "pay" with the test card.
   ```bash
   cd shop
   npx wrangler login
   npx wrangler secret put STRIPE_SECRET_KEY    # paste sk_live_...
   npx wrangler secret put DL_SECRET            # paste the output of: openssl rand -hex 32
   # wrangler.toml: MOCK_MODE = "false"
   npm run deploy                               # prints https://3eas-shop.<you>.workers.dev
   ```
   Selling merch: now add the Stripe webhook (see Merch below) pointing at that URL, and `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
8. **Open the shop.** In `index.html` search `SHOP_PROD_URL`, paste the Worker URL, commit, push. The BUY buttons switch from SIGNAL PENDING to live. Make one real $5 purchase yourself and refund it in Stripe.

Until step 8, the live site shows SIGNAL PENDING and sells nothing. If the Worker is ever deployed with `MOCK_MODE` still `"true"`, it refuses every order instead of giving files away.

## Merch

Merch shows up in ACQUISITIONS: apparel under THE UNIFORM, vinyl/tapes/CDs and prints/posters/zines under ARTIFACTS. Each item gets its own card with photos, sizes, US or international shipping, and a BUY button. Sizes that sell out cross themselves off.

Edit `media/merch.json` (copy the shapes from `media/merch.example.json`), put photos in `media/merch-photos/`, then:

```bash
node media/pipeline.mjs --sync
git add index.html media/catalog.json media/merch.json media/merch-photos && git commit -m "Merch" && git push
```

Per item:

| Field | Meaning |
|---|---|
| `title`, `description` | shown on the card |
| `category` | `apparel`, `media` or `print` |
| `price` | dollars, e.g. `35` |
| `fulfillment` | `self` = you ship it from the studio, `pod` = Printful prints and ships |
| `shipping` | which rate from the `shipping` table at the top (dollars, flat per order, `us` and `intl`) |
| `sizes` | `self`: `{"S": 10, "M": 20}` = units on hand. `pod`: `{"M": 4012345671}` = Printful sync variant ids |
| `stock` / `printful` | same thing for one-size items |
| `bundle` | a transmission id from `media/catalog.json`; buyers get its download on the receipt page |
| `available` | `false` hides it |

**Stock** is the total number of each size you've ever had for sale; the shop subtracts what's sold. To restock, add the new units to that number and `--sync`. Two people buying the very last unit at the same second can both get through; you'd refund one.

**Ship-from-studio orders** appear in Stripe → Payments with the buyer's address. Pack, ship, and add tracking there if you want.

**Print-on-demand**: create the products in Printful (Stores → "Manual order / API" store), copy each size's *sync variant id* into `sizes`, and set `PRINTFUL_TOKEN` (Printful → Developers → private token). Orders arrive in Printful as drafts until you set `PRINTFUL_AUTO_CONFIRM = "true"` in `wrangler.toml`; confirm the first few by hand.

**Webhook (needed for merch)**: Stripe → Developers → Webhooks → Add endpoint → `https://3eas-shop.<you>.workers.dev/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret and run `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.

**Stock storage**: `npx wrangler kv namespace create STOCK`, paste the id into `wrangler.toml`.

**Sales tax**: prices go through as-is, with no tax added. Selling physical goods in California normally means holding a seller's permit and remitting sales tax; Stripe Tax can add it automatically for a small fee. Check with an accountant; this isn't tax advice.

## Adding music

```bash
# drop files in:
media/inbox/jukebox/          # free, full length, site-wide shuffle
media/inbox/transmissions/    # for sale

node media/pipeline.mjs --dry-run   # see what it will do
node media/pipeline.mjs             # do it
git add index.html media/catalog.json && git commit -m "New transmissions" && git push
```

- Filename becomes the title: `3EAS - River Viper.wav` → `3EAS - RIVER VIPER`.
- `[$7]` in the filename sets the price (default $5 in `media/config.json`). `[@1:15]` starts the preview at 1:15.
- Jukebox tracks are loudness-matched to −12 LUFS so they sit together. Sale files are never touched: buyers get your original master plus a 320k MP3 made from it.
- Change a price later: edit it in `media/catalog.json`, run `node media/pipeline.mjs --sync`, commit, push.
- Pull something from sale: set `"available": false` on it in `media/catalog.json`, then `--sync`. Past buyers can still download.

## Not built yet

- **Email delivery.** Buyers get their files on the page they land on, and Stripe can email a payment receipt (Dashboard → Settings → Emails), but that receipt doesn't include the download link. Adding an email with the link needs a mail service (Resend has a free tier).
- **Existing jukebox tracks** still load from `uploads/` and DigitalOcean. Run them through `media/inbox/jukebox/`, then delete their old hand-written lines in `SP_TRACKS`.
- **WAR WITHIN A BREATH** is still a free full-length file in `uploads/`. To sell it, put the master in `media/inbox/transmissions/` and remove its hand-written line from `TRACKS` and the file from `uploads/`.
