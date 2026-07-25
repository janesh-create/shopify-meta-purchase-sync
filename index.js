require("dotenv").config();
const express = require("express");
const { verifyShopifyWebhook } = require("./lib/verifyShopify");
const { extractAdClickData, isQualifiedMetaTraffic } = require("./lib/orderAttrs");
const { sendPurchaseEvent } = require("./lib/metaCapi");

const app = express();

// Shopify's HMAC check needs the exact raw bytes of the request body,
// so we capture them before express.json() parses and re-serializes.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const env = {
  shopifySecret: process.env.SHOPIFY_WEBHOOK_SECRET,
  pixelId: process.env.META_PIXEL_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
  testEventCode: process.env.META_TEST_EVENT_CODE || undefined,
  storeCheckoutUrl: process.env.STORE_CHECKOUT_URL,
  attrKeys: {
    fbclid: (process.env.ATTR_KEY_FBCLID || "fbclid").toLowerCase(),
    fbp: (process.env.ATTR_KEY_FBP || "fbp").toLowerCase(),
    fbc: (process.env.ATTR_KEY_FBC || "fbc").toLowerCase(),
    utmSource: (process.env.ATTR_KEY_UTM_SOURCE || "utm_source").toLowerCase(),
    utmContent: (process.env.ATTR_KEY_UTM_CONTENT || "utm_content").toLowerCase(),
  },
  trafficFilter: {
    // Comma-separated list, e.g. "facebook,instagram,meta". Matched
    // case-insensitively against the order's utm_source.
    allowedUtmSources: (process.env.ALLOWED_UTM_SOURCES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // Comma-separated list of substrings to match against utm_content,
    // e.g. "meta_,fb_" if that's how your Meta campaigns tag utm_content.
    allowedUtmContentPatterns: (process.env.ALLOWED_UTM_CONTENT_PATTERNS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

// Basic startup check so a misconfigured deploy fails loudly, not silently.
const requiredVars = ["shopifySecret", "pixelId", "accessToken", "storeCheckoutUrl"];
for (const key of requiredVars) {
  if (!env[key]) {
    console.warn(`[startup warning] Missing required env var for "${key}". Set it before going live.`);
  }
}

// Simple health check so you can confirm the server is up from a browser.
app.get("/", (_req, res) => {
  res.send("shopify-meta-purchase-sync is running.");
});

app.post("/webhooks/shopify/order-created", async (req, res) => {
  if (!verifyShopifyWebhook(req, env.shopifySecret)) {
    console.warn("Rejected webhook: invalid HMAC signature");
    return res.status(401).send("Invalid signature");
  }

  // Acknowledge immediately — Shopify retries if you take longer than ~5s,
  // and we don't want duplicate sends while we're still calling Meta.
  res.status(200).send("OK");

  const order = req.body;

  try {
    const adClickData = extractAdClickData(order, env.attrKeys);

    if (!isQualifiedMetaTraffic(adClickData, env.trafficFilter)) {
      console.log(
        `Order ${order.id}: traffic source (utm_source="${adClickData.utmSource}", utm_content="${adClickData.utmContent}") did not match Meta allow-list — skipping to keep pixel training clean`
      );
      return;
    }

    const { ok, status, result } = await sendPurchaseEvent(order, adClickData, env);

    if (!ok) {
      console.error(`Order ${order.id}: Meta CAPI error (status ${status})`, result);
    } else {
      console.log(`Order ${order.id}: Purchase event sent to Meta CAPI`, result);
    }
  } catch (err) {
    console.error(`Order ${order.id}: unexpected error while processing`, err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`shopify-meta-purchase-sync listening on port ${port}`);
});
