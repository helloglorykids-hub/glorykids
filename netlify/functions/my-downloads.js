/* GET /api/my-downloads   Header: Authorization: Bearer <Firebase ID token>
   Returns fresh (re-minted) download links for the signed-in user's paid
   orders — so the dashboard "My Purchases" list never shows an expired link. */
'use strict';
const { admin, db } = require('./_lib/firebase');
const { sign } = require('./_lib/tokens');
const { json } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

exports.handler = async (event) => {
  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'auth required' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    return json(401, { error: 'invalid token' });
  }

  const snap = await db.collection('orders').where('uid', '==', uid).get();
  const orders = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(o => o.status === 'paid')
    .sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))
    .map(o => ({
      id: o.id,
      date: o.paidAt || o.createdAt,
      total: o.totalZAR,
      items: (o.items || []).map(it => ({
        title: it.title,
        url: `${SITE}/api/download?token=${encodeURIComponent(sign({ orderId: o.id, productId: it.productId }, 7 * 86400000))}`
      }))
    }));

  return json(200, { orders });
};
