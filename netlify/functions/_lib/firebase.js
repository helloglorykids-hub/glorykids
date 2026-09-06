/* Shared Firebase Admin init for all Netlify functions.
   Set FIREBASE_SERVICE_ACCOUNT in the Netlify env to the full service-account
   JSON (one line). Falls back to GOOGLE_APPLICATION_CREDENTIALS if present. */
'use strict';
const admin = require('firebase-admin');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'glorykidsministries-3d279.firebasestorage.app';

let configured = false;

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    if (raw) {
      let creds;
      try {
        creds = JSON.parse(raw);
      } catch (e) {
        // Some dashboards escape newlines — try to recover.
        creds = JSON.parse(raw.replace(/\n/g, '\\n'));
      }
      if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert(creds),
        storageBucket: BUCKET
      });
      configured = true;
    } else {
      // No service account in the env — init anyway so `admin` is usable,
      // but callers must treat Firestore/Storage as unavailable.
      admin.initializeApp({ storageBucket: BUCKET });
      console.error('firebase: FIREBASE_SERVICE_ACCOUNT not set — Firestore/Storage disabled');
    }
  } catch (e) {
    console.error('firebase: init failed —', e && e.message);
  }
} else {
  configured = true;
}

// Never throw at module load; these are only exercised when actually called.
const db = admin.apps.length ? admin.firestore() : null;
const bucket = admin.apps.length ? admin.storage().bucket() : null;

module.exports = {
  admin,
  db,
  bucket,
  configured,
  FieldValue: admin.firestore.FieldValue
};
