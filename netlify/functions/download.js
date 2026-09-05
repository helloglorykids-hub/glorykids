/* GET /api/download?token=…
   Validates a signed token, confirms the order is paid and contains the
   product, then redirects to a short-lived signed Storage URL. */
'use strict';
const { db, bucket } = require('./_lib/firebase');
const { verify } = require('./_lib/tokens');
const { text } = require('./_lib/http');

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token;
  const payload = verify(token);
  if (!payload || !payload.orderId || !payload.productId) return text(403, 'Invalid or expired link.');

  const orderSnap = await db.collection('orders').doc(payload.orderId).get();
  if (!orderSnap.exists) return text(404, 'Order not found.');
  const order = orderSnap.data();
  if (order.status !== 'paid') return text(403, 'This order is not paid.');
  if (!(order.items || []).some(i => i.productId === payload.productId)) {
    return text(403, 'Product not part of this order.');
  }

  const prodSnap = await db.collection('products').doc(payload.productId).get();
  if (!prodSnap.exists || !prodSnap.data().storagePath) return text(404, 'File unavailable.');
  const storagePath = prodSnap.data().storagePath;

  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 10 * 60 * 1000, // 10 minutes
    responseDisposition: `attachment; filename="${(prodSnap.data().title || 'download').replace(/[^\w.\- ]/g, '')}.pdf"`
  });

  // Best-effort download counter
  db.collection('orders').doc(payload.orderId).set({
    downloadCount: (order.downloadCount || 0) + 1, lastDownloadAt: Date.now()
  }, { merge: true }).catch(() => {});

  return { statusCode: 302, headers: { Location: url }, body: '' };
};
