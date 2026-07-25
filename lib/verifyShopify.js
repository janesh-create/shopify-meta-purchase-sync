const crypto = require("crypto");

/**
 * Confirms a webhook request actually came from Shopify (not a spoofed
 * request hitting your public URL). Shopify signs every webhook with
 * your app/store's shared secret — we recompute the signature and
 * compare it to the one Shopify sent.
 *
 * Requires the RAW request body (see index.js verify() hook) —
 * this check fails silently if JSON has already been re-serialized,
 * because re-serialized JSON rarely matches byte-for-byte.
 */
function verifyShopifyWebhook(req, secret) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader || !req.rawBody || !secret) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyShopifyWebhook };
