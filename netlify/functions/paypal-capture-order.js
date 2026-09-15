/* POST /api/paypal-capture-order
   Body (JSON): { ppOrderId, orderId }

   Called from the browser's onApprove handler after the buyer approves the
   PayPal order. Captures the payment server-side (never trust a client-side
   capture alone) and fulfils it — mints download tokens, logs the payment,
   notifies admin, syncs MailerLite. Mirrors the shop-order branch of
   payfast-notify.js; PAYMENT.CAPTURE.COMPLETED in paypal-webhook.js is a
   fallback for the rare case this call never completes. */
'use strict';
const { db } = require('./_lib/firebase');
const { api } = require('./_lib/paypal');
const { fulfillShopOrder } = require('./_lib/paypal-fulfill');
const { json, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const { json: body } = parseBody(event);
  const ppOrderId = body.ppOrderId;
  const orderId = body.orderId;
  if (!ppOrderId || !orderId) return json(400, { error: 'Missing order reference.' });

  const orderRef = db.collection('orders').doc(String(orderId));
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return json(404, { error: 'Order not found.' });
  const order = orderSnap.data();

  if (order.status === 'paid') {
    return json(200, { ok: true, already: true, downloadTokens: order.downloadTokens || [] });
  }

  const { ok, data } = await api('POST', `/v2/checkout/orders/${encodeURIComponent(ppOrderId)}/capture`, {});
  if (!ok) {
    console.error('paypal-capture-order: capture failed', orderId, JSON.stringify(data));
    return json(502, { error: 'Payment could not be captured — please try again or contact us.' });
  }

  const capture = data.purchase_units && data.purchase_units[0] &&
    data.purchase_units[0].payments && data.purchase_units[0].payments.captures &&
    data.purchase_units[0].payments.captures[0];
  if (!capture || capture.status !== 'COMPLETED') {
    console.error('paypal-capture-order: unexpected capture status', orderId, JSON.stringify(data));
    return json(502, { error: 'Payment did not complete — please try again.' });
  }

  const grossUSD = Number(capture.amount && capture.amount.value);
  const result = await fulfillShopOrder({ orderId, grossUSD, ppCaptureId: capture.id });
  if (!result.ok) {
    console.error('paypal-capture-order: fulfilment failed', orderId, result.reason);
    return json(500, { error: 'Payment succeeded but we couldn’t finish your order — our team has been notified.' });
  }

  const fresh = await orderRef.get();
  return json(200, { ok: true, downloadTokens: (fresh.data() || {}).downloadTokens || [] });
};
