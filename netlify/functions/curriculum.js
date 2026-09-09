/* GET /api/curriculum
   Public. Returns published, currently-live curriculum (metadata only — no
   file URLs; downloads go through /api/member-file which checks membership).
   `publishAt` in the future stays hidden, so scheduled monthly drops just
   appear on their own. */
'use strict';
const { db, configured } = require('./_lib/firebase');
const { json } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });
  if (!configured || !db) return json(200, { curriculum: [] });

  const now = Date.now();
  const snap = await db.collection('curriculum').where('published', '==', true).get();

  const curriculum = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => !c.publishAt || c.publishAt <= now)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (b.createdAt || 0) - (a.createdAt || 0))
    .map(c => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      description: c.description || '',
      coverImage: c.coverImage || '',
      section: c.section === 'activities' ? 'activities' : 'curriculum',
      ageGroups: c.ageGroups || [],
      topics: c.topics || [],
      type: c.type === 'series' ? 'series' : 'pack',
      fileCount: Array.isArray(c.files) ? c.files.filter(f => f && f.path).length : 0,
      weeks: (Array.isArray(c.weeks) ? c.weeks : []).map((w, i) => ({
        index: i,
        title: w.title || ('Week ' + (i + 1)),
        description: w.description || '',
        fileCount: Array.isArray(w.files) ? w.files.filter(f => f && f.path).length : 0
      })),
      publishedAt: c.publishAt || c.createdAt || null
    }));

  return json(200, { curriculum });
};
