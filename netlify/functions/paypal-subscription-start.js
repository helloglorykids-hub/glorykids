/* POST /api/paypal-subscription-start
   Header: Authorization: Bearer <Firebase ID token>
   Body (JSON): { plan: 'monthly' | 'church', locations? }

   PayPal Subscriptions are created CLIENT-SIDE (the PayPal JS SDK button
   calls actions.subscription.create({ plan_id }) itself — there's no signed
   field set to build server-side like PayFast). This endpoint's job is just
   the part that has to stay server-authoritative: verify the signed-in user,
   check the membership-live gate, price the plan, and create a `pending`
   subscriptions/{id} doc. It returns the PayPal plan_id to render the button
   with and our own subId, which the browser passes back as `custom_id` on
   the PayPal subscription — that's what ties the two records together in
   paypal-subscription-confirm.js.

   Church is quantity-priced by LOCATION, not by team member: $59/mo
   covers one church location with unlimited team members there; each
   additional location is +$20/mo. That tier pricing lives inside the
   PayPal Plan itself (configured in the PayPal dashboard, not here) —
   `quantity` is what tells PayPal which tier price to bill. We pass
   `locations` straight through as `quantity` and treat PayPal's own
   reported subscription amount as the source of truth rather than
   re-deriving it here, since we can't see their tier table.
   IMPORTANT: the USD constants below only drive the pre-checkout estimate
   shown in our own UI — they do NOT control what PayPal actually charges.
   The live PayPal Plan (see _lib/paypal-plan-ids.js) must be updated (or
   replaced) on PayPal's dashboard to match, or the estimate and the real
   charge will disagree.

   No annual church plan — removed 2026-10-08 along with the individual
   annual plan, for the same reason (monthly income, not a lump sum). */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');
const PP_PLAN_IDS = require('./_lib/paypal-plan-ids');

const MONTHLY_USD = Number(process.env.MEMBERSHIP_MONTHLY_USD) || 29.99;
const CHURCH_MONTHLY_USD = Number(process.env.CHURCH_MONTHLY_USD) || 59;
const CHURCH_PER_LOCATION_MONTHLY_USD = Number(process.env.CHURCH_PER_LOCATION_MONTHLY_USD) || 20;
const CHURCH_BASE_LOCATIONS = 1;
// Safety gate: keep this unset (or not "true") until membership billing is live.
const MEMBERSHIP_LIVE = String(process.env.MEMBERSHIP_LIVE || '').toLowerCase() === 'true';

const PLANS = {
  monthly:       { frequency: 'monthly', usd: MONTHLY_USD,       label: 'Glory Kids Membership — Monthly', accountPlan: 'glory_kids', ppPlanId: PP_PLAN_IDS.monthly },
  church:        { frequency: 'monthly', usd: CHURCH_MONTHLY_USD, perLocationUsd: CHURCH_PER_LOCATION_MONTHLY_USD, label: 'Glory Kids for Churches — Monthly', accountPlan: 'church', ppPlanId: PP_PLAN_IDS.church, quantityPriced: true }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!configured || !db) return json(503, { error: 'Membership is temporarily unavailable. Please try again shortly.' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Please sign in to subscribe.' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    return json(401, { error: 'Your session expired — please sign in again.' });
  }
  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase();
  if (!email) return json(400, { error: 'Your account has no email address.' });

  const userSnap = await db.collection('users').doc(uid).get();
  const userRec = userSnap.exists ? userSnap.data() : {};
  const isAdmin = userRec.isAdmin === true;
  if (!MEMBERSHIP_LIVE && !isAdmin) {
    return json(403, { error: 'Membership isn’t open yet — join the waitlist and we’ll email you the moment it launches.' });
  }
  if ((userRec.plan === 'glory_kids' || userRec.plan === 'church') && userRec.planStatus === 'active') {
    return json(409, { error: 'You already have an active membership.', already: true });
  }

  const { json: body } = parseBody(event);
  const planKey = (body.plan || 'monthly').toLowerCase();
  const plan = PLANS[planKey];
  if (!plan) return json(400, { error: 'That plan isn’t available yet.' });
  if (!plan.ppPlanId) {
    console.error('paypal-subscription-start: missing PAYPAL_PLAN_* env for', planKey);
    return json(503, { error: 'Membership checkout is being set up — please try again shortly.' });
  }

  const name = (decoded.name || userRec.displayName || '').trim();
  const orgName = plan.accountPlan === 'church' ? String(body.orgName || '').trim().slice(0, 120) : '';
  if (plan.accountPlan === 'church' && !orgName) {
    return json(400, { error: 'Please tell us your church or ministry name.' });
  }

  let quantity = 1;
  let estimatedUsd = plan.usd;
  if (plan.quantityPriced) {
    const locations = Math.max(CHURCH_BASE_LOCATIONS, Math.round(Number(body.locations) || CHURCH_BASE_LOCATIONS));
    quantity = locations;
    const extraLocations = Math.max(0, locations - CHURCH_BASE_LOCATIONS);
    estimatedUsd = plan.usd + extraLocations * plan.perLocationUsd;
  }

  const subRef = db.collection('subscriptions').doc();
  await subRef.set({
    uid,
    email,
    name,
    orgName,
    plan: plan.accountPlan,
    planKey,
    frequency: plan.frequency,
    priceUSD: plan.usd,
    estimatedPriceUSD: estimatedUsd,
    locations: plan.quantityPriced ? quantity : null,
    provider: 'paypal',
    status: 'pending',
    createdAt: Date.now()
  });

  return json(200, {
    subId: subRef.id,
    ppPlanId: plan.ppPlanId,
    quantity,
    priceUSD: plan.usd,
    estimatedUsd,
    frequency: plan.frequency
  });
};
