/* POST /api/form-submit
   Body (JSON): { formId, data:{}, pageUrl?, _hp? (honeypot), newsletter? }
   Best-effort writes formSubmissions/{id} + (for 'contact') a support ticket.
   If Firestore is unavailable the submission still forwards to MailerLite and
   returns ok — EXCEPT 'contact', which returns an error so the visitor knows
   to email directly rather than lose their message silently. */
'use strict';
const { db, configured } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');

const SITE = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';

async function subscribeMailerLite(payload) {
  try {
    const r = await fetch(`${SITE}/api/mailerlite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json().catch(() => ({}));
  } catch (e) {
    console.error('mailerlite call failed', e && e.message);
    return {};
  }
}

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

  // ── Best-effort Firestore log ────────────────────────────────────
  let submissionId = null;
  let dbOk = false;
  if (db) {
    try {
      const ref = await db.collection('formSubmissions').add(rec);
      submissionId = ref.id;
      dbOk = true;
    } catch (e) {
      console.error('formSubmissions write failed', e && e.message);
    }
  } else {
    console.error('form-submit: Firestore not configured (FIREBASE_SERVICE_ACCOUNT missing)');
  }

  // Support ticket for the contact form
  if (formId === 'contact' && db) {
    try {
      await db.collection('tickets').add({
        name: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || 'Website visitor',
        email,
        message: data.message || data.enquiry || JSON.stringify(data),
        transcript: [],
        status: 'open',
        source: 'contact-form',
        createdAt: Date.now()
      });
      dbOk = true;
    } catch (e) {
      console.error('ticket create failed', e && e.message);
    }
  }

  // Contact messages must not be lost silently — if nothing was stored, tell
  // the visitor so they can reach out another way.
  if (formId === 'contact' && !dbOk) {
    return json(503, { error: 'We could not save your message right now. Please email us directly at hello.glorykids@gmail.com.' });
  }

  // Free-lessons opt-in / membership waitlist → MailerLite group (fires automation)
  if ((formId === 'free-lessons' || formId === 'waitlist') && email) {
    const j = await subscribeMailerLite({
      action: formId,
      email,
      name: data.firstName || data.name || '',
      source: rec.pageUrl
    });
    return json(200, { ok: true, id: submissionId, already: !!j.already });
  }

  // Newsletter opt-in
  if ((body.newsletter || formId === 'newsletter') && email) {
    await subscribeMailerLite({ action: 'subscribe', email, name: data.firstName || data.name || '' });
  }

  return json(200, { ok: true, id: submissionId, logged: dbOk });
};
