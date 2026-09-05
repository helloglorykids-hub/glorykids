/* GET /api/order-status?order=<id>
   Public, safe: returns only what the thank-you page needs. Download links
   are included only once the order is paid. */
'use strict';
const { db } = require('./_lib/firebase');
const { json } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.childrensministrylessons.com';

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).order;
  if (!id) return json(400, { error: 'order id required' });
  const snap = await db.collection('orders').doc(String(id)).get();
  if (!snap.exists) return json(404, { error: 'not found' });
  const o = snap.data();

  const out = {
    status: o.status,
    total: o.totalZAR,
    items: (o.items || []).map(i => ({ title: i.title })),
    email: o.buyerEmail
  };
  if (o.status === 'paid') {
    out.downloads = (o.downloadTokens || []).map(t => ({
      title: t.title,
      url: `${SITE}/api/download?token=${encodeURIComponent(t.token)}`
    }));
  }
  return json(200, out);
};
