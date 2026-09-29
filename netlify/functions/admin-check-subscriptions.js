/* POST /api/admin-check-subscriptions
   Header: Authorization: Bearer <Firebase ID token>  (must belong to an admin)

   Cross-checks every subscription we think is 'active' or 'past_due' against
   PayPal's own record of it. Exists because a PayPal subscription can be
   quietly EXPIRED, CANCELLED or SUSPENDED on PayPal's side — most commonly
   because a Plan was misconfigured with a fixed cycle count instead of
   "until cancelled" (annual plans have hit this) — while our Firestore doc
   still says active, since nothing here ever told us otherwise. Renewal
   silently not happening looks identical to renewal succeeding until the
   member's access lapses with no warning.

   Read-only against PayPal (GET only) and non-destructive against Firestore:
   it never flips our own status/access, only records what PayPal reports
   (ppRealStatus, ppRealStatusCheckedAt) so the admin can see and decide. */
'use strict';
const { admin, db } = require('./_lib/firebase');
const { api } = require('./_lib/paypal');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!db) return json(503, { error: 'Unavailable — please try again shortly.' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Please sign in.' });

  let adminUid;
  try {
    adminUid = (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    return json(401, { error: 'Your session expired — please sign in again.' });
  }
  const callerRec = (await db.collection('users').doc(adminUid).get()).data();
  if (!callerRec || callerRec.isAdmin !== true) return json(403, { error: 'Admins only.' });

  const snap = await db.collection('subscriptions')
    .where('status', 'in', ['active', 'past_due'])
    .get();

  const results = [];
  for (const doc of snap.docs) {
    const sub = doc.data();
    if (!sub.ppSubscriptionId) continue; // legacy PayFast or never-linked — nothing to check
    let realStatus = null;
    try {
      const { ok, data } = await api('GET', `/v1/billing/subscriptions/${encodeURIComponent(sub.ppSubscriptionId)}`);
      realStatus = ok ? data.status : ('lookup-failed:' + (data.name || 'unknown'));
    } catch (e) {
      realStatus = 'lookup-error';
    }
    await doc.ref.set({ ppRealStatus: realStatus, ppRealStatusCheckedAt: Date.now() }, { merge: true }).catch(() => {});
    const mismatch = !realStatus || !realStatus.startsWith('lookup') ? realStatus !== 'ACTIVE' : true;
    results.push({ id: doc.id, email: sub.email, planKey: sub.planKey, ourStatus: sub.status, ppRealStatus: realStatus, mismatch });
  }

  return json(200, { ok: true, checked: results.length, mismatches: results.filter(r => r.mismatch), all: results });
};
