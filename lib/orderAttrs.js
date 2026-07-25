/**
 * Shopify stores checkout note_attributes as an array of {name, value}
 * pairs. This turns that into a lowercase-keyed lookup object so key
 * matching doesn't break on casing differences from the checkout tool.
 */
function attrsToMap(noteAttributes = []) {
  const map = {};
  for (const entry of noteAttributes) {
    if (entry && entry.name) {
      map[entry.name.toLowerCase()] = entry.value;
    }
  }
  return map;
}

/**
 * Meta expects fbc in the form: fb.<subdomain_index>.<creation_time_ms>.<fbclid>
 * If the checkout tool only stored the raw fbclid (not the full fbc string),
 * we rebuild it here using the order's creation time as a stand-in for
 * click time — close enough for attribution purposes.
 */
function buildFbc(rawFbc, fbclid, orderCreatedAt) {
  if (rawFbc && rawFbc.startsWith("fb.")) return rawFbc;
  if (!fbclid) return undefined;
  const ts = orderCreatedAt ? new Date(orderCreatedAt).getTime() : Date.now();
  return `fb.1.${ts}.${fbclid}`;
}

/**
 * Some checkout tools don't store fbclid as its own attribute — instead
 * it's buried inside the full landing page URL that was captured at
 * click time (e.g. "...?utm_source=...&fbclid=PAd..."). This pulls it
 * out if a direct fbclid attribute wasn't found.
 */
function extractFbclidFromUrl(landingPageUrl) {
  if (!landingPageUrl) return undefined;
  try {
    const url = new URL(landingPageUrl);
    return url.searchParams.get("fbclid") || undefined;
  } catch (err) {
    // landing_page_url wasn't a valid absolute URL — try a raw regex fallback.
    const match = landingPageUrl.match(/[?&]fbclid=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
}

/**
 * Pulls fbclid/fbp/fbc/utm values off an order using the configurable
 * attribute key names (so this works no matter what your checkout tool
 * happens to name them). Also recovers ip/user_agent from note_attributes
 * when the checkout tool stores them there, since that's often more
 * accurate than Shopify's own order.client_details for 3rd-party checkouts.
 */
function extractAdClickData(order, keyConfig) {
  const attrs = attrsToMap(order.note_attributes);

  const landingPageUrl = attrs[keyConfig.landingPageUrl];
  const fbclid = attrs[keyConfig.fbclid] || extractFbclidFromUrl(landingPageUrl);
  const fbp = attrs[keyConfig.fbp];
  const fbc = buildFbc(attrs[keyConfig.fbc], fbclid, order.created_at);
  const utmSource = attrs[keyConfig.utmSource];
  const utmContent = attrs[keyConfig.utmContent];
  const ip = attrs[keyConfig.ip];
  const userAgent = attrs[keyConfig.userAgent];

  return { fbclid, fbp, fbc, utmSource, utmContent, ip, userAgent };
}

/**
 * Decides whether this order counts as real Meta ad traffic worth
 * reporting to CAPI — separate from whether ad-click IDs merely exist.
 * A checkout tool that stamps fbclid/utm fields on every order (even
 * organic ones, via stale cookies) will still fail this check if the
 * UTM values don't match your allow-list.
 *
 * config.allowedUtmSources / config.allowedUtmContentPatterns are both
 * optional. If neither is set, falls back to "fbclid must be present"
 * as a safe minimum bar.
 */
function isQualifiedMetaTraffic(adClickData, config) {
  const { utmSource, utmContent, fbclid } = adClickData;
  const { allowedUtmSources = [], allowedUtmContentPatterns = [] } = config;

  const sourceMatch =
    allowedUtmSources.length > 0 &&
    utmSource &&
    allowedUtmSources.includes(utmSource.toLowerCase());

  const contentMatch =
    allowedUtmContentPatterns.length > 0 &&
    utmContent &&
    allowedUtmContentPatterns.some((pattern) =>
      utmContent.toLowerCase().includes(pattern.toLowerCase())
    );

  if (allowedUtmSources.length === 0 && allowedUtmContentPatterns.length === 0) {
    // No allow-list configured — fall back to requiring a real click id.
    return Boolean(fbclid);
  }

  // If both lists are configured, require BOTH to match (strictest).
  // If only one list is configured, that one alone decides.
  if (allowedUtmSources.length > 0 && allowedUtmContentPatterns.length > 0) {
    return Boolean(sourceMatch && contentMatch);
  }
  return Boolean(sourceMatch || contentMatch);
}

module.exports = { attrsToMap, buildFbc, extractAdClickData, isQualifiedMetaTraffic };
