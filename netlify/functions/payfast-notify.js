/* POST /api/payfast-notify — PayFast ITN (Instant Transaction Notification).
   Handles BOTH shop orders and membership subscriptions (told apart by
   custom_str2 / the presence of a subscription `token`).
   Security gates (all must pass before fulfilment):
     1. signature over the received fields matches
     2. server-to-server postback to PayFast returns VALID
     3. payment_status == COMPLETE
     4. amount_gross matches the expected total (±R0.01)
   Always returns 200 so PayFast stops retrying (we log failures ourselves). */
'use strict';
const { db, FieldValue } = require('./_lib/firebase');
const { verifyItnSignature, serverValidate } = require('./_lib/payfast');
const { sign } = require('./_lib/tokens');
const { parseBody } = require('./_lib/http');

const ok = { statusCode: 200, body: 'OK' };
const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

async function fail(orderId, reason, extra) {
  console.error('payfast-notify REJECTED:', reason, extra || '');
  if (orderId) {
    await db.collection('orders').doc(orderId).set({
      lastItnError: reason, lastItnAt: Date.now()
    }, { merge: true }).catch(() => {});
  }
  return ok;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return ok;
  const { form, pairs, raw } = parseBody(event);
  if (!form) return fail(null, 'no form body');

  const isMembership = form.custom_str2 === 'membership' || form.subscription_type === '1';
  const failId = isMembership ? null : (form.custom_str1 || form.m_payment_id);

  if (!verifyItnSignature(pairs, form.signature)) return fail(failId, 'bad signature');
  if (!(await serverValidate(raw))) return fail(failId, 'server validate != VALID');

  if (isMembership) return handleMembership(form);

  const orderId = form.custom_str1 || form.m_payment_id;
  const ref = db.collection('orders').doc(String(orderId));
  const snap = await ref.get();
  if (!snap.exists) return fail(orderId, 'order not found');
  const order = snap.data();

  if (order.status === 'paid') return ok; // idempotent — PayFast may resend

  if (form.payment_status !== 'COMPLETE') {
    await ref.set({ status: form.payment_status === 'FAILED' ? 'failed' : order.status, pfStatus: form.payment_status }, { merge: true });
    return ok;
  }

  const gross = Number(form.amount_gross);
  if (Math.abs(gross - Number(order.totalZAR)) > 0.01) {
    return fail(orderId, 'amount mismatch', `itn=${gross} order=${order.totalZAR}`);
  }

  // Mint a download token per item (7-day life; re-mintable from the dashboard).
  const tokens = (order.items || []).map(it => ({
    productId: it.productId,
    title: it.title,
    token: sign({ orderId, productId: it.productId }, 7 * 86400000)
  }));

  await ref.set({
    status: 'paid',
    paidAt: Date.now(),
    pfPaymentId: form.pf_payment_id || '',
    pfStatus: 'COMPLETE',
    amountGrossZAR: gross,
    downloadTokens: tokens
  }, { merge: true });

  // Log to the existing payments collection (Admin panel Payments tab).
  await db.collection('payments').add({
    uid: order.uid || null,
    email: order.buyerEmail,
    amount: gross,
    note: 'Shop: ' + (order.items || []).map(i => i.title).join(', '),
    status: 'paid',
    source: 'payfast-shop',
    orderId,
    date: Date.now()
  }).catch(e => console.error('payment log failed', e));

  // Bump discount usage
  if (order.discountCode) {
    await db.collection('discountCodes').doc(order.discountCode)
      .set({ usageCount: FieldValue.increment(1) }, { merge: true }).catch(() => {});
  }

  // Fire MailerLite (customer group + receipt) — best effort.
  try {
    const links = tokens.map(t => `${SITE}/api/download?token=${encodeURIComponent(t.token)}`);
    await fetch(`${SITE}/api/mailerlite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'purchase',
        email: order.buyerEmail,
        name: order.buyerName || '',
        fields: {
          last_order_total: gross,
          last_order_items: (order.items || []).map(i => i.title).join(', ')
        },
        downloadLinks: links
      })
    });
  } catch (e) { console.error('mailerlite sync failed', e); }

  return ok;
};

/* ─── Membership subscription ITN ──────────────────────────────────────
   Fires on the first payment AND on every recurring payment (same
   notify_url, same m_payment_id + token). Also fires on cancellation /
   failed renewals with a non-COMPLETE payment_status. */
async function handleMembership(form) {
  const subId = form.m_payment_id;
  const uid = form.custom_str1;
  if (!subId || !uid) return fail(null, 'membership ITN missing ids');

  const subRef = db.collection('subscriptions').doc(String(subId));
  const subSnap = await subRef.get();
  if (!subSnap.exists) return fail(null, 'subscription not found: ' + subId);
  const sub = subSnap.data();

  const status = form.payment_status;
  const token = form.token || sub.pfToken || '';
  const gross = Number(form.amount_gross || 0);

  // Non-payment notifications (cancelled at PayFast, failed renewal, etc.)
  if (status && status !== 'COMPLETE') {
    const cancelled = /CANCELL?ED/i.test(status);
    await subRef.set({
      status: cancelled ? 'cancelled' : 'past_due',
      pfStatus: status, pfToken: token, lastItnAt: Date.now()
    }, { merge: true });
    await db.collection('users').doc(String(uid)).set({
      planStatus: cancelled ? 'cancelled' : 'past_due'
    }, { merge: true }).catch(() => {});
    await db.collection('payments').add({
      uid, email: sub.email, amount: gross || 0,
      note: 'Membership ' + (cancelled ? 'cancelled' : 'payment ' + status.toLowerCase()),
      status: cancelled ? 'info' : 'failed', source: 'payfast-membership',
      subscriptionId: subId, date: Date.now()
    }).catch(() => {});
    return ok;
  }

  if (status !== 'COMPLETE') return ok;

  // Amount check — allow the initial and recurring amounts (they're equal here).
  const expected = Number(sub.priceZAR);
  if (expected && Math.abs(gross - expected) > 0.01) {
    return fail(null, 'membership amount mismatch', `itn=${gross} sub=${expected}`);
  }

  const pfPaymentId = form.pf_payment_id || '';
  const firstPayment = sub.status !== 'active';

  // Idempotency — PayFast can resend the same ITN.
  if (sub.lastPfPaymentId && sub.lastPfPaymentId === pfPaymentId) return ok;

  await subRef.set({
    status: 'active',
    pfToken: token,
    lastPfPaymentId: pfPaymentId,
    lastPaymentAt: Date.now(),
    lastPaymentZAR: gross,
    paymentCount: FieldValue.increment(1),
    activatedAt: sub.activatedAt || Date.now(),
    lastItnAt: Date.now()
  }, { merge: true });

  // Flip the user record — this is what unlocks the dashboard + gated lessons.
  var accountPlan = (sub.plan === 'church') ? 'church' : 'glory_kids';
  var userPatch = {
    plan: accountPlan,
    planStatus: 'active',
    membershipSince: sub.activatedAt || Date.now(),
    membershipPlan: sub.planKey || 'monthly',
    pfSubscriptionToken: token
  };
  if (sub.orgName) userPatch.orgName = sub.orgName;
  await db.collection('users').doc(String(uid)).set(userPatch, { merge: true });

  await db.collection('payments').add({
    uid, email: sub.email, amount: gross,
    note: 'Membership' + (firstPayment ? ' — first payment' : ' — renewal') + ' (' + (sub.planKey || 'monthly') + ')',
    status: 'paid', source: 'payfast-membership',
    subscriptionId: subId, pfPaymentId, date: Date.now()
  }).catch(e => console.error('membership payment log failed', e));

  // MailerLite — add to the customers/members group; move off the waitlist.
  try {
    await fetch(`${SITE}/api/mailerlite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'purchase',
        email: sub.email,
        name: sub.name || '',
        fields: { membership_plan: sub.planKey || 'monthly', membership_status: 'active' }
      })
    });
  } catch (e) { console.error('mailerlite membership sync failed', e); }

  return ok;
}
