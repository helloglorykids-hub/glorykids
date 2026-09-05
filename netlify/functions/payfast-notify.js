/* POST /api/payfast-notify — PayFast ITN (Instant Transaction Notification).
   Security gates (all must pass before fulfilment):
     1. signature over the received fields matches
     2. server-to-server postback to PayFast returns VALID
     3. payment_status == COMPLETE
     4. amount_gross matches the order total (±R0.01)
   Then: mark order paid, mint download tokens, log payment, sync MailerLite.
   Always returns 200 so PayFast stops retrying (we log failures ourselves). */
'use strict';
const { db, FieldValue } = require('./_lib/firebase');
const { verifyItnSignature, serverValidate } = require('./_lib/payfast');
const { sign } = require('./_lib/tokens');
const { parseBody } = require('./_lib/http');

const ok = { statusCode: 200, body: 'OK' };
const SITE = process.env.SITE_ORIGIN || 'https://www.childrensministrylessons.com';

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

  const orderId = form.custom_str1 || form.m_payment_id;

  if (!verifyItnSignature(pairs, form.signature)) return fail(orderId, 'bad signature');
  if (!(await serverValidate(raw))) return fail(orderId, 'server validate != VALID');

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
