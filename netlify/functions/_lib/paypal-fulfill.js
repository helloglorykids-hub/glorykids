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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Customer-facing receipt + download links, sent the moment an order is
   marked paid. This is the buyer's only durable copy of their download
   links if they close the thank-you page before it loads — it must never
   depend on anything client-side. */
async function sendReceiptEmail(order, tokens) {
  const { sendMail } = require('./notify');
  const rows = tokens.map(t =>
    `<li style="margin:0 0 .6rem;"><a href="${SITE}/api/download?token=${encodeURIComponent(t.token)}" style="color:#66249A;font-weight:700;">${escapeHtml(t.title)}</a></li>`
  ).join('');
  const html = `
    <div style="font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <h1 style="font-size:1.3rem;">Thank you for your order! 🎉</h1>
      <p>Here ${tokens.length === 1 ? 'is your download link' : 'are your download links'}:</p>
      <ul style="padding-left:1.1rem;">${rows}</ul>
      <p style="color:#6b7280;font-size:.9rem;">Each link works for 7 days from today. Lost this email? Re-download anytime from your <a href="${SITE}/dashboard.html">dashboard</a> if you're signed in, or contact us and we'll resend it.</p>
      <p style="color:#6b7280;font-size:.9rem;">Order ID: ${order.orderId || ''}</p>
    </div>`;
  const text = `Thank you for your order!\n\n${tokens.map(t => t.title + ': ' + SITE + '/api/download?token=' + t.token).join('\n')}\n\nEach link works for 7 days. Re-download anytime from your dashboard if signed in, or contact us to have it resent.`;
  return sendMail({ to: order.buyerEmail, subject: 'Your Glory Kids order — download links inside', html, text }).catch(() => {});
}

/* Marks a subscription active and flips the member's account. Safe to call
   more than once for the same payment — pass `ppEventId` (a PayPal
   transaction/capture id, or the webhook event id) and it will no-op the
   payment-recording side effects if that exact event was already processed.

   The FIRST payment reaches us three separate ways — the instant client-side
   confirm, PayPal's BILLING.SUBSCRIPTION.ACTIVATED webhook, and its
   PAYMENT.SALE.COMPLETED webhook — each carrying its own distinct event id,
   so a plain lastPpEventId match can't catch two of the three. Renewals only
   ever arrive once, via PAYMENT.SALE.COMPLETED, where the event id IS a
   reliable dedupe key. So: dedupe the first payment on a one-time
   `firstPaymentRecorded` flag instead, and dedupe renewals on ppEventId as
   before — both decided atomically in one transaction so two near-
   simultaneous calls can't both see themselves as "the" new event. */
async function activateSubscription({ subId, ppEventId, amountUSD }) {
  const subRef = db.collection('subscriptions').doc(String(subId));

  let sub, isNewEvent, firstPayment;
  await db.runTransaction(async (tx) => {
    const subSnap = await tx.get(subRef);
    if (!subSnap.exists) { sub = null; return; }
    sub = subSnap.data();
    firstPayment = sub.status !== 'active';
    isNewEvent = firstPayment
      ? !sub.firstPaymentRecorded
      : !(ppEventId && sub.lastPpEventId === ppEventId);

    const patch = {
      status: 'active',
      lastPpEventId: ppEventId || sub.lastPpEventId || null,
      lastPaymentAt: Date.now(),
      activatedAt: sub.activatedAt || Date.now()
    };
    if (isNewEvent) patch.paymentCount = FieldValue.increment(1);
    if (firstPayment) patch.firstPaymentRecorded = true;
    tx.set(subRef, patch, { merge: true });
  });
  if (!sub) return { ok: false, reason: 'subscription not found: ' + subId };

  // For quantity-priced plans (church + seats) the real billed amount lives
  // at PayPal, not in our own price fields — use it when the caller has it
  // (from the subscription/sale payload), falling back to our estimate.
  const paidUSD = amountUSD != null ? Number(amountUSD) : (sub.estimatedPriceUSD || sub.priceUSD);

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

  // Everything above (account flip, org provisioning) is idempotent and
  // re-runs on every call so access unlocks instantly no matter which
  // trigger wins the race. Everything below records the payment itself —
  // gate it on isNewEvent so a duplicate trigger for the same charge
  // doesn't log it twice or send duplicate emails.
  if (!isNewEvent) return { ok: true, already: true, sub };

  await db.collection('payments').add({
    uid: sub.uid, email: sub.email, amount: paidUSD || 0,
    note: 'Membership' + (firstPayment ? ' — first payment' : ' — renewal') + ' (' + (sub.planKey || 'monthly') + (sub.locations ? `, ${sub.locations} locations` : '') + ')',
    status: 'paid', source: 'paypal-membership',
    subscriptionId: subId, ppSubscriptionId: sub.ppSubscriptionId || null, date: Date.now()
  }).catch(e => console.error('membership payment log failed', e));

  // Netlify/Lambda can freeze or tear down the function process as soon as
  // the handler's response is sent — an un-awaited background fetch/send
  // here can get killed mid-flight with no error logged anywhere, which is
  // exactly what was silently dropping the welcome email and MailerLite
  // signup. Await both so they finish before this function returns.
  await mlEvent(firstPayment ? 'membership-welcome' : 'purchase', sub).catch(() => {});

  if (firstPayment) {
    await notifyAdmin(
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

  await mlEvent(cancelled ? 'membership-cancelled' : 'membership-payment-failed', sub).catch(() => {});
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

  // Both awaited for the same reason as activateSubscription() above —
  // Netlify/Lambda can freeze this process the instant the handler
  // returns, silently killing any un-awaited background send in flight.
  await notifyAdmin(
    `🛒 New order — $${grossUSD.toFixed(2)}`,
    `New shop order paid via PayPal.\n\nBuyer: ${order.buyerEmail}\nItems: ${(order.items || []).map(i => i.title).join(', ')}\nAmount: $${grossUSD.toFixed(2)}\nOrder ID: ${orderId}`
  );

  await sendReceiptEmail(Object.assign({ orderId }, order), tokens);

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
