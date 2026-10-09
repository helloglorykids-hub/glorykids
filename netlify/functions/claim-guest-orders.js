/* POST /api/claim-guest-orders   Header: Authorization: Bearer <Firebase ID token>
   Called right after a guest buyer creates an account from the thank-you
   page. Attaches every past guest order (uid-less, matched by email) to
   their new uid, so "My Purchases" shows their full history immediately —
   not just the order they just paid for. */
'use strict';
const { db, admin } = require('./_lib/firebase');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'auth required' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    return json(401, { error: 'invalid token' });
  }
  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase();
  if (!email) return json(400, { error: 'account has no email on file' });

  const snap = await db.collection('orders')
    .where('buyerEmail', '==', email)
    .where('uid', '==', null)
    .get();

  if (snap.empty) return json(200, { ok: true, claimed: 0 });

  const batch = db.batch();
  snap.forEach(doc => batch.set(doc.ref, { uid }, { merge: true }));
  await batch.commit();

  return json(200, { ok: true, claimed: snap.size });
};
