/* POST /api/mailerlite
   Body: { action, email, name?, groups?[], fields?{}, downloadLinks?[] }
   actions: 'subscribe' (newsletter), 'purchase' (customers group + fields).
   Uses MailerLite API v2 (new "MailerLite" — connect.mailerlite.com). */
'use strict';
const { json, parseBody } = require('./_lib/http');

const API = 'https://connect.mailerlite.com/api';
const KEY = process.env.MAILERLITE_API_KEY;
const GROUP_NEWSLETTER = process.env.MAILERLITE_GROUP_NEWSLETTER || '';
const GROUP_CUSTOMERS = process.env.MAILERLITE_GROUP_CUSTOMERS || '';

async function ml(path, method, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${KEY}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!KEY) return json(200, { skipped: 'MAILERLITE_API_KEY not set' });

  const { json: body } = parseBody(event);
  const email = (body.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'valid email required' });

  const groups = new Set((body.groups || []).filter(Boolean));
  if (body.action === 'subscribe' && GROUP_NEWSLETTER) groups.add(GROUP_NEWSLETTER);
  if (body.action === 'purchase' && GROUP_CUSTOMERS) groups.add(GROUP_CUSTOMERS);

  const fields = { ...(body.fields || {}) };
  if (body.name) fields.name = body.name;
  if (Array.isArray(body.downloadLinks) && body.downloadLinks.length) {
    fields.last_download_links = body.downloadLinks.join('\n');
  }

  const payload = { email, fields };
  if (groups.size) payload.groups = [...groups];

  // upsert subscriber
  const r = await ml('/subscribers', 'POST', payload);
  if (!r.ok) {
    console.error('mailerlite upsert failed', r.status, r.data);
    return json(200, { ok: false, status: r.status });
  }
  return json(200, { ok: true, id: r.data && r.data.data && r.data.data.id });
};
