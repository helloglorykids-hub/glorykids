/* POST /api/admin-activate-subscription
   Header: Authorization: Bearer <Firebase ID token>  (must belong to an admin)
   Body (JSON): { subId, ppSubscriptionId? }

   Manual escape hatch for a subscription stuck at status:'pending' — the
   customer paid on PayPal, but the browser closed before onApprove's confirm
   call finished AND the paypal-webhook fallback never (or hasn't yet) caught
   it either. Reuses the exact same idempotent activateSubscription() that
   the normal confirm/webhook paths call, so the member ends up in the same
   state either way — account flip, payment log entry, MailerLite sync, the
   lot — just triggered by an admin instead of PayPal.

   If given, ppSubscriptionId is saved on the subscription doc first so the
   Subscriptions tab shows "PayPal" as the provider and the record is linked
   for future reference — same as paypal-subscription-confirm.js does. */
'use strict';
const { admin, db, configured } = require('./_lib/firebase');
const { activateSubscription } = require('./_lib/paypal-fulfill');
const { json, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!configured || !db) return json(503, { error: 'Unavailable — please try again shortly.' });

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

  const { json: body } = parseBody(event);
  const subId = body && body.subId;
  const ppSubscriptionId = body && body.ppSubscriptionId;
  if (!subId) return json(400, { error: 'Missing subId.' });

  const subRef = db.collection('subscriptions').doc(String(subId));
  const subSnap = await subRef.get();
  if (!subSnap.exists) return json(404, { error: 'Subscription not found.' });

  if (ppSubscriptionId) {
    await subRef.set({ ppSubscriptionId: String(ppSubscriptionId) }, { merge: true });
  }

  const result = await activateSubscription({ subId, ppEventId: 'manual:' + adminUid + ':' + Date.now() });
  if (!result.ok) return json(500, { error: result.reason || 'Activation failed.' });

  return json(200, { ok: true });
};
