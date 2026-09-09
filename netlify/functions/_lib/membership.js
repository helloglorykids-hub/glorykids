/* Shared membership-access logic — used by member-file, org, etc.
   A user has content access if ANY of:
     • their own plan is glory_kids / church and active (or cancelled — they
       keep access until the paid period lapses)
     • their plan is past_due but still inside the grace window
     • their email is on an active church org's seat list */
'use strict';

const GRACE_MS = (Number(process.env.MEMBERSHIP_GRACE_DAYS) || 7) * 86400000;

function ownPlanActive(rec) {
  if (!rec) return false;
  const paid = rec.plan === 'glory_kids' || rec.plan === 'church';
  if (!paid) return false;
  if (rec.planStatus === 'active' || rec.planStatus === 'cancelled') return true;
  if (rec.planStatus === 'past_due' && rec.pastDueSince && (Date.now() - rec.pastDueSince) < GRACE_MS) return true;
  return false;
}

// Returns { active, plan, via } — `via` is 'own' | 'org' | null.
async function resolveMembership(db, uid, email, userRec) {
  const rec = userRec || (uid ? (await db.collection('users').doc(uid).get()).data() : null);
  if (ownPlanActive(rec)) return { active: true, plan: rec.plan, via: 'own' };

  const addr = (email || (rec && rec.email) || '').toLowerCase().trim();
  if (addr) {
    const snap = await db.collection('orgs').where('memberEmails', 'array-contains', addr).limit(3).get();
    for (const d of snap.docs) {
      const org = d.data();
      if (org.planStatus === 'active') return { active: true, plan: 'church', via: 'org', orgId: d.id, orgName: org.orgName || '' };
    }
  }
  return { active: false, plan: (rec && rec.plan) || 'free', via: null };
}

module.exports = { resolveMembership, ownPlanActive, GRACE_MS };
