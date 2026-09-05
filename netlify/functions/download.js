/* GET /api/download?token=…[&f=<index>]
   Validates a signed token, confirms the order is paid and contains the
   product, then:
     - single-file product  → 302 redirect to a 10-min signed Storage URL
     - multi-file product    → a small HTML page listing a signed link per file
                               (or, with &f=N, redirects straight to file N) */
'use strict';
const { db, bucket } = require('./_lib/firebase');
const { verify } = require('./_lib/tokens');
const { text } = require('./_lib/http');

const TEN_MIN = 10 * 60 * 1000;
const clean = s => String(s || 'download').replace(/[^\w.\- ]/g, '').trim() || 'download';

async function signedUrl(path, filename) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: 'read',
    expires: Date.now() + TEN_MIN,
    responseDisposition: `attachment; filename="${clean(filename)}"`
  });
  return url;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const payload = verify(q.token);
  if (!payload || !payload.orderId || !payload.productId) return text(403, 'Invalid or expired link.');

  const orderSnap = await db.collection('orders').doc(payload.orderId).get();
  if (!orderSnap.exists) return text(404, 'Order not found.');
  const order = orderSnap.data();
  if (order.status !== 'paid') return text(403, 'This order is not paid.');
  if (!(order.items || []).some(i => i.productId === payload.productId)) {
    return text(403, 'Product not part of this order.');
  }

  const prodSnap = await db.collection('products').doc(payload.productId).get();
  if (!prodSnap.exists) return text(404, 'Product unavailable.');
  const prod = prodSnap.data();
  const title = prod.title || 'download';

  // Normalise to a list of { path, name }
  let files = Array.isArray(prod.files) && prod.files.length
    ? prod.files.filter(f => f && f.path)
    : (prod.storagePath ? [{ path: prod.storagePath, name: clean(title) + guessExt(prod.storagePath) }] : []);
  if (!files.length) return text(404, 'File unavailable.');

  // Best-effort download counter
  db.collection('orders').doc(payload.orderId).set({
    downloadCount: (order.downloadCount || 0) + 1, lastDownloadAt: Date.now()
  }, { merge: true }).catch(() => {});

  // Direct-to-file (used by the "download all" buttons on the list page)
  const idx = q.f != null ? parseInt(q.f, 10) : -1;
  if (files.length === 1 || (idx >= 0 && idx < files.length)) {
    const f = files.length === 1 ? files[0] : files[idx];
    const url = await signedUrl(f.path, f.name || (clean(title) + guessExt(f.path)));
    return { statusCode: 302, headers: { Location: url }, body: '' };
  }

  // Multi-file → HTML list of signed links
  const rows = await Promise.all(files.map(async (f, i) => {
    const name = f.name || `${clean(title)} — file ${i + 1}${guessExt(f.path)}`;
    const url = await signedUrl(f.path, name);
    return `<li><a href="${url}">${escapeHtml(name)}</a></li>`;
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your download — ${escapeHtml(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1.25rem;color:#1f2937}
h1{font-size:1.35rem}ul{list-style:none;padding:0}li{margin:.6rem 0}
a{display:inline-block;padding:.7rem 1.1rem;background:#66249A;color:#fff;border-radius:10px;text-decoration:none;font-weight:600}
p{color:#6b7280;font-size:.9rem}</style>
<h1>${escapeHtml(title)}</h1>
<p>${files.length} files. Each link is valid for 10 minutes — reopen this page from your email or dashboard for fresh links.</p>
<ul>${rows.join('')}</ul>`
  };
};

function guessExt(path) {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(path || '');
  return m ? '.' + m[1].toLowerCase() : '';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
