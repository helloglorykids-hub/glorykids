/* POST /api/paypal-subscription-start
   Header: Authorization: Bearer <Firebase ID token>
   Body (JSON): { plan: 'monthly' | 'annual' | 'church' | 'church-annual', locations? }

   PayPal Subscriptions are created CLIENT-SIDE (the PayPal JS SDK button
   calls actions.subscription.create({ plan_id }) itself — there's no signed
   field set to build server-side like PayFast). This endpoint's job is just
   the part that has to stay server-authoritative: verify the signed-in user,
   check the membership-live gate, price the plan, and create a `pending`
   subscriptions/{id} doc. It returns the PayPal plan_id to render the button
   with and our own subId, which the browser passes back as `custom_id` on
   the PayPal subscription — that's what ties the two records together in
   paypal-subscription-confirm.js.

   Church is quantity-priced by LOCATION, not by team member: $79/mo (or
   $799/yr) covers one church location with unlimited team members there;
   each additional location is +$49/mo. That tier pricing lives inside the
   PayPal Plan itself (configured in the PayPal dashboard, not here) —
   `quantity` is what tells PayPal which tier price to bill. We pass
   `locations` straight through as `quantity` and treat PayPal's own
   reported subscription amount as the source of truth rather than
   re-deriving it here, since we can't see their tier table. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');

const MONTHLY_USD = Number(process.env.MEMBERSHIP_MONTHLY_USD) || 29.99;
const ANNUAL_USD = Number(process.env.MEMBERSHIP_ANNUAL_USD) || 299;
const CHURCH_MONTHLY_USD = Number(process.env.CHURCH_MONTHLY_USD) || 79;
const CHURCH_ANNUAL_USD = Number(process.env.CHURCH_ANNUAL_USD) || 799;
const CHURCH_PER_LOCATION_MONTHLY_USD = Number(process.env.CHURCH_PER_LOCATION_MONTHLY_USD) || 49;
const CHURCH_PER_LOCATION_ANNUAL_USD = Number(process.env.CHURCH_PER_LOCATION_ANNUAL_USD) || 588; // 49*12, no annual discount confirmed yet
const CHURCH_BASE_LOCATIONS = 1;
// Safety gate: keep this unset (or not "true") until membership billing is live.
const MEMBERSHIP_LIVE = String(process.env.MEMBERSHIP_LIVE || '').toLowerCase() === 'true';

const PLANS = {
  monthly:       { frequency: 'monthly', usd: MONTHLY_USD,       label: 'Glory Kids Membership — Monthly', accountPlan: 'glory_kids', ppPlanId: process.env.PAYPAL_PLAN_MONTHLY },
  annual:        { frequency: 'annual',  usd: ANNUAL_USD,        label: 'Glory Kids Membership — Annual',  accountPlan: 'glory_kids', ppPlanId: process.env.PAYPAL_PLAN_ANNUAL },
  church:        { frequency: 'monthly', usd: CHURCH_MONTHLY_USD, perLocationUsd: CHURCH_PER_LOCATION_MONTHLY_USD, label: 'Glory Kids for Churches — Monthly', accountPlan: 'church', ppPlanId: process.env.PAYPAL_PLAN_CHURCH, quantityPriced: true },
  'church-annual': { frequency: 'annual', usd: CHURCH_ANNUAL_USD, perLocationUsd: CHURCH_PER_LOCATION_ANNUAL_USD, label: 'Glory Kids for Churches — Annual',  accountPlan: 'church', ppPlanId: process.env.PAYPAL_PLAN_CHURCH_ANNUAL, quantityPriced: true }
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
