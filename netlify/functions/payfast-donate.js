/* POST /api/payfast-donate
   Body (JSON): { amountUSD, name?, email }
   One-time donation checkout — no account required, no items, just an
   amount. Creates a pending donations/{id} record and returns the signed
   PayFast field set for the browser to POST (full-page redirect). */
'use strict';
const { db } = require('./_lib/firebase');
const { buildCheckout } = require('./_lib/payfast');
const { json, parseBody } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';
const USD_ZAR_RATE = Number(process.env.USD_ZAR_RATE) || 18.5;
const usdToZar = usd => Math.round(usd * USD_ZAR_RATE * 100) / 100;

const MIN_USD = 1;
const MAX_USD = 10000;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const { json: body } = parseBody(event);
  const amountUSD = Math.round(Number(body.amountUSD) * 100) / 100;
  const email = (body.email || '').toLowerCase().trim();
  const name = (body.name || '').trim();

  if (!Number.isFinite(amountUSD) || amountUSD < MIN_USD || amountUSD > MAX_USD) {
    return json(400, { error: `Please enter an amount between $${MIN_USD} and $${MAX_USD}.` });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: 'A valid email address is required.' });
  }

  const amountZAR = usdToZar(amountUSD);

  const donationRef = db.collection('donations').doc();
  await donationRef.set({
    amountUSD,
    amountZAR,
    fxRateUsdZar: USD_ZAR_RATE,
    donorEmail: email,
    donorName: name,
    status: 'pending',
    createdAt: Date.now()
  });

  const { fields, processUrl } = buildCheckout({
    return_url: `${SITE}/about.html?donated=1`,
    cancel_url: `${SITE}/about.html?cancelled=1#donate`,
    notify_url: `${SITE}/api/payfast-notify`,
    name_first: name,
    email_address: email,
    m_payment_id: donationRef.id,
    amount: amountZAR,
    item_name: 'Donation to Glory Kids Ministries',
    item_description: `One-time donation ($${amountUSD.toFixed(2)})`,
    custom_str1: donationRef.id,
    custom_str2: 'donation'
  });

  return json(200, { donationId: donationRef.id, processUrl, fields });
};
