/* GET /api/member-file?post=<postId>[&f=<fileIndex>]
   Header: Authorization: Bearer <Firebase ID token>

   Members-only lesson/resource downloads. Verifies the signed-in user has an
   active Glory Kids or Church membership, confirms the file(s) belong to a
   published lesson, then returns 10-minute signed Storage URL(s) as JSON:
     no  f  → { files: [{ name, url }] }   (whole pack)
     with f → { url, name }                 (one file)
   The client opens the URL(s). (Non-members downloading the 10 free lessons
   still use the email opt-in on the lesson page.) */
'use strict';
const { admin, db, bucket, configured } = require('./_lib/firebase');
const { json, text } = require('./_lib/http');

const TEN_MIN = 10 * 60 * 1000;
const clean = s => String(s || 'download').replace(/[^\w.\- ]/g, '').trim() || 'download';

// Active member = paid plan that is active, or cancelled-but-still-in-period
// (we let cancelled members keep downloading until their paid time lapses).
function isActiveMember(rec) {
  if (!rec) return false;
  const paid = rec.plan === 'glory_kids' || rec.plan === 'church';
  return paid && (rec.planStatus === 'active' || rec.planStatus === 'cancelled');
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

  const postId = q.post;
  if (!postId) return json(400, { error: 'Missing lesson id.' });
  const postSnap = await db.collection('posts').doc(String(postId)).get();
  if (!postSnap.exists) return json(404, { error: 'Lesson not found.' });
  const post = postSnap.data();
  if (!post.published) return json(403, { error: 'This lesson isn’t published.' });

  // The 10 free lessons are downloadable by any signed-in user; everything
  // else needs an active Glory Kids / Church membership.
  if (!post.isFreeLesson) {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!isActiveMember(userSnap.exists ? userSnap.data() : null)) {
      return json(403, { error: 'This download is included with Glory Kids Membership.', needsMembership: true });
    }
  }

  const files = Array.isArray(post.files) ? post.files.filter(f => f && f.path) : [];
  if (!files.length) return json(404, { error: 'No files attached to this lesson.' });

  const signOne = async (file, i) => {
    const filename = file.name || (clean(post.title) + '-' + (i + 1) + guessExt(file.path));
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

function guessExt(path) {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(path || '');
  return m ? '.' + m[1].toLowerCase() : '';
}
