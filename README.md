# Shopify → Meta Purchase Sync

Fixes a common D2C tracking gap: when checkout happens through a 3rd-party
tool (not Shopify's native checkout), Meta's pixel never sees the purchase,
so ad platforms can't optimize toward real buyers.

**How it works:** your ad-click identifiers (fbclid/fbp/fbc) are captured
on your storefront before the customer leaves for the 3rd-party checkout
tool, that tool writes them onto the Shopify order, and this tool listens
for new Shopify orders and reports the Purchase to Meta's Conversions API
(CAPI) — no browser pixel required at checkout at all.

This guide assumes you've never deployed code before. Follow it top to
bottom in order.

---

## Before you start: what you need from the checkout tool

This only works if your 3rd-party checkout tool writes the ad-click data
onto the Shopify order as **note attributes**. Confirm with that tool's
support team (or check one recent order's raw data via Shopify Admin API)
that it's writing something like `fbclid`, `fbp`, `fbc`, `utm_source`,
`utm_content` onto the order. If it isn't yet, that's step zero — get the
tool to pass those through first, or this has nothing to read.

---

## Part 1 — Get accounts set up (10 minutes)

You need three free accounts:

1. **GitHub** — [github.com/signup](https://github.com/signup) — this is where the code lives.
2. **Render** — [render.com](https://render.com) — this is where the code *runs*. Sign up with your GitHub account so they're linked automatically.
3. **Meta Business Suite / Events Manager access** — you likely already have this since you run Meta ads.

---

## Part 2 — Get this code onto GitHub

1. Log into GitHub, click the **+** icon top-right → **New repository**.
2. Name it `shopify-meta-purchase-sync`, keep it **Private**, click **Create repository**.
3. On the next screen, click **uploading an existing file**.
4. Drag in every file from this project (`index.js`, `package.json`,
   `.env.example`, the `lib` folder with its 3 files). Do **not** upload a
   `.env` file if you ever create one locally — it holds secrets.
5. Click **Commit changes**.

---

## Part 3 — Deploy it on Render

1. In Render, click **New +** → **Web Service**.
2. Connect the `shopify-meta-purchase-sync` repo you just created.
3. Fill in:
   - **Name**: `shopify-meta-purchase-sync` (or anything)
   - **Region**: closest to your customers (e.g. Singapore for India)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine to start
4. Before clicking Create, scroll to **Environment Variables** and add
   each one from `.env.example` (leave the actual secret *values* blank
   for now — you'll fill them in over the next two parts, then redeploy).
5. Click **Create Web Service**. Render will build and give you a URL like:
   `https://shopify-meta-purchase-sync.onrender.com`

   Note: free Render services "sleep" after inactivity and take ~30s to
   wake on the next request. Fine for this use case since order volume
   is sporadic, but upgrade to a paid instance ($7/mo) if you want zero
   cold-start delay.

6. Visit `https://your-app.onrender.com/` in a browser — you should see
   "shopify-meta-purchase-sync is running." If not, check Render's **Logs** tab.

---

## Part 4 — Connect Shopify

1. Shopify Admin → **Settings** → **Notifications** → scroll to **Webhooks**.
2. Click **Create webhook**.
   - **Event**: `Order creation`
   - **Format**: `JSON`
   - **URL**: `https://your-app.onrender.com/webhooks/shopify/order-created`
   - **API version**: latest stable
3. Save. Shopify will show you a **signing secret** — copy it.
4. Back in Render → your service → **Environment**, paste it into
   `SHOPIFY_WEBHOOK_SECRET`, then **Save Changes** (Render redeploys automatically).

---

## Part 5 — Connect Meta

1. Go to [Meta Events Manager](https://business.facebook.com/events_manager).
2. Select your Pixel → **Settings** tab → find **Conversions API**.
3. Click **Generate access token** (simplest for one store). For something
   longer-lived that won't expire, use Business Settings → System Users
   instead — ask if you want help with that path.
4. Copy your **Pixel ID** (shown at the top of the pixel's page) and the token.
5. In Render → Environment, fill in `META_PIXEL_ID` and `META_ACCESS_TOKEN`. Save.

---

## Part 6 — Match the attribute names

Whatever your checkout tool actually calls these fields on the order,
set them in Render's environment variables:

- `ATTR_KEY_FBCLID`
- `ATTR_KEY_FBP`
- `ATTR_KEY_FBC`
- `ATTR_KEY_UTM_SOURCE`
- `ATTR_KEY_UTM_CONTENT`

If unsure, place one test order and check its `note_attributes` in
Shopify Admin (Order page → scroll to **Additional details**) to see the
exact field names used.

Also set `STORE_CHECKOUT_URL` to your real storefront URL.

---

## Part 6b — If your checkout tool already sends its own events to Meta

Some 3rd-party checkout tools have a built-in "send Purchase to Meta"
feature that fires for *every* order, regardless of whether it came from
an ad or not. This pollutes Meta's Purchase signal and hurts ad set
optimization — the algorithm ends up training on conversions it can't
actually influence.

Two things needed together, not one:

1. **Turn off the checkout tool's built-in Meta/CAPI sending**, if it has
   a setting for that. This tool is meant to replace it, not run
   alongside it — running both means Meta gets both a clean, filtered
   signal from us and a noisy, unfiltered one from them on the same
   Pixel, which defeats the point. If there's no such setting, contact
   their support and ask directly — worth pushing on.

2. **Set an explicit UTM allow-list** so only orders that genuinely trace
   back to Meta ads get sent, not just any order that happens to have a
   leftover fbclid cookie:
   - `ALLOWED_UTM_SOURCES` — e.g. `facebook,instagram,meta`
   - `ALLOWED_UTM_CONTENT_PATTERNS` — e.g. `meta_` if your Meta campaigns
     tag `utm_content` with a `meta_` prefix (matching the same gating
     convention used in your storefront pixel setup)

   Set at least one of these in Render's Environment tab. Leaving both
   blank falls back to "send if a click id exists at all" — safer than
   nothing, but not as precise as an explicit allow-list.

---

## Part 7 — Test it safely

1. In Meta Events Manager → your Pixel → **Test Events** tab, copy the
   **Test event code** shown there.
2. In Render, set `META_TEST_EVENT_CODE` to that value. Save (redeploys).
3. Place a real test order that goes through your actual ad-click →
   checkout-tool → Shopify flow.
4. Watch the Test Events tab — you should see a `Purchase` event appear
   within seconds, with `fbc`/`fbp` populated and a green "Matched" status.
5. Once confirmed, **delete the value** of `META_TEST_EVENT_CODE` in
   Render (leave it blank) and save — this switches from test mode to
   live sending.

---

## Ongoing: how to know it's working

- Render → **Logs** tab shows a line per order: either "Purchase event
  sent to Meta CAPI" or an error you can act on.
- Meta Events Manager → your Pixel → **Overview** tab shows incoming
  Purchase event volume and match quality score over time.

---

## Making this replicable across brands / stores

This project is written so a second brand can reuse it without touching
code — copy the repo, deploy a second Render service from it, and set
that brand's own environment variables (different Shopify secret, Meta
pixel ID, checkout URL, and attribute key names if their checkout tool
differs). No code changes needed per brand, only configuration.

If you'll be running this for many stores, the natural next step is
turning the per-store config into rows in a database instead of one
deploy per brand — worth doing once you're past 2–3 stores, not before.
