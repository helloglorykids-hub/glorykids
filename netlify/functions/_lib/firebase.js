/* Shared Firebase Admin init for all Netlify functions.
   Set FIREBASE_SERVICE_ACCOUNT in the Netlify env to the full service-account
   JSON (one line). Falls back to GOOGLE_APPLICATION_CREDENTIALS if present. */
'use strict';
const admin = require('firebase-admin');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'glorykidsministries-3d279.firebasestorage.app';

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
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
  } else {
    admin.initializeApp({ storageBucket: BUCKET });
  }
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket, FieldValue: admin.firestore.FieldValue };
