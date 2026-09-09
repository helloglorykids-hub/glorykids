/* GET /api/member-file
   Header: Authorization: Bearer <Firebase ID token>

   Members-only lesson / curriculum downloads. Verifies the signed-in user,
   confirms the file belongs to a published item, returns 10-minute signed
   Storage URL(s) as JSON. The client opens them.

   Lessons:
     ?post=<postId>            → { files: [{ name, url }] }   (whole pack)
     ?post=<postId>&f=<i>      → { url, name }                 (one file)
     (the 10 free lessons: any signed-in user; others: active member)
   Curriculum (always members-only):
     ?curriculum=<id>                    → pack files, or all week files
     ?curriculum=<id>&week=<n>           → that week's files
     ?curriculum=<id>&week=<n>&f=<i>     → one file
*/
'use strict';
const { admin, db, bucket, configured } = require('./_lib/firebase');
const { json, text } = require('./_lib/http');

const TEN_MIN = 10 * 60 * 1000;
const clean = s => String(s || 'download').replace(/[^\w.\- ]/g, '').trim() || 'download';

function isActiveMember(rec) {
  if (!rec) return false;
  const paid = rec.plan === 'glory_kids' || rec.plan === 'church';
  return paid && (rec.planStatus === 'active' || rec.planStatus === 'cancelled');
}
function guessExt(path) {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(path || '');
  return m ? '.' + m[1].toLowerCase() : '';
}

exports.handler = async (event) => {
  if (!configured || !db || !bucket) return text(503, 'Downloads are temporarily unavailable.');

  const q = event.queryStringParameters || {};
  const authz = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authz.replace(/^Bearer\s+/i, '');
  if (!idToken) return json(401, { error: 'Please sign in.' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    return json(401, { error: 'Your session expired — please sign in again.' });
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const userRec = userSnap.exists ? userSnap.data() : null;

  // ── Resolve the target: a lesson pack, or curriculum files ──────────
  let title, files, needsMembership = true;

  if (q.curriculum) {
    const cSnap = await db.collection('curriculum').doc(String(q.curriculum)).get();
    if (!cSnap.exists) return json(404, { error: 'Curriculum not found.' });
    const c = cSnap.data();
    if (!c.published || (c.publishAt && c.publishAt > Date.now())) {
      return json(403, { error: 'This curriculum isn’t available yet.' });
    }
    title = c.title || 'curriculum';
    if (q.week != null) {
      const wk = (Array.isArray(c.weeks) ? c.weeks : [])[parseInt(q.week, 10)];
      if (!wk) return json(404, { error: 'Week not found.' });
      title = (c.title || 'curriculum') + ' - ' + (wk.title || ('Week ' + (parseInt(q.week, 10) + 1)));
      files = Array.isArray(wk.files) ? wk.files.filter(f => f && f.path) : [];
    } else if (Array.isArray(c.weeks) && c.weeks.length) {
      files = c.weeks.flatMap((w, wi) => (Array.isArray(w.files) ? w.files : [])
        .filter(f => f && f.path)
        .map(f => ({ path: f.path, name: f.name || ((w.title || ('Week ' + (wi + 1))) + guessExt(f.path)) })));
    } else {
      files = Array.isArray(c.files) ? c.files.filter(f => f && f.path) : [];
    }
  } else if (q.post) {
    const postSnap = await db.collection('posts').doc(String(q.post)).get();
    if (!postSnap.exists) return json(404, { error: 'Lesson not found.' });
    const post = postSnap.data();
    if (!post.published) return json(403, { error: 'This lesson isn’t published.' });
    title = post.title || 'lesson';
    files = Array.isArray(post.files) ? post.files.filter(f => f && f.path) : [];
    needsMembership = !post.isFreeLesson; // free 10 → any signed-in user
  } else {
    return json(400, { error: 'Nothing requested.' });
  }

  if (needsMembership && !isActiveMember(userRec)) {
    return json(403, { error: 'This download is included with Glory Kids Membership.', needsMembership: true });
  }
  if (!files || !files.length) return json(404, { error: 'No files attached.' });

  const signOne = async (file, i) => {
    const filename = file.name || (clean(title) + '-' + (i + 1) + guessExt(file.path));
    const [url] = await bucket.file(file.path).getSignedUrl({
      action: 'read',
      expires: Date.now() + TEN_MIN,
      responseDisposition: `attachment; filename="${clean(filename)}"`
    });
    return { name: filename, url };
  };

  if (q.f != null) {
    const i = Math.max(0, Math.min(files.length - 1, parseInt(q.f, 10) || 0));
    return json(200, await signOne(files[i], i));
  }
  const signed = await Promise.all(files.map(signOne));
  return json(200, { files: signed });
};
