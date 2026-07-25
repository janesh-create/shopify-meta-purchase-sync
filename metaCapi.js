const crypto = require("crypto");

function sha256(value) {
  if (!value) return undefined;
  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function buildPurchasePayload(order, adClickData, env) {
  const { fbclid, fbp, fbc } = adClickData;

  const customer = order.customer || {};
  const email = order.email || customer.email;
  const rawPhone = order.phone || customer.phone || order.billing_address?.phone;
  const phone = rawPhone ? rawPhone.replace(/\D/g, "") : undefined;

  const userData = {
    em: email ? [sha256(email)] : undefined,
    ph: phone ? [sha256(phone)] : undefined,
    client_ip_address: order.client_details?.browser_ip,
    client_user_agent: order.client_details?.user_agent,
    fbc,
    fbp,
  };
  Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

  const contents = (order.line_items || []).map((li) => ({
    id: String(li.product_id || li.sku || li.variant_id),
    quantity: li.quantity,
    item_price: parseFloat(li.price),
  }));

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
        event_id: `shopify_order_${order.id}`,
        action_source: "system_generated",
        event_source_url: env.storeCheckoutUrl,
        user_data: userData,
        custom_data: {
          currency: order.currency,
          value: parseFloat(order.total_price),
          content_ids: contents.map((c) => c.id),
          contents,
          content_type: "product",
          order_id: String(order.id),
        },
      },
    ],
  };

  if (env.testEventCode) {
    payload.test_event_code = env.testEventCode;
  }

  return payload;
}

async function sendPurchaseEvent(order, adClickData, env) {
  const payload = buildPurchasePayload(order, adClickData, env);
  const url = `https://graph.facebook.com/v20.0/${env.pixelId}/events?access_token=${env.accessToken}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();
  return { ok: resp.ok, status: resp.status, result };
}

module.exports = { sendPurchaseEvent, buildPurchasePayload, sha256 };
