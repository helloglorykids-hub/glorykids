/* POST /api/membership-cancel
   Header: Authorization: Bearer <Firebase ID token>

   Cancels the signed-in member's Glory Kids Membership at PayFast (no further
   billing) and flags the account. Access to member content stays until the
   period they've already paid for lapses — payfast-notify flips planStatus to
   'cancelled' when PayFast stops sending payment ITNs, or the admin can end it
   immediately from the panel. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { cancelSubscription } = require('./_lib/payfast');
const { json } = require('./_lib/http');

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

  // Newest active/pending subscription for this user
  const snap = await db.collection('subscriptions')
    .where('uid', '==', uid)
    .get();
  const subs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.status === 'active' || s.status === 'pending')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!subs.length) return json(404, { error: 'No active membership found on your account.' });
  const sub = subs[0];

  if (!sub.pfToken) {
    // First payment hasn't cleared yet — just mark it so the ITN handler ignores it.
    await db.collection('subscriptions').doc(sub.id).set({
      status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'member'
    }, { merge: true });
    return json(200, { ok: true, note: 'Your pending subscription has been stopped.' });
  }

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

  await db.collection('subscriptions').doc(sub.id).set({
    status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'member'
  }, { merge: true });

  // Keep access flagged as cancelling — the member keeps content until the
  // paid period ends (admin can hard-stop from the panel if needed).
  await db.collection('users').doc(uid).set({
    planStatus: 'cancelled', membershipCancelledAt: Date.now()
  }, { merge: true });

  await db.collection('payments').add({
    uid, email: sub.email, amount: 0, note: 'Membership cancelled by member',
    status: 'info', source: 'payfast-membership', date: Date.now()
  }).catch(() => {});

  return json(200, { ok: true });
};
