/* PayFast helpers — signature generation/verification + server-side validation.
   Docs: https://developers.payfast.co.za/docs  (Custom integration + ITN) */
'use strict';
const crypto = require('crypto');

const MODE = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
const HOST = MODE === 'live' ? 'www.payfast.co.za' : 'sandbox.payfast.co.za';

// PayFast's public sandbox test merchant *with a known passphrase* — the
// plain 10000100 account is shared and people leave stray passphrases on it,
// which breaks signature validation. 10004002 / passphrase "payfast" is the
// documented pair for passphrase-enabled testing. Live mode never uses these.
const SANDBOX_MERCHANT_ID = '10004002';
const SANDBOX_MERCHANT_KEY = 'q1cd2rdny4a53';
const SANDBOX_PASSPHRASE = 'payfast';

function creds() {
  // Non-live mode ALWAYS uses PayFast's sandbox test merchant, even if real
  // credentials happen to be sitting in the env — otherwise live keys get
  // posted to the sandbox endpoint and every test checkout fails. Flip
  // PAYFAST_MODE=live to use the real account.
  if (MODE !== 'live') {
    return { id: SANDBOX_MERCHANT_ID, key: SANDBOX_MERCHANT_KEY, passphrase: SANDBOX_PASSPHRASE };
  }
  return {
    id: process.env.PAYFAST_MERCHANT_ID,
    key: process.env.PAYFAST_MERCHANT_KEY,
    passphrase: process.env.PAYFAST_PASSPHRASE || ''
  };
}

const PROCESS_URL = `https://${HOST}/eng/process`;
const VALIDATE_URL = `https://${HOST}/eng/query/validate`;

// PayFast urlencodes with uppercase hex and spaces as '+'
function pfEncode(v) {
  return encodeURIComponent(String(v))
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Build the signature over an ORDERED list of [key, value] pairs (blank values skipped).
function signPairs(pairs, passphrase) {
  const parts = pairs
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .map(([k, v]) => `${k}=${pfEncode(String(v).trim())}`);
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase.trim())}`);
  return crypto.createHash('md5').update(parts.join('&')).digest('hex');
}

// Canonical field order for the checkout redirect form.
const PAYMENT_ORDER = [
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address',
  'payment_method', 'subscription_type', 'billing_date', 'recurring_amount',
  'frequency', 'cycles'
];

// Returns { fields, processUrl } — POST `fields` as a form to `processUrl`.
function buildCheckout(data) {
  const { id: merchantId, key: merchantKey, passphrase } = creds();

  const fields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: data.return_url,
    cancel_url: data.cancel_url,
    notify_url: data.notify_url,
    name_first: data.name_first || '',
    email_address: data.email_address || '',
    m_payment_id: data.m_payment_id,
    amount: Number(data.amount).toFixed(2),
    item_name: (data.item_name || 'Order').slice(0, 100),
    item_description: (data.item_description || '').slice(0, 255)
  };
  if (data.custom_str1) fields.custom_str1 = data.custom_str1;

  const ordered = PAYMENT_ORDER
    .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
    .map(k => [k, fields[k]]);
  fields.signature = signPairs(ordered, passphrase);

  return { fields, processUrl: PROCESS_URL };
}

// Verify an ITN payload's signature. `body` is the parsed form object.
// PayFast signs ITN in the order the fields were received, so pass the raw
// querystring-ordered keys.
function verifyItnSignature(orderedPairs, suppliedSignature) {
  const { passphrase } = creds();
  const expected = signPairs(
    orderedPairs.filter(([k]) => k !== 'signature'),
    passphrase
  );
  return expected === String(suppliedSignature || '').toLowerCase();
}

// Server-to-server confirmation: POST the ITN data back to PayFast.
async function serverValidate(rawBody) {
  const res = await fetch(VALIDATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: rawBody
  });
  const text = (await res.text()).trim();
  return text === 'VALID';
}

// PayFast source IP ranges (host lookups) — best-effort allowlist.
const PF_HOSTS = [
  'www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'
];

module.exports = {
  MODE, PROCESS_URL, VALIDATE_URL, PF_HOSTS,
  pfEncode, signPairs, buildCheckout, verifyItnSignature, serverValidate
};
