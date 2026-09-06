/* POST /api/lesson-hit
   Body: { postId, slug, title?, ageGroups?[], isFreeLesson?, category? }
   Records one "interaction" (a free-lesson page open) on lessonStats/{postId}:
     - total          → all-time counter
     - w_<ISO week>   → per-week counter (drives "Most Downloaded This Week")
   Denormalises slug/title/ageGroups so the free-lessons sidebar can rank
   without reading the posts collection. Always returns 200. */
'use strict';
const { db, FieldValue } = require('./_lib/firebase');
const { json, parseBody } = require('./_lib/http');

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return 'w_' + d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// Best-effort in-memory dedupe within a warm lambda (ip+post, ~30 min).
const recent = new Map();
const DEDUPE_MS = 30 * 60 * 1000;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!db) return json(200, { ok: false, skipped: 'no db' });

  const { json: body } = parseBody(event);
  const postId = String(body.postId || '').slice(0, 200);
  if (!postId) return json(400, { error: 'postId required' });

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '';
  const key = ip + '|' + postId;
  const now = Date.now();
  if (recent.has(key) && now - recent.get(key) < DEDUPE_MS) {
    return json(200, { ok: true, deduped: true });
  }
  recent.set(key, now);
  if (recent.size > 5000) recent.clear();

  const wk = isoWeekKey(new Date());
  const update = {
    total: FieldValue.increment(1),
    [wk]: FieldValue.increment(1),
    updatedAt: now
  };
  if (body.slug) update.slug = String(body.slug).slice(0, 300);
  if (body.title) update.title = String(body.title).slice(0, 300);
  if (Array.isArray(body.ageGroups)) update.ageGroups = body.ageGroups.slice(0, 6);
  if (body.category) update.category = String(body.category).slice(0, 40);
  if (typeof body.isFreeLesson === 'boolean') update.isFreeLesson = body.isFreeLesson;

  try {
    await db.collection('lessonStats').doc(postId).set(update, { merge: true });
  } catch (e) {
    console.error('lesson-hit write failed', e && e.message);
    return json(200, { ok: false });
  }
  return json(200, { ok: true, week: wk });
};
