/* /api/org   Header: Authorization: Bearer <Firebase ID token>
   Church team / seat management.

   GET  → { owner: bool, org: {orgName, plan, seatLimit, seatsUsed, memberEmails}|null,
            membership: {active, via} }
   POST { action:'invite', email }  → owner adds a team member (seat-limited)
   POST { action:'remove', email }  → owner removes a team member
*/
'use strict';
const { admin, db, configured, FieldValue } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');
const { resolveMembership } = require('./_lib/membership');

const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');

exports.handler = async (event) => {
  if (!configured || !db) return json(503, { error: 'Unavailable — please try again shortly.' });

  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Please sign in.' });

  let uid, email;
  try {
    const d = await admin.auth().verifyIdToken(idToken);
    uid = d.uid; email = (d.email || '').toLowerCase();
  } catch (e) {
    return json(401, { error: 'Your session expired — please sign in again.' });
  }

  const orgRef = db.collection('orgs').doc(uid);

  if (event.httpMethod === 'GET') {
    const [snap, membership] = await Promise.all([orgRef.get(), resolveMembership(db, uid, email)]);
    if (!snap.exists) return json(200, { owner: false, org: null, membership });
    const o = snap.data();
    return json(200, {
      owner: true,
      membership,
      org: {
        orgName: o.orgName || '',
        plan: o.plan || 'church-small',
        planStatus: o.planStatus || 'active',
        seatLimit: o.seatLimit || 5,
        memberEmails: o.memberEmails || [],
        seatsUsed: (o.memberEmails || []).length
      }
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST only' });

  const snap = await orgRef.get();
  if (!snap.exists) return json(403, { error: 'Only a church account owner can manage a team.' });
  const org = snap.data();
  if (org.planStatus !== 'active') return json(403, { error: 'Your church membership isn’t active.' });

  const { json: body } = parseBody(event);
  const action = body.action;
  const target = String(body.email || '').toLowerCase().trim();
  if (!isEmail(target)) return json(400, { error: 'Please enter a valid email address.' });
  if (target === (org.ownerEmail || '').toLowerCase()) return json(400, { error: 'That’s the owner account — it already has full access.' });

  const members = org.memberEmails || [];

  if (action === 'invite') {
    if (members.includes(target)) return json(200, { ok: true, already: true, memberEmails: members });
    if (members.length >= (org.seatLimit || 5)) {
      return json(409, { error: `You’ve used all ${org.seatLimit} seats. Remove someone first, or upgrade your plan.` });
    }
    await orgRef.set({ memberEmails: FieldValue.arrayUnion(target), updatedAt: Date.now() }, { merge: true });
    // If they already have an account, link it now (otherwise it links on their next member-file call).
    try {
      const u = await admin.auth().getUserByEmail(target);
      await db.collection('users').doc(u.uid).set({ orgId: uid }, { merge: true });
    } catch (e) { /* no account yet — fine */ }
    return json(200, { ok: true, memberEmails: [...members, target] });
  }

  if (action === 'remove') {
    await orgRef.set({ memberEmails: FieldValue.arrayRemove(target), updatedAt: Date.now() }, { merge: true });
    try {
      const u = await admin.auth().getUserByEmail(target);
      await db.collection('users').doc(u.uid).set({ orgId: FieldValue.delete() }, { merge: true });
    } catch (e) {}
    return json(200, { ok: true, memberEmails: members.filter(m => m !== target) });
  }

  return json(400, { error: 'Unknown action.' });
};
