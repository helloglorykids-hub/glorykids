/* POST /api/payfast-checkout
   Body (JSON): { items:[{id}], buyer:{email,name,uid?}, discountCode? }
   Prices come from Firestore (never trust the client). Creates a pending
   order and returns the signed PayFast field set for the browser to POST. */
'use strict';
const { db, FieldValue } = require('./_lib/firebase');
const { buildCheckout } = require('./_lib/payfast');
const { json, parseBody } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

// PayFast settles in ZAR. Products are priced in USD on-site; convert here.
// Set USD_ZAR_RATE in Netlify env (update it periodically). Fallback is a
// conservative rate so checkout never breaks if the var is missing.
const USD_ZAR_RATE = Number(process.env.USD_ZAR_RATE) || 18.5;
const usdToZar = usd => Math.round(usd * USD_ZAR_RATE * 100) / 100;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const { json: body } = parseBody(event);
  const items = Array.isArray(body.items) ? body.items : [];
  const buyer = body.buyer || {};
  if (!items.length) return json(400, { error: 'Cart is empty' });
  if (!buyer.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) {
    return json(400, { error: 'A valid email is required' });
  }

  // Resolve products server-side (prices in USD → converted to ZAR for PayFast)
  const resolved = [];
  for (const it of items) {
    const snap = await db.collection('products').doc(String(it.id)).get();
    if (!snap.exists) return json(400, { error: `Unknown product: ${it.id}` });
    const p = snap.data();
    if (!p.active) return json(400, { error: `Not available: ${p.title}` });
    const priceUSD = Number(p.priceUSD != null ? p.priceUSD : p.priceZAR); // back-compat
    resolved.push({
      productId: snap.id,
      title: p.title,
      priceUSD,
      priceZAR: usdToZar(priceUSD)
    });
  }
  const subtotalUSD = resolved.reduce((s, r) => s + r.priceUSD, 0);
  const subtotal = resolved.reduce((s, r) => s + r.priceZAR, 0);

  // Discount
  let discount = 0, discountCode = '';
  if (body.discountCode) {
    const code = String(body.discountCode).trim().toUpperCase();
    const dSnap = await db.collection('discountCodes').doc(code).get();
    if (dSnap.exists) {
      const d = dSnap.data();
      const okActive = d.active !== false;
      const okExpiry = !d.expiresAt || d.expiresAt > Date.now();
      const okUses = !d.maxUses || (d.usageCount || 0) < d.maxUses;
      const okMin = !d.minSubtotalZAR || subtotal >= d.minSubtotalZAR;
      if (okActive && okExpiry && okUses && okMin) {
        discount = d.type === 'percent'
          ? Math.round(subtotal * (Number(d.value) / 100) * 100) / 100
          : Math.min(Number(d.value), subtotal);
        discountCode = code;
      } else {
        return json(400, { error: 'That discount code cannot be applied.' });
      }
    } else {
      return json(400, { error: 'Discount code not found.' });
    }
  }

  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const totalUSD = Math.round((subtotalUSD - discount / USD_ZAR_RATE) * 100) / 100;
  if (total < 5) return json(400, { error: 'Order total is below the minimum for card payment.' });

  const orderRef = db.collection('orders').doc();
  await orderRef.set({
    items: resolved,
    subtotalUSD,
    subtotalZAR: subtotal,
    discountCode,
    discountZAR: discount,
    totalUSD,
    totalZAR: total,
    fxRateUsdZar: USD_ZAR_RATE,
    buyerEmail: buyer.email.toLowerCase(),
    buyerName: buyer.name || '',
    uid: buyer.uid || null,
    status: 'pending',
    createdAt: Date.now()
  });

  const itemName = resolved.length === 1
    ? resolved[0].title
    : `Glory Kids order (${resolved.length} items)`;

  const { fields, processUrl } = buildCheckout({
    return_url: `${SITE}/shop-thankyou.html?order=${orderRef.id}`,
    cancel_url: `${SITE}/shop.html?cancelled=1`,
    notify_url: `${SITE}/api/payfast-notify`,
    name_first: buyer.name || '',
    email_address: buyer.email,
    m_payment_id: orderRef.id,
    amount: total,
    item_name: itemName,
    item_description: resolved.map(r => r.title).join(', ').slice(0, 255),
    custom_str1: orderRef.id
  });

  return json(200, { orderId: orderRef.id, processUrl, fields, total, totalUSD });
};
