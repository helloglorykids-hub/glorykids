/* POST /api/paypal-subscription-confirm
   Header: Authorization: Bearer <Firebase ID token>
   Body (JSON): { subId, ppSubscriptionId }

   Called from the browser's onApprove handler right after the PayPal
   Subscribe button reports success. We don't trust the browser's word for
   it — we look the subscription up at PayPal ourselves (server-to-server),
   confirm it's really ACTIVE and belongs to this subId's expected plan, then
   run the same fulfilment PayPal's webhook will also (idempotently) run for
   every future renewal. This is what makes access unlock instantly instead
   of waiting on webhook delivery, which can lag by several seconds. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { api } = require('./_lib/paypal');
const { activateSubscription } = require('./_lib/paypal-fulfill');
const { json, parseBody } = require('./_lib/http');

// Must match the ppPlanId mapping in paypal-subscription-start.js — used
// below to make sure the PayPal subscription being confirmed is actually
// for the plan this subId was started for, not some other real (but
// cheaper, or differently-priced) subscription the caller happens to hold.
const EXPECTED_PP_PLAN_ID = {
  monthly: process.env.PAYPAL_PLAN_MONTHLY,
  annual: process.env.PAYPAL_PLAN_ANNUAL,
  church: process.env.PAYPAL_PLAN_CHURCH,
  'church-annual': process.env.PAYPAL_PLAN_CHURCH_ANNUAL
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!configured || !db) return json(503, { error: 'Unavailable — please try again shortly.' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Please sign in.' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    return json(401, { error: 'Your session expired — please sign in again.' });
  }

  const { json: body } = parseBody(event);
  const subId = body.subId;
  const ppSubscriptionId = body.ppSubscriptionId;
  if (!subId || !ppSubscriptionId) return json(400, { error: 'Missing subscription reference.' });

  const subRef = db.collection('subscriptions').doc(String(subId));
  const subSnap = await subRef.get();
  if (!subSnap.exists) return json(404, { error: 'Subscription not found.' });
  const sub = subSnap.data();
  if (sub.uid !== uid) return json(403, { error: 'Not your subscription.' });

  // Ask PayPal directly rather than trusting the client's report.
  const { ok, data: ppSub } = await api('GET', `/v1/billing/subscriptions/${encodeURIComponent(ppSubscriptionId)}`);
  if (!ok) {
    console.error('paypal-subscription-confirm: lookup failed', subId, JSON.stringify(ppSub));
    return json(502, { error: 'Could not confirm your subscription with PayPal yet — it should unlock within a minute once payment settles.' });
  }
  // Both checks are required, not just one: custom_id ties this PayPal
  // subscription to OUR pending record, and plan_id confirms it's actually
  // for the plan that record was priced for. Either alone could be spoofed
  // by a subscription created outside our checkout flow with no custom_id
  // (or a mismatched one) or the wrong plan.
  if (!ppSub.custom_id || ppSub.custom_id !== subId) {
    return json(400, { error: 'Subscription reference mismatch.' });
  }
  const expectedPlanId = EXPECTED_PP_PLAN_ID[sub.planKey];
  if (!expectedPlanId || ppSub.plan_id !== expectedPlanId) {
    console.error('paypal-subscription-confirm: plan_id mismatch', subId, 'expected', expectedPlanId, 'got', ppSub.plan_id);
    return json(400, { error: 'Subscription plan mismatch.' });
  }
  if (ppSub.status !== 'ACTIVE') {
    return json(202, { ok: false, status: ppSub.status, note: 'Not active yet — try again shortly.' });
  }

  await subRef.set({ ppSubscriptionId, ppPlanId: ppSub.plan_id || null }, { merge: true });

  const lastPayment = ppSub.billing_info && ppSub.billing_info.last_payment;
  const amountUSD = lastPayment && lastPayment.amount ? Number(lastPayment.amount.value) : undefined;

  const result = await activateSubscription({ subId, ppEventId: 'confirm:' + ppSubscriptionId, amountUSD });
  if (!result.ok) return json(500, { error: result.reason || 'Activation failed.' });

  return json(200, { ok: true });
};
