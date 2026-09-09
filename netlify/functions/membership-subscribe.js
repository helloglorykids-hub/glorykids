/* POST /api/membership-subscribe
   Header: Authorization: Bearer <Firebase ID token>
   Body (JSON): { plan: 'monthly' | 'annual' }

   Starts a Glory Kids Membership subscription. Verifies the signed-in user,
   prices the plan server-side (USD reference × USD_ZAR_RATE — PayFast settles
   in ZAR), creates a `pending` subscriptions/{id} doc, and returns the signed
   PayFast recurring-billing field set for the browser to POST.

   Fulfilment (marking the user `plan: glory_kids`) happens in payfast-notify
   when PayFast confirms the first payment. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { buildSubscription } = require('./_lib/payfast');
const { json, parseBody } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';
const USD_ZAR_RATE = Number(process.env.USD_ZAR_RATE) || 18.5;
const MONTHLY_USD = Number(process.env.MEMBERSHIP_MONTHLY_USD) || 29.99;
const ANNUAL_USD = Number(process.env.MEMBERSHIP_ANNUAL_USD) || 249;
const CHURCH_SMALL_USD = Number(process.env.CHURCH_SMALL_USD) || 499;
const CHURCH_GROWING_USD = Number(process.env.CHURCH_GROWING_USD) || 899;
// Safety gate: keep this unset (or not "true") until membership billing is live.
// Admins always bypass it so the flow can be tested end-to-end beforehand.
const MEMBERSHIP_LIVE = String(process.env.MEMBERSHIP_LIVE || '').toLowerCase() === 'true';

const usdToZar = usd => Math.round(usd * USD_ZAR_RATE * 100) / 100;

const PLANS = {
  monthly:         { frequency: 'monthly', usd: MONTHLY_USD,        label: 'Glory Kids Membership — Monthly', accountPlan: 'glory_kids' },
  annual:          { frequency: 'annual',  usd: ANNUAL_USD,         label: 'Glory Kids Membership — Annual',  accountPlan: 'glory_kids' },
  'church-small':  { frequency: 'annual',  usd: CHURCH_SMALL_USD,   label: 'Glory Kids for Churches — Small Church',   accountPlan: 'church' },
  'church-growing':{ frequency: 'annual',  usd: CHURCH_GROWING_USD, label: 'Glory Kids for Churches — Growing Church', accountPlan: 'church' }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!configured || !db) return json(503, { error: 'Membership is temporarily unavailable. Please try again shortly.' });

  // ── Auth ──────────────────────────────────────────────────────────
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

  // ── Gate ──────────────────────────────────────────────────────────
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
  if (!plan) return json(400, { error: 'Unknown plan.' });

  const priceZAR = usdToZar(plan.usd);
  if (priceZAR < 5) return json(400, { error: 'Plan price is below PayFast’s minimum.' });

  const name = (decoded.name || userRec.displayName || '').trim();
  const orgName = plan.accountPlan === 'church' ? String(body.orgName || '').trim().slice(0, 120) : '';
  if (plan.accountPlan === 'church' && !orgName) {
    return json(400, { error: 'Please tell us your church or ministry name.' });
  }

  // ── Pending subscription record ───────────────────────────────────
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
    priceZAR,
    fxRateUsdZar: USD_ZAR_RATE,
    status: 'pending',
    createdAt: Date.now()
  });

  const { fields, processUrl } = buildSubscription({
    return_url: `${SITE}/dashboard.html?welcome=member`,
    cancel_url: `${SITE}/glory-kids-membership.html?checkout=cancelled`,
    notify_url: `${SITE}/api/payfast-notify`,
    name_first: name.split(' ')[0] || '',
    email_address: email,
    m_payment_id: subRef.id,
    amount: priceZAR,
    recurring_amount: priceZAR,
    frequency: plan.frequency,
    item_name: plan.label,
    item_description: `${plan.label} — billed ${plan.frequency}, cancel anytime`,
    custom_str1: uid,
    custom_str2: 'membership'
  });

  return json(200, {
    subscriptionId: subRef.id,
    processUrl,
    fields,
    priceZAR,
    priceUSD: plan.usd,
    frequency: plan.frequency
  });
};
