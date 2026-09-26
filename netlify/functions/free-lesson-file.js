/* GET /api/free-lesson-file
   No auth header — the 35 free lessons are free for everyone, gated only
   by the email-capture step on the client (see free-library.js), not by
   who's asking here. Only ever serves posts in the free_lessons category;
   everything else (curriculum, paid packs) still goes through
   member-file.js and its membership check, untouched.

     ?post=<postId>            → { files: [{ name, url }] }   (whole pack)
     ?post=<postId>&f=<i>      → { url, name }                 (one file)
*/
'use strict';
const { db, bucket, configured, FieldValue } = require('./_lib/firebase');
const { json, text } = require('./_lib/http');

const TEN_MIN = 10 * 60 * 1000;
const clean = s => String(s || 'download').replace(/[^\w.\- ]/g, '').trim() || 'download';

function guessExt(path) {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(path || '');
  return m ? '.' + m[1].toLowerCase() : '';
}

exports.handler = async (event) => {
  if (!configured || !db || !bucket) return text(503, 'Downloads are temporarily unavailable.');

  const q = event.queryStringParameters || {};
  if (!q.post) return json(400, { error: 'Nothing requested.' });

  const postSnap = await db.collection('posts').doc(String(q.post)).get();
  if (!postSnap.exists) return json(404, { error: 'Lesson not found.' });
  const post = postSnap.data();
  if (!post.published) return json(403, { error: 'This lesson isn’t published.' });
  if (post.category !== 'free_lessons') return json(403, { error: 'Not a free lesson.' });

  const title = post.title || 'lesson';
  const files = Array.isArray(post.files) ? post.files.filter(f => f && f.path) : [];
  if (!files.length) return json(404, { error: 'No files attached.' });

  const signOne = async (file, i) => {
    const filename = file.name || (clean(title) + '-' + (i + 1) + guessExt(file.path));
    const [url] = await bucket.file(file.path).getSignedUrl({
      action: 'read',
      expires: Date.now() + TEN_MIN,
      responseDisposition: `attachment; filename="${clean(filename)}"`
    });
    return { name: filename, url };
  };

  // Record who downloaded what — for admin visibility only (see the
  // Free Library / Members tabs), never used to gate access. `email`
  // identifies either an old-model signed-in account or a new
  // free-library capture; the client sends whichever it has. Best-effort:
  // never fail the actual download over a tracking write.
  try {
    const email = String(q.email || '').trim().toLowerCase().slice(0, 250);
    await Promise.all([
      db.collection('lessonDownloads').add({
        postId: String(q.post), title, email, downloadedAt: Date.now()
      }),
      db.collection('lessonStats').doc(String(q.post)).set({
        downloads: FieldValue.increment(1)
      }, { merge: true })
    ]);
  } catch (e) {
    console.error('lessonDownloads write failed', e && e.message);
  }

  if (q.f != null) {
    const i = Math.max(0, Math.min(files.length - 1, parseInt(q.f, 10) || 0));
    return json(200, await signOne(files[i], i));
  }
  const signed = await Promise.all(files.map(signOne));
  return json(200, { files: signed });
};
