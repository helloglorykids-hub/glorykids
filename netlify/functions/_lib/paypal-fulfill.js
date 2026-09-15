/* Shared Firestore fulfilment logic for PayPal membership + shop events.
   Used by both paypal-subscription-confirm.js (instant, client-triggered
   right after checkout) and paypal-webhook.js (async, PayPal-triggered —
   renewals, cancellations, payment failures). Both call the same functions
   so a member's account ends up in the same state no matter which path
   reaches Firestore first; everything here is idempotent. */
'use strict';
const { db, FieldValue } = require('./firebase');
const { sign } = require('./tokens');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

async function mlEvent(action, sub) {
  await fetch(`${SITE}/api/mailerlite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      email: sub.email,
      name: sub.name || '',
      fields: { membership_plan: sub.planKey || 'monthly' }
    })
  }).catch(() => {});
}

async function notifyAdmin(subject, text) {
  const { notifyAdmin: send } = require('./notify');
  return send(subject, text).catch(() => {});
}

/* Marks a subscription active and flips the member's account. Safe to call
   more than once for the same payment — pass `ppEventId` (a PayPal
   transaction/capture id, or the webhook event id) and it will no-op if
   that exact event was already processed. */
async function activateSubscription({ subId, ppEventId, amountUSD }) {
  const subRef = db.collection('subscriptions').doc(String(subId));
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { ok: false, reason: 'subscription not found: ' + subId };
  const sub = subSnap.data();

  if (ppEventId && sub.lastPpEventId === ppEventId) return { ok: true, already: true, sub };

  // For quantity-priced plans (church + seats) the real billed amount lives
  // at PayPal, not in our own price fields — use it when the caller has it
  // (from the subscription/sale payload), falling back to our estimate.
  const paidUSD = amountUSD != null ? Number(amountUSD) : (sub.estimatedPriceUSD || sub.priceUSD);

  const firstPayment = sub.status !== 'active';

  await subRef.set({
    status: 'active',
    lastPpEventId: ppEventId || sub.lastPpEventId || null,
    lastPaymentAt: Date.now(),
    paymentCount: FieldValue.increment(1),
    activatedAt: sub.activatedAt || Date.now()
  }, { merge: true });

  const accountPlan = sub.plan === 'church' ? 'church' : 'glory_kids';
  const userPatch = {
    plan: accountPlan,
    planStatus: 'active',
    membershipSince: sub.activatedAt || Date.now(),
    membershipPlan: sub.planKey || 'monthly',
    paymentProvider: 'paypal',
    pastDueSince: FieldValue.delete()
  };
  if (sub.orgName) userPatch.orgName = sub.orgName;
  await db.collection('users').doc(String(sub.uid)).set(userPatch, { merge: true });

  if (accountPlan === 'church') {
    try {
      // Team size is unlimited under the current church plan ("full team
      // access") — what's metered is locations, tracked separately below.
      // seatLimit stays huge rather than removed so org.js's existing
      // seatLimit check (used elsewhere for team-member invites) never
      // blocks a real church.
      const orgRef = db.collection('orgs').doc(String(sub.uid));
      const orgSnap = await orgRef.get();
      const orgPatch = {
        ownerUid: sub.uid, ownerEmail: sub.email, orgName: sub.orgName || '',
        plan: sub.planKey || 'church', planStatus: 'active',
        locations: sub.locations || 1,
        seatLimit: 999999, updatedAt: Date.now()
      };
      if (!orgSnap.exists) { orgPatch.createdAt = Date.now(); orgPatch.memberEmails = []; }
      await orgRef.set(orgPatch, { merge: true });
      await db.collection('users').doc(String(sub.uid)).set({ orgId: sub.uid, isOrgOwner: true }, { merge: true });
    } catch (e) { console.error('org provision failed', e); }
  }

  await db.collection('payments').add({
    uid: sub.uid, email: sub.email, amount: paidUSD || 0,
    note: 'Membership' + (firstPayment ? ' — first payment' : ' — renewal') + ' (' + (sub.planKey || 'monthly') + (sub.locations ? `, ${sub.locations} locations` : '') + ')',
    status: 'paid', source: 'paypal-membership',
    subscriptionId: subId, ppSubscriptionId: sub.ppSubscriptionId || null, date: Date.now()
  }).catch(e => console.error('membership payment log failed', e));

  mlEvent(firstPayment ? 'membership-welcome' : 'purchase', sub).catch(() => {});

  if (firstPayment) {
    notifyAdmin(
      `🎉 New Glory Kids member — ${sub.email}`,
      `A new member just signed up and paid via PayPal!\n\nEmail: ${sub.email}\nPlan: ${sub.planKey || 'monthly'}${sub.orgName ? '\nOrg: ' + sub.orgName : ''}\n\nCheck the admin dashboard for details.`
    );
  }

  return { ok: true, sub };
}

/* Cancelled / suspended / payment-failed — mirrors PayFast's non-COMPLETE
   ITN branch. `status` is one of 'cancelled' | 'past_due'. */
async function deactivateSubscription({ subId, status }) {
  const subRef = db.collection('subscriptions').doc(String(subId));
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { ok: false, reason: 'subscription not found: ' + subId };
  const sub = subSnap.data();

  const cancelled = status === 'cancelled';
  const patch = { status: cancelled ? 'cancelled' : 'past_due' };
  if (!cancelled && sub.status !== 'past_due') patch.pastDueSince = Date.now();
  await subRef.set(patch, { merge: true });

  await db.collection('users').doc(String(sub.uid)).set({
    planStatus: cancelled ? 'cancelled' : 'past_due'
  }, { merge: true }).catch(() => {});

  await db.collection('payments').add({
    uid: sub.uid, email: sub.email, amount: 0,
    note: 'Membership ' + (cancelled ? 'cancelled' : 'payment failed'),
    status: cancelled ? 'info' : 'failed', source: 'paypal-membership',
    subscriptionId: subId, date: Date.now()
  }).catch(() => {});

  mlEvent(cancelled ? 'membership-cancelled' : 'membership-payment-failed', sub).catch(() => {});
  return { ok: true, sub };
}

/* Shop order fulfilment — mints download tokens, logs the payment, notifies
   admin and MailerLite. Mirrors the shop-order branch of payfast-notify.js. */
async function fulfillShopOrder({ orderId, grossUSD, ppCaptureId }) {
  const ref = db.collection('orders').doc(String(orderId));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'order not found: ' + orderId };
  const order = snap.data();

  if (order.status === 'paid') return { ok: true, already: true, order }; // idempotent

  if (Math.abs(grossUSD - Number(order.totalUSD)) > 0.01) {
    return { ok: false, reason: `amount mismatch: capture=${grossUSD} order=${order.totalUSD}` };
  }

  const tokens = (order.items || []).map(it => ({
    productId: it.productId,
    title: it.title,
    token: sign({ orderId, productId: it.productId }, 7 * 86400000)
  }));

  await ref.set({
    status: 'paid',
    paidAt: Date.now(),
    ppCaptureId: ppCaptureId || '',
    amountGrossUSD: grossUSD,
    downloadTokens: tokens
  }, { merge: true });

  await db.collection('payments').add({
    uid: order.uid || null,
    email: order.buyerEmail,
    amount: grossUSD,
    note: 'Shop: ' + (order.items || []).map(i => i.title).join(', '),
    status: 'paid',
    source: 'paypal-shop',
    orderId,
    date: Date.now()
  }).catch(e => console.error('payment log failed', e));

  notifyAdmin(
    `🛒 New order — $${grossUSD.toFixed(2)}`,
    `New shop order paid via PayPal.\n\nBuyer: ${order.buyerEmail}\nItems: ${(order.items || []).map(i => i.title).join(', ')}\nAmount: $${grossUSD.toFixed(2)}\nOrder ID: ${orderId}`
  );

  if (order.discountCode) {
    await db.collection('discountCodes').doc(order.discountCode)
      .set({ usageCount: FieldValue.increment(1) }, { merge: true }).catch(() => {});
  }

  await fetch(`${SITE}/api/mailerlite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'purchase', email: order.buyerEmail, name: order.buyerName || '' })
  }).catch(() => {});

  return { ok: true, order };
}

module.exports = { activateSubscription, deactivateSubscription, fulfillShopOrder };
