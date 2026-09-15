/* POST /api/paypal-webhook
   Configure this URL in the PayPal Developer dashboard (Apps & Credentials →
   your app → Webhooks), subscribed to:
     BILLING.SUBSCRIPTION.ACTIVATED
     BILLING.SUBSCRIPTION.CANCELLED
     BILLING.SUBSCRIPTION.SUSPENDED
     BILLING.SUBSCRIPTION.PAYMENT.FAILED
     PAYMENT.SALE.COMPLETED          (subscription renewal payments)
     PAYMENT.CAPTURE.COMPLETED       (shop one-time orders — fallback only;
                                       normal shop fulfilment happens
                                       synchronously in paypal-capture-order.js)

   This is PayPal's equivalent of payfast-notify.js: the one durable source
   of truth for subscription lifecycle, since PayPal can send these events
   at any time (a renewal three weeks from now, a card decline, a member
   cancelling from their own PayPal account instead of ours) with nobody
   sitting in a browser to trigger the confirm/capture endpoints. */
'use strict';
const { db } = require('./_lib/firebase');
const { verifyWebhookSignature } = require('./_lib/paypal');
const { activateSubscription, deactivateSubscription, fulfillShopOrder } = require('./_lib/paypal-fulfill');
const { json, parseBody } = require('./_lib/http');

async function findSubIdByPpSubscriptionId(ppSubscriptionId) {
  const snap = await db.collection('subscriptions').where('ppSubscriptionId', '==', ppSubscriptionId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const { json: body, raw } = parseBody(event);
  if (!body || !body.event_type) return json(400, { error: 'Not a webhook event' });

  const verified = await verifyWebhookSignature(event.headers, body).catch(e => {
    console.error('paypal-webhook: signature verification threw', e && e.message);
    return false;
  });
  if (!verified) {
    console.error('paypal-webhook: signature verification failed for', body.event_type, body.id);
    return json(400, { error: 'Signature verification failed' });
  }

  const type = body.event_type;
  const resource = body.resource || {};
  const eventId = body.id;

  try {
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      const subId = resource.custom_id || await findSubIdByPpSubscriptionId(resource.id);
      if (!subId) { console.error('paypal-webhook: no subId for activated', resource.id); return json(200, { ok: true }); }
      await db.collection('subscriptions').doc(subId).set({ ppSubscriptionId: resource.id, ppPlanId: resource.plan_id || null }, { merge: true });
      await activateSubscription({ subId, ppEventId: eventId });

    } else if (type === 'PAYMENT.SALE.COMPLETED') {
      // Renewal payment for a subscription. billing_agreement_id is PayPal's
      // subscription id on recurring sale events (absent on one-off sales).
      const ppSubscriptionId = resource.billing_agreement_id;
      if (!ppSubscriptionId) return json(200, { ok: true }); // not a subscription payment — ignore
      const subId = await findSubIdByPpSubscriptionId(ppSubscriptionId);
      if (!subId) { console.error('paypal-webhook: no subId for sale', ppSubscriptionId); return json(200, { ok: true }); }
      const amountUSD = resource.amount && resource.amount.total != null ? Number(resource.amount.total) : undefined;
      await activateSubscription({ subId, ppEventId: eventId, amountUSD });

    } else if (type === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const subId = resource.custom_id || await findSubIdByPpSubscriptionId(resource.id);
      if (subId) await deactivateSubscription({ subId, status: 'cancelled' });

    } else if (type === 'BILLING.SUBSCRIPTION.SUSPENDED' || type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      const subId = resource.custom_id || await findSubIdByPpSubscriptionId(resource.id || resource.billing_agreement_id);
      if (subId) await deactivateSubscription({ subId, status: 'past_due' });

    } else if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      // Fallback path for shop orders — normal flow fulfils synchronously in
      // paypal-capture-order.js, so this just catches the rare case where
      // the browser closed before that call completed.
      const orderId = resource.custom_id;
      const grossUSD = Number(resource.amount && resource.amount.value);
      if (orderId && grossUSD) {
        await fulfillShopOrder({ orderId, grossUSD, ppCaptureId: resource.id });
      }
    }
    // Unhandled event types are acknowledged and ignored — PayPal retries on
    // non-200s, and we only care about the events listed above.
  } catch (e) {
    console.error('paypal-webhook: handler error for', type, e && e.stack);
    return json(500, { error: 'Internal error' });
  }

  return json(200, { ok: true });
};
