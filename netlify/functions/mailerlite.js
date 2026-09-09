/* POST /api/mailerlite
   Body: { action, email, name?, groups?[], fields?{}, downloadLinks?[] }
   actions:
     'subscribe'    → newsletter group
     'purchase'     → customers group + fields
     'free-lessons' → "Free 10 Lessons" group (triggers the 10-lesson automation)
     'waitlist'     → "Membership Waitlist" group
   For 'free-lessons' / 'waitlist' the response includes { already: bool } —
   true when the email was ALREADY in that group (so the page can say
   "we already sent it" instead of "check your inbox").
   Uses MailerLite API v2 (new "MailerLite" — connect.mailerlite.com). */
'use strict';
const { json, parseBody } = require('./_lib/http');

const API = 'https://connect.mailerlite.com/api';
const KEY = process.env.MAILERLITE_API_KEY;
const GROUP_NEWSLETTER = process.env.MAILERLITE_GROUP_NEWSLETTER || '';
const GROUP_CUSTOMERS = process.env.MAILERLITE_GROUP_CUSTOMERS || '';
// Group IDs are not secret — safe to ship as defaults; override via env if needed.
const GROUP_FREE_LESSONS = process.env.MAILERLITE_GROUP_FREE_LESSONS || '197057173518288504';
const GROUP_WAITLIST = process.env.MAILERLITE_GROUP_WAITLIST || '190369688509744308';
// Active paying members. Set MAILERLITE_GROUP_MEMBERS in the env and hook your
// "welcome" + "payment failed" automations to this group / its fields.
const GROUP_MEMBERS = process.env.MAILERLITE_GROUP_MEMBERS || GROUP_CUSTOMERS;

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

/* True if the subscriber already exists AND is already in `groupId`. */
async function alreadyInGroup(email, groupId) {
  if (!groupId) return false;
  const r = await ml('/subscribers/' + encodeURIComponent(email), 'GET');
  if (!r.ok || !r.data || !r.data.data) return false;
  const g = r.data.data.groups || [];
  return g.some((item) => String(item && item.id ? item.id : item) === String(groupId));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!KEY) return json(200, { skipped: 'MAILERLITE_API_KEY not set' });

  const { json: body } = parseBody(event);
  const action = body.action || 'subscribe';
  const email = (body.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'valid email required' });

  const groups = new Set((body.groups || []).filter(Boolean));
  if (action === 'subscribe' && GROUP_NEWSLETTER) groups.add(GROUP_NEWSLETTER);
  if (action === 'purchase' && GROUP_CUSTOMERS) groups.add(GROUP_CUSTOMERS);
  if (action === 'free-lessons') groups.add(GROUP_FREE_LESSONS);
  if (action === 'waitlist') groups.add(GROUP_WAITLIST);
  // Membership lifecycle — same group, distinguished by the `membership_status`
  // field so you can branch automations (welcome vs payment-failed vs cancelled).
  if (action === 'membership-welcome' || action === 'membership-payment-failed' || action === 'membership-cancelled') {
    if (GROUP_MEMBERS) groups.add(GROUP_MEMBERS);
    body.fields = Object.assign({}, body.fields, {
      membership_status: action === 'membership-welcome' ? 'active'
        : action === 'membership-payment-failed' ? 'payment_failed' : 'cancelled',
      membership_event_at: new Date().toISOString()
    });
  }

  // "already sent it?" check — only for the opt-in flows that need it
  let already = false;
  if (action === 'free-lessons') already = await alreadyInGroup(email, GROUP_FREE_LESSONS);
  if (action === 'waitlist') already = await alreadyInGroup(email, GROUP_WAITLIST);

  const fields = { ...(body.fields || {}) };
  if (body.name) fields.name = body.name;
  if (body.source) fields.opt_in_source = String(body.source).slice(0, 250);
  if (Array.isArray(body.downloadLinks) && body.downloadLinks.length) {
    fields.last_download_links = body.downloadLinks.join('\n');
  }

  const payload = { email, fields, status: 'active' };
  if (groups.size) payload.groups = [...groups];

  // upsert subscriber (also (re)assigns groups → fires MailerLite automations)
  const r = await ml('/subscribers', 'POST', payload);
  if (!r.ok) {
    console.error('mailerlite upsert failed', r.status, r.data);
    return json(200, { ok: false, status: r.status, already });
  }
  return json(200, { ok: true, already, id: r.data && r.data.data && r.data.data.id });
};
