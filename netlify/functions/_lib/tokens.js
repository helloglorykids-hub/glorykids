/* Signed, expiring tokens for download links and order-status lookups.
   Secret: TOKEN_SECRET env var (fall back to the service-account private key). */
'use strict';
const crypto = require('crypto');

function secret() {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (sa.private_key) return sa.private_key;
  } catch (e) {}
  return 'glory-kids-dev-secret-change-me';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

// payload: plain object. ttlMs: lifetime.
function sign(payload, ttlMs) {
  const body = { ...payload, exp: Date.now() + (ttlMs || 3600000) };
  const p = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(p).digest());
  return `${p}.${sig}`;
}

// Returns the payload object, or null if invalid/expired.
function verify(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [p, sig] = token.split('.');
  const expect = b64url(crypto.createHmac('sha256', secret()).update(p).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let body;
  try { body = JSON.parse(b64urlDecode(p)); } catch (e) { return null; }
  if (!body.exp || Date.now() > body.exp) return null;
  return body;
}

module.exports = { sign, verify };
