/* POST /api/form-submit
   Body (JSON): { formId, data:{}, pageUrl?, _hp? (honeypot), newsletter? }
   Writes formSubmissions/{id}. For formId 'contact' also creates a support
   ticket (Admin → Support). Optional MailerLite subscribe. */
'use strict';
const { db } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const { json: body } = parseBody(event);

  // Honeypot — silently accept, don't store
  if (body._hp) return json(200, { ok: true });

  const formId = String(body.formId || 'generic').slice(0, 40);
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const email = (data.email || data.Email || '').toString().toLowerCase().trim();

  if (!Object.keys(data).length) return json(400, { error: 'Empty submission' });

  const rec = {
    formId,
    data,
    pageUrl: (body.pageUrl || event.headers.referer || '').slice(0, 400),
    ip: event.headers['x-nf-client-connection-ip'] || '',
    createdAt: Date.now(),
    read: false
  };
  const ref = await db.collection('formSubmissions').add(rec);

  // Support ticket for the contact form
  if (formId === 'contact') {
    await db.collection('tickets').add({
      name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || 'Website visitor',
      email,
      message: data.message || data.enquiry || JSON.stringify(data),
      transcript: [],
      status: 'open',
      source: 'contact-form',
      createdAt: Date.now()
    }).catch(e => console.error('ticket create failed', e));
  }

  // Newsletter opt-in
  if ((body.newsletter || formId === 'newsletter') && email) {
    try {
      await fetch(`${SITE}/api/mailerlite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email, name: data.firstName || data.name || '' })
      });
    } catch (e) { console.error('newsletter subscribe failed', e); }
  }

  return json(200, { ok: true, id: ref.id });
};
