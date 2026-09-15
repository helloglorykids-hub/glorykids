/* Best-effort "hey, something happened" email to the site owner — separate
   from MailerLite, which is for customer-facing lifecycle emails. Never
   throws: a failed notification must never block fulfilment (granting
   access, recording a payment, etc.).

   Uses plain Gmail SMTP via an App Password, since that's an account you
   already have — no new third-party service to sign up for.

   Required Netlify env vars:
     GMAIL_USER           the Gmail address to send FROM (e.g. hello.glorykids@gmail.com)
     GMAIL_APP_PASSWORD   a 16-character App Password for that account
                           (Google Account → Security → 2-Step Verification → App passwords)
   Optional:
     ADMIN_NOTIFY_EMAIL   where alerts land (defaults to GMAIL_USER) */
'use strict';
const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || GMAIL_USER;

let transporter = null;
function getTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
  }
  return transporter;
}

async function notifyAdmin(subject, text) {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('notifyAdmin: GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping admin email');
      return;
    }
    await t.sendMail({ from: GMAIL_USER, to: ADMIN_NOTIFY_EMAIL, subject, text });
  } catch (e) {
    console.error('notifyAdmin failed:', e && e.message);
  }
}

/* Generic customer-facing email (receipts, etc.) — same Gmail transport as
   notifyAdmin, just addressed to the customer instead of the site owner.
   Best-effort: a failed send must never block fulfilment. */
async function sendMail({ to, subject, html, text }) {
  try {
    const t = getTransporter();
    if (!t) {
      console.error('sendMail: GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping email to', to);
      return;
    }
    await t.sendMail({ from: GMAIL_USER, to, subject, html, text });
  } catch (e) {
    console.error('sendMail failed:', e && e.message);
  }
}

module.exports = { notifyAdmin, sendMail };
