/* POST /api/membership-cancel
   Header: Authorization: Bearer <Firebase ID token>

   Cancels the signed-in member's Glory Kids Membership (no further billing)
   and flags the account. Access to member content stays until the period
   they've already paid for lapses — the relevant provider's webhook flips
   planStatus to 'cancelled' once billing actually stops, or the admin can
   end it immediately from the panel.

   Branches on how the subscription was billed: `pfToken` means it's a
   PayFast subscription (legacy — no new signups go through PayFast), and
   `ppSubscriptionId` means PayPal. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { cancelSubscription } = require('./_lib/payfast');
const { api: paypalApi } = require('./_lib/paypal');
const { json, parseBody } = require('./_lib/http');

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
  const adminSubId = body && body.subscriptionId;

  let sub;
  if (adminSubId) {
    // Admin cancelling someone else's subscription from the panel.
    const callerRec = (await db.collection('users').doc(uid).get()).data();
    if (!callerRec || callerRec.isAdmin !== true) return json(403, { error: 'Admins only.' });
    const s = await db.collection('subscriptions').doc(String(adminSubId)).get();
    if (!s.exists) return json(404, { error: 'Subscription not found.' });
    sub = { id: s.id, ...s.data() };
    uid = sub.uid;  // act on the member's account below
  } else {
    const snap = await db.collection('subscriptions').where('uid', '==', uid).get();
    const subs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status === 'active' || s.status === 'pending' || s.status === 'past_due')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!subs.length) return json(404, { error: 'No active membership found on your account.' });
    sub = subs[0];
  }

  if (!sub.pfToken && !sub.ppSubscriptionId) {
    // First payment hasn't cleared yet — just mark it so the notify/webhook
    // handler ignores it whenever it does show up.
    await db.collection('subscriptions').doc(sub.id).set({
      status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'member'
    }, { merge: true });
    return json(200, { ok: true, note: 'Your pending subscription has been stopped.' });
  }

  if (sub.ppSubscriptionId) {
    const r = await paypalApi('POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.ppSubscriptionId)}/cancel`, {
      reason: 'Cancelled by ' + (adminSubId ? 'admin' : 'member')
    });
    // PayPal returns 204 No Content on success; also treat "already cancelled" as success.
    if (!r.ok && r.status !== 404) {
      console.error('membership-cancel: PayPal API cancel failed', sub.id, JSON.stringify(r.data));
      await db.collection('subscriptions').doc(sub.id).set({
        cancelRequestedAt: Date.now(), lastCancelError: JSON.stringify(r.data).slice(0, 500)
      }, { merge: true });
      await db.collection('tickets').add({
        name: sub.name || 'Member', email: sub.email,
        message: `Automatic membership cancellation failed for subscription ${sub.id} (PayPal subscription ${sub.ppSubscriptionId}). Please cancel it in the PayPal dashboard.`,
        transcript: [], status: 'open', source: 'membership-cancel', createdAt: Date.now()
      }).catch(() => {});
      return json(502, { error: 'We couldn’t cancel automatically. Our team has been notified and will confirm your cancellation by email within one business day.' });
    }
  } else {
    const r = await cancelSubscription(sub.pfToken);
    if (!r.ok) {
      console.error('membership-cancel: PayFast API cancel failed', sub.id, JSON.stringify(r.data));
      // Record the request and raise a ticket so support can finish it manually.
      await db.collection('subscriptions').doc(sub.id).set({
        cancelRequestedAt: Date.now(), lastCancelError: (r.data && (r.data.data && r.data.data.response || r.data.raw)) || 'unknown'
      }, { merge: true });
      await db.collection('tickets').add({
        name: sub.name || 'Member', email: sub.email,
        message: `Automatic membership cancellation failed for subscription ${sub.id} (token ${sub.pfToken}). Please cancel it in the PayFast dashboard.`,
        transcript: [], status: 'open', source: 'membership-cancel', createdAt: Date.now()
      }).catch(() => {});
      return json(502, { error: 'We couldn’t cancel automatically. Our team has been notified and will confirm your cancellation by email within one business day.' });
    }
  }

  const by = adminSubId ? 'admin' : 'member';
  await db.collection('subscriptions').doc(sub.id).set({
    status: 'cancelled', cancelledAt: Date.now(), cancelledBy: by
  }, { merge: true });

  // Keep access flagged as cancelling — the member keeps content until the
  // paid period ends (admin can hard-stop from the panel if needed).
  await db.collection('users').doc(uid).set({
    planStatus: 'cancelled', membershipCancelledAt: Date.now()
  }, { merge: true });

  // Church subscription → wind the org down so seated members lose access.
  if (sub.plan === 'church') {
    await db.collection('orgs').doc(String(uid)).set({ planStatus: 'cancelled', updatedAt: Date.now() }, { merge: true }).catch(() => {});
  }

  await db.collection('payments').add({
    uid, email: sub.email, amount: 0, note: 'Membership cancelled by ' + by,
    status: 'info', source: sub.ppSubscriptionId ? 'paypal-membership' : 'payfast-membership', date: Date.now()
  }).catch(() => {});

  return json(200, { ok: true });
};
