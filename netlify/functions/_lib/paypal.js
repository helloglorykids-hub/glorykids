/* PayPal helpers — OAuth token, authenticated API calls, and webhook
   signature verification. Docs: https://developer.paypal.com/api/rest/ */
'use strict';

const MODE = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
const API = MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

let cachedToken = null; // { value, expiresAt }

// PayPal access tokens last ~8-9 hours; cache across warm Lambda invocations
// so we're not doing an OAuth round-trip on every single API call.
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error('paypal oauth failed: ' + JSON.stringify(data));
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return cachedToken.value;
}

// Authenticated JSON request against the PayPal REST API.
async function api(method, path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = { raw }; }
  return { ok: res.ok, status: res.status, data };
}

// Verifies an incoming webhook really came from PayPal, using PayPal's own
// verification endpoint (simpler and more robust than re-implementing the
// cert-chain/signature check ourselves). `headers` must be the raw request
// headers (case-insensitive lookup handled below) and `body` the raw JSON
// object PayPal sent.
async function verifyWebhookSignature(headers, body) {
  if (!WEBHOOK_ID) return false;
  const h = {};
  Object.keys(headers || {}).forEach(k => { h[k.toLowerCase()] = headers[k]; });

  const { ok, data } = await api('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h['paypal-auth-algo'],
    cert_url: h['paypal-cert-url'],
    transmission_id: h['paypal-transmission-id'],
    transmission_sig: h['paypal-transmission-sig'],
    transmission_time: h['paypal-transmission-time'],
    webhook_id: WEBHOOK_ID,
    webhook_event: body
  });
  return ok && data.verification_status === 'SUCCESS';
}

module.exports = { MODE, api, getAccessToken, verifyWebhookSignature };
