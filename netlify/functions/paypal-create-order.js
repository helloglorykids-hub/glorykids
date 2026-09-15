/* POST /api/paypal-create-order   Header (optional): Authorization: Bearer <Firebase ID token>
   Body (JSON): { items:[{id}], buyer:{name, email?}, discountCode? }

   PayPal's one-time-checkout equivalent of payfast-checkout.js. Same rules:
   guest checkout allowed but personal details are compulsory either way,
   and prices always come from Firestore, never the client. Unlike PayFast,
   PayPal settles in USD directly — no ZAR conversion needed here.

   Returns PayPal's own order id (from POST /v2/checkout/orders) for the
   browser's PayPal Buttons `createOrder` callback to hand back to the SDK.
   Fulfilment happens after approval in paypal-capture-order.js — this
   endpoint only prices things and opens the PayPal order. */
'use strict';
const { db, admin } = require('./_lib/firebase');
const { api } = require('./_lib/paypal');
const { json, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const { json: body } = parseBody(event);
  const items = Array.isArray(body.items) ? body.items : [];
  const buyer = body.buyer || {};
  if (!items.length) return json(400, { error: 'Cart is empty' });
  if (!buyer.name || !buyer.name.trim()) return json(400, { error: 'Your name is required.' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  let buyerUid = null, buyerEmail;
  if (idToken) {
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return json(401, { error: 'Your session has expired — please log in again.' });
    }
    buyerUid = decoded.uid;
    buyerEmail = (decoded.email || '').toLowerCase();
    if (!buyerEmail) return json(400, { error: 'Your account has no email on file — please contact us.' });
  } else {
    buyerEmail = (buyer.email || '').toLowerCase().trim();
    if (!buyerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail)) {
      return json(400, { error: 'A valid email address is required.' });
    }
  }

  const resolved = [];
  for (const it of items) {
    const snap = await db.collection('products').doc(String(it.id)).get();
    if (!snap.exists) return json(400, { error: `Unknown product: ${it.id}` });
    const p = snap.data();
    if (!p.active) return json(400, { error: `Not available: ${p.title}` });
    const priceUSD = Number(p.priceUSD != null ? p.priceUSD : p.priceZAR);
    resolved.push({ productId: snap.id, title: p.title, priceUSD });
  }
  const subtotalUSD = resolved.reduce((s, r) => s + r.priceUSD, 0);

  let discount = 0, discountCode = '';
  if (body.discountCode) {
    const code = String(body.discountCode).trim().toUpperCase();
    const dSnap = await db.collection('discountCodes').doc(code).get();
    if (dSnap.exists) {
      const d = dSnap.data();
      const okActive = d.active !== false;
      const okExpiry = !d.expiresAt || d.expiresAt > Date.now();
      const okUses = !d.maxUses || (d.usageCount || 0) < d.maxUses;
      const okMin = !d.minSubtotalUSD || subtotalUSD >= d.minSubtotalUSD;
      if (okActive && okExpiry && okUses && okMin) {
        discount = d.type === 'percent'
          ? Math.round(subtotalUSD * (Number(d.value) / 100) * 100) / 100
          : Math.min(Number(d.value), subtotalUSD);
        discountCode = code;
      } else {
        return json(400, { error: 'That discount code cannot be applied.' });
      }
    } else {
      return json(400, { error: 'Discount code not found.' });
    }
  }

  const totalUSD = Math.max(0, Math.round((subtotalUSD - discount) * 100) / 100);
  if (totalUSD < 1) return json(400, { error: 'Order total is below the minimum for card payment.' });

  const orderRef = db.collection('orders').doc();
  await orderRef.set({
    items: resolved,
    subtotalUSD,
    discountCode,
    discountUSD: discount,
    totalUSD,
    buyerEmail,
    buyerName: buyer.name || '',
    uid: buyerUid,
    provider: 'paypal',
    status: 'pending',
    createdAt: Date.now()
  });

  const itemName = resolved.length === 1
    ? resolved[0].title
    : `Glory Kids order (${resolved.length} items)`;

  const { ok, data } = await api('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: orderRef.id,
      description: itemName.slice(0, 127),
      amount: { currency_code: 'USD', value: totalUSD.toFixed(2) }
    }]
  });
  if (!ok) {
    console.error('paypal-create-order: PayPal order create failed', JSON.stringify(data));
    return json(502, { error: 'Could not start PayPal checkout — please try again.' });
  }

  return json(200, { orderId: orderRef.id, ppOrderId: data.id, totalUSD });
};
