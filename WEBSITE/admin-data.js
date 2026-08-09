/* ============================================================
   ADMIN DATA LAYER — Firestore backend
   ============================================================
   Shared read/write helpers for the admin panel and public
   pages: users/members, blog posts, payments, and support
   tickets. Backed by Firestore (see firebase-config.js).
   All functions are async — callers must await/then them.
   Exposed as a single window.GK namespace.
   ============================================================ */

(function () {
  function usersCol()    { return db.collection('users'); }
  function postsCol()    { return db.collection('posts'); }
  function paymentsCol() { return db.collection('payments'); }
  function ticketsCol()  { return db.collection('tickets'); }

  function docToObj(doc) { return { id: doc.id, ...doc.data() }; }
  function slugify(str) {
    return String(str || '').toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /* ── Users / Members ─────────────────────────────────────── */
  async function listUsers() {
    const snap = await usersCol().get();
    return snap.docs.map(docToObj);
  }

  async function getUserRecord(uid) {
    if (!uid) return null;
    const doc = await usersCol().doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  // Creates the users/{uid} profile doc the first time we see this
  // Firebase Auth user (signup, first Google sign-in, admin setup).
  // No-ops if the doc already exists.
  async function ensureUserRecord(user, extra) {
    if (!user) return null;
    const ref = usersCol().doc(user.uid);
    const existing = await ref.get();
    if (existing.exists) return { id: existing.id, ...existing.data() };
    const rec = {
      email: user.email || '',
      displayName: (extra && extra.displayName) || user.displayName || '',
      photoURL: user.photoURL || null,
      isAdmin: false,
      plan: 'free',
      planStatus: 'active',
      createdAt: Date.now(),
      ...(extra || {})
    };
    await ref.set(rec);
    return { id: user.uid, ...rec };
  }

  async function updateUserRecord(uid, patch) {
    await usersCol().doc(uid).set(patch, { merge: true });
    return getUserRecord(uid);
  }

  async function deleteUserRecord(uid) {
    await usersCol().doc(uid).delete();
    localStorage.removeItem('gk_saved_' + uid);
    localStorage.removeItem('gk_activity_' + uid);
  }

  /* ── Blog posts ───────────────────────────────────────────── */
  // Admin view — every post regardless of published state.
  async function listPosts() {
    const snap = await postsCol().get();
    return snap.docs.map(docToObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  // Public view — only published posts, optionally filtered by category.
  // Sorted client-side so no composite Firestore index is required.
  async function listPublishedPosts(category) {
    const snap = await postsCol().where('published', '==', true).get();
    let posts = snap.docs.map(docToObj);
    if (category && category !== 'all') posts = posts.filter(p => p.category === category);
    return posts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getPost(id) {
    const doc = await postsCol().doc(id).get();
    return doc.exists ? docToObj(doc) : null;
  }

  async function getPostBySlug(slug) {
    const snap = await postsCol().where('slug', '==', slug).limit(1).get();
    if (snap.empty) return null;
    return docToObj(snap.docs[0]);
  }

  async function relatedPosts(category, excludeId, count) {
    const snap = await postsCol().where('published', '==', true).where('category', '==', category).get();
    return snap.docs.map(docToObj)
      .filter(p => p.id !== excludeId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, count || 3);
  }

  async function isSlugTaken(slug, excludeId) {
    const snap = await postsCol().where('slug', '==', slug).get();
    return snap.docs.some(d => d.id !== excludeId);
  }

  async function uniqueSlug(baseSlug, excludeId) {
    let slug = slugify(baseSlug) || 'post';
    let n = 2;
    while (await isSlugTaken(slug, excludeId)) {
      slug = slugify(baseSlug) + '-' + n;
      n++;
    }
    return slug;
  }

  async function savePost(post) {
    const now = Date.now();
    const id = post.id || undefined;
    const baseSlug = post.slug ? slugify(post.slug) : slugify(post.title);
    const slug = await uniqueSlug(baseSlug, id);

    if (id) {
      const patch = { ...post, slug, updatedAt: now };
      delete patch.id;
      await postsCol().doc(id).set(patch, { merge: true });
      return getPost(id);
    }

    const rec = { ...post, slug, createdAt: now, updatedAt: now };
    delete rec.id;
    const ref = await postsCol().add(rec);
    return { id: ref.id, ...rec };
  }

  async function deletePost(id) {
    await postsCol().doc(id).delete();
  }

  /* ── Payments ─────────────────────────────────────────────── */
  async function listPayments() {
    const snap = await paymentsCol().get();
    return snap.docs.map(docToObj).sort((a, b) => (b.date || 0) - (a.date || 0));
  }

  async function addPayment({ uid, email, amount, note }) {
    const rec = { uid, email, amount, note: note || '', status: 'paid', date: Date.now() };
    const ref = await paymentsCol().add(rec);
    return { id: ref.id, ...rec };
  }

  async function deletePayment(id) {
    await paymentsCol().doc(id).delete();
  }

  /* ── Analytics ────────────────────────────────────────────── */
  async function getAnalytics() {
    const [users, payments, posts, tickets] = await Promise.all([
      listUsers(), listPayments(), listPosts(), listTickets()
    ]);

    const totalUsers = users.length;
    const activeMembers = users.filter(u => u.plan === 'glory_kids' && u.planStatus === 'active').length;
    const pausedMembers = users.filter(u => u.plan === 'glory_kids' && u.planStatus === 'paused').length;
    const revenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const mrr = activeMembers * 29.99;

    const now = Date.now();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * 86400000;
      const d = new Date(dayStart);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      const count = users.filter(u => Math.floor((now - u.createdAt) / 86400000) === i).length;
      days.push({ label, count });
    }

    let savedTotal = 0;
    users.forEach(u => { savedTotal += JSON.parse(localStorage.getItem('gk_saved_' + u.uid || u.id) || '[]').length; });

    return {
      totalUsers, activeMembers, pausedMembers, revenue, mrr,
      postsCount: posts.length, publishedCount: posts.filter(p => p.published).length,
      savedTotal, signupsByDay: days,
      openTickets: tickets.filter(t => t.status === 'open').length
    };
  }

  /* ── Support tickets (from chatbot escalations / contact form) ─ */
  async function listTickets() {
    const snap = await ticketsCol().get();
    return snap.docs.map(docToObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function addTicket({ name, email, message, transcript }) {
    const rec = {
      name, email, message,
      transcript: transcript || [], status: 'open', createdAt: Date.now()
    };
    const ref = await ticketsCol().add(rec);
    return { id: ref.id, ...rec };
  }

  async function updateTicket(id, patch) {
    await ticketsCol().doc(id).set(patch, { merge: true });
  }

  async function deleteTicket(id) {
    await ticketsCol().doc(id).delete();
  }

  window.GK = {
    listUsers, getUserRecord, ensureUserRecord, updateUserRecord, deleteUserRecord,
    listPosts, listPublishedPosts, getPost, getPostBySlug, relatedPosts, savePost, deletePost,
    listPayments, addPayment, deletePayment,
    listTickets, addTicket, updateTicket, deleteTicket,
    getAnalytics, slugify
  };
})();
