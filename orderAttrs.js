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
 * Pulls fbclid/fbp/fbc/utm values off an order using the configurable
 * attribute key names (so this works no matter what your checkout tool
 * happens to name them).
 */
function extractAdClickData(order, keyConfig) {
  const attrs = attrsToMap(order.note_attributes);

  const fbclid = attrs[keyConfig.fbclid];
  const fbp = attrs[keyConfig.fbp];
  const fbc = buildFbc(attrs[keyConfig.fbc], fbclid, order.created_at);
  const utmSource = attrs[keyConfig.utmSource];
  const utmContent = attrs[keyConfig.utmContent];

  return { fbclid, fbp, fbc, utmSource, utmContent };
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
