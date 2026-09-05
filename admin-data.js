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
  function pagesCol()     { return db.collection('pages'); }
  function redirectsCol() { return db.collection('redirects'); }
  function analyticsCol() { return db.collection('analyticsDaily'); }
  function siteDoc()      { return db.collection('site').doc('config'); }
  function navDoc(loc)    { return db.collection('navMenus').doc(loc || 'header'); }

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

  // Public view — only posts that are published AND whose scheduled
  // publish time has passed. Sorted client-side so no composite
  // Firestore index is required.
  async function listPublishedPosts(category) {
    const snap = await postsCol().where('published', '==', true).get();
    const now = Date.now();
    let posts = snap.docs.map(docToObj).filter(p => !p.publishAt || p.publishAt <= now);
    if (category && category !== 'all') posts = posts.filter(p => p.category === category);
    return posts.sort((a, b) => (b.publishAt || b.createdAt || 0) - (a.publishAt || a.createdAt || 0));
  }

  async function getPost(id) {
    const doc = await postsCol().doc(id).get();
    return doc.exists ? docToObj(doc) : null;
  }

  // Public lookup. The security rules only permit a query that is provably
  // limited to readable docs, so a bare where('slug','==',…) is rejected for
  // non-admins with permission-denied — the published filter is required.
  // Admin callers that need drafts too can pass { includeUnpublished: true }.
  async function getPostBySlug(slug, opts) {
    let q = postsCol().where('slug', '==', slug);
    if (!opts || !opts.includeUnpublished) q = q.where('published', '==', true);
    const snap = await q.limit(1).get();
    if (snap.empty) return null;
    return docToObj(snap.docs[0]);
  }

  async function relatedPosts(category, excludeId, count) {
    const snap = await postsCol().where('published', '==', true).where('category', '==', category).get();
    const now = Date.now();
    return snap.docs.map(docToObj)
      .filter(p => p.id !== excludeId && (!p.publishAt || p.publishAt <= now))
      .sort((a, b) => (b.publishAt || b.createdAt || 0) - (a.publishAt || a.createdAt || 0))
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

    let views7 = 0, views30 = 0;
    try {
      const a = await getAnalyticsRange(30);
      views30 = a.totals.views;
      views7 = a.daily.slice(-7).reduce((s, d) => s + d.views, 0);
    } catch (e) { /* analytics optional */ }

    return {
      totalUsers, activeMembers, pausedMembers, revenue, mrr,
      postsCount: posts.length, publishedCount: posts.filter(p => p.published).length,
      savedTotal, signupsByDay: days, views7, views30,
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

  // Lightweight per-user activity log, stored in localStorage under
  // gk_activity_<uid> and read back by the dashboard's Recent Activity
  // list. Entries are { icon, title, time }. Kept to the last 50.
  function gkLogActivity(uid, icon, title) {
    if (!uid) return;
    try {
      const key = 'gk_activity_' + uid;
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({ icon: icon || '•', title: String(title || ''), time: Date.now() });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
    } catch (e) { /* storage unavailable — non-critical */ }
  }
  window.gkLogActivity = gkLogActivity;

  /* ── Site config (favicon, SEO defaults, GA4, announcement bar) ────── */
  const SITE_DEFAULTS = {
    faviconUrl: '', appleTouchIconUrl: '', siteName: 'Glory Kids Ministries',
    tagline: '', defaultMetaDescription: '', defaultOgImageUrl: '',
    twitterHandle: '', contactEmail: '', contactPhone: '',
    socialLinks: { facebook: '', instagram: '', youtube: '', tiktok: '' },
    ga4MeasurementId: '', gscVerification: '', keywords: '',
    headCode: '', bodyEndCode: '', robotsTxt: '',
    announcement: { enabled: false, text: '', linkUrl: '', linkLabel: '', bg: '#1f2937', fg: '#ffffff' },
    organization: { name: 'Glory Kids Ministries', url: '', logoUrl: '', sameAs: [] }
  };

  async function getSiteConfig() {
    try {
      const doc = await siteDoc().get();
      return { ...SITE_DEFAULTS, ...(doc.exists ? doc.data() : {}) };
    } catch (e) { return { ...SITE_DEFAULTS }; }
  }

  async function saveSiteConfig(patch) {
    await siteDoc().set({ ...patch, updatedAt: Date.now() }, { merge: true });
    return getSiteConfig();
  }

  /* ── Pages registry (visibility, per-page SEO, nav membership) ─────── */
  async function listPages() {
    const snap = await pagesCol().get();
    return snap.docs.map(docToObj)
      .sort((a, b) => (a.navOrder ?? 999) - (b.navOrder ?? 999) || String(a.path).localeCompare(String(b.path)));
  }

  // Insert any page defs that don't have a doc yet. `defs` is
  // [{ path, label, group }]. Existing docs are left untouched.
  async function seedPages(defs) {
    const existing = await pagesCol().get();
    const known = new Set(existing.docs.map(d => d.data().path));
    let order = existing.size;
    const batch = db.batch();
    let added = 0;
    (defs || []).forEach(def => {
      if (known.has(def.path)) return;
      const id = slugify(def.path.replace(/\.html$/, '')) || ('page-' + (order + 1));
      batch.set(pagesCol().doc(id), {
        path: def.path, label: def.label || def.path, group: def.group || 'Other',
        visible: true, noindex: false, inHeaderNav: !!def.inHeaderNav, inFooterNav: !!def.inFooterNav,
        navOrder: order++, seoTitle: '', seoDescription: '', ogImageUrl: '', canonicalUrl: '',
        createdAt: Date.now()
      });
      added++;
    });
    if (added) await batch.commit();
    return added;
  }

  async function savePage(id, patch) {
    await pagesCol().doc(id).set({ ...patch, updatedAt: Date.now() }, { merge: true });
    return docToObj(await pagesCol().doc(id).get());
  }

  async function deletePage(id) { await pagesCol().doc(id).delete(); }

  /* ── Redirects ────────────────────────────────────────────────────── */
  async function listRedirects() {
    const snap = await redirectsCol().get();
    return snap.docs.map(docToObj).sort((a, b) => String(a.from).localeCompare(String(b.from)));
  }
  async function saveRedirect(r) {
    const rec = { from: r.from, to: r.to, code: Number(r.code) || 301, enabled: r.enabled !== false };
    if (r.id) { await redirectsCol().doc(r.id).set(rec, { merge: true }); return { id: r.id, ...rec }; }
    const ref = await redirectsCol().add({ ...rec, createdAt: Date.now() });
    return { id: ref.id, ...rec };
  }
  async function deleteRedirect(id) { await redirectsCol().doc(id).delete(); }

  /* ── Navigation menus ─────────────────────────────────────────────── */
  async function getNavMenu(loc) {
    const doc = await navDoc(loc).get();
    return doc.exists ? (doc.data().items || []) : [];
  }
  async function saveNavMenu(loc, items) {
    await navDoc(loc).set({ items: items || [], updatedAt: Date.now() }, { merge: true });
    return items || [];
  }

  /* ── First-party analytics ────────────────────────────────────────── */
  function analyticsKey(str) {
    return String(str || '').replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 120) || 'root';
  }
  function todayStamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Fire-and-forget pageview counter. Safe for signed-out visitors.
  async function bumpAnalytics(path, referrerHost) {
    try {
      const inc = firebase.firestore.FieldValue.increment(1);
      const pathKey = analyticsKey(path || location.pathname);
      // Nested maps + merge:true so the increment targets the nested field
      // (dotted keys in set() would create a literal "a.b" field name).
      const patch = { views: inc, updatedAt: Date.now(), byPath: { [pathKey]: inc } };
      const refHost = referrerHost && analyticsKey(referrerHost);
      if (refHost && refHost !== analyticsKey(location.host)) patch.byReferrerHost = { [refHost]: inc };
      await analyticsCol().doc(todayStamp()).set(patch, { merge: true });
    } catch (e) { /* analytics is best-effort */ }
  }

  async function getAnalyticsRange(days) {
    const n = Number(days) || 30;
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      out.push(todayStamp(new Date(Date.now() - i * 86400000)));
    }
    const snaps = await Promise.all(out.map(d => analyticsCol().doc(d).get()));
    const daily = snaps.map((s, i) => ({
      date: out[i],
      views: s.exists ? (s.data().views || 0) : 0,
      byPath: s.exists ? (s.data().byPath || {}) : {},
      byReferrerHost: s.exists ? (s.data().byReferrerHost || {}) : {}
    }));
    const totals = { views: 0, byPath: {}, byReferrerHost: {} };
    daily.forEach(d => {
      totals.views += d.views;
      Object.entries(d.byPath).forEach(([k, v]) => totals.byPath[k] = (totals.byPath[k] || 0) + v);
      Object.entries(d.byReferrerHost).forEach(([k, v]) => totals.byReferrerHost[k] = (totals.byReferrerHost[k] || 0) + v);
    });
    const rank = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { daily, totals, topPages: rank(totals.byPath), topReferrers: rank(totals.byReferrerHost) };
  }

  /* ── Shop: products ───────────────────────────────────────────────── */
  function productsCol()  { return db.collection('products'); }
  function ordersCol()    { return db.collection('orders'); }
  function discountsCol()  { return db.collection('discountCodes'); }
  function mediaCol()     { return db.collection('media'); }
  function contentCol()    { return db.collection('content'); }
  function submissionsCol(){ return db.collection('formSubmissions'); }

  // Admin: every product. Public callers use listActiveProducts().
  async function listProducts() {
    const snap = await productsCol().get();
    return snap.docs.map(docToObj)
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || (b.createdAt || 0) - (a.createdAt || 0));
  }
  async function listActiveProducts() {
    const snap = await productsCol().where('active', '==', true).get();
    return snap.docs.map(docToObj).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  }
  async function getProduct(id) {
    const doc = await productsCol().doc(id).get();
    return doc.exists ? docToObj(doc) : null;
  }
  async function saveProduct(p) {
    const now = Date.now();
    const rec = { ...p };
    delete rec.id;
    rec.slug = slugify(p.slug || p.title);
    rec.priceUSD = Number(p.priceUSD) || 0;
    rec.compareAtUSD = Number(p.compareAtUSD) || 0;
    if (p.priceZAR != null) rec.priceZAR = Number(p.priceZAR) || 0; // legacy, optional
    rec.files = Array.isArray(p.files) ? p.files.filter(f => f && f.path) : [];
    rec.features = Array.isArray(p.features) ? p.features.filter(Boolean) : [];
    rec.active = p.active !== false;
    rec.type = 'digital';
    if (p.id) {
      rec.updatedAt = now;
      await productsCol().doc(p.id).set(rec, { merge: true });
      return getProduct(p.id);
    }
    rec.createdAt = now; rec.updatedAt = now;
    const ref = await productsCol().add(rec);
    return { id: ref.id, ...rec };
  }
  async function deleteProduct(id) { await productsCol().doc(id).delete(); }

  /* ── Shop: orders ─────────────────────────────────────────────────── */
  async function listOrders(limitN) {
    let q = ordersCol();
    const snap = await q.get();
    return snap.docs.map(docToObj)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, limitN || 500);
  }
  async function getOrder(id) {
    const doc = await ordersCol().doc(id).get();
    return doc.exists ? docToObj(doc) : null;
  }
  async function updateOrder(id, patch) {
    await ordersCol().doc(id).set(patch, { merge: true });
    return getOrder(id);
  }
  // Buyer's own paid orders (dashboard "My Purchases").
  async function listMyOrders(uid) {
    if (!uid) return [];
    const snap = await ordersCol().where('uid', '==', uid).get();
    return snap.docs.map(docToObj)
      .filter(o => o.status === 'paid')
      .sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0));
  }

  /* ── Shop: discount codes ─────────────────────────────────────────── */
  async function listDiscountCodes() {
    const snap = await discountsCol().get();
    return snap.docs.map(docToObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  async function saveDiscountCode(d) {
    const code = String(d.code || '').trim().toUpperCase();
    if (!code) throw new Error('Code required');
    const rec = {
      type: d.type === 'fixed' ? 'fixed' : 'percent',
      value: Number(d.value) || 0,
      active: d.active !== false,
      expiresAt: d.expiresAt || null,
      minSubtotalZAR: Number(d.minSubtotalZAR) || 0,
      maxUses: Number(d.maxUses) || 0,
      usageCount: d.usageCount || 0,
      createdAt: d.createdAt || Date.now()
    };
    await discountsCol().doc(code).set(rec, { merge: true });
    return { id: code, ...rec };
  }
  async function deleteDiscountCode(code) { await discountsCol().doc(String(code).toUpperCase()).delete(); }

  /* ── Media library ───────────────────────────────────────────────── */
  async function listMedia() {
    const snap = await mediaCol().get();
    return snap.docs.map(docToObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  async function addMedia(m) {
    const rec = {
      url: m.url, storagePath: m.storagePath || '', name: m.name || 'file',
      kind: m.kind || 'image', bytes: m.bytes || 0, w: m.w || 0, h: m.h || 0,
      folder: m.folder || '', createdAt: Date.now()
    };
    const ref = await mediaCol().add(rec);
    return { id: ref.id, ...rec };
  }
  async function deleteMedia(id) { await mediaCol().doc(id).delete(); }

  /* ── Editable page content ───────────────────────────────────────── */
  async function getContent(pageId) {
    try {
      const doc = await contentCol().doc(pageId).get();
      return doc.exists ? doc.data() : {};
    } catch (e) { return {}; }
  }
  async function saveContent(pageId, values) {
    await contentCol().doc(pageId).set({ ...values, updatedAt: Date.now() }, { merge: true });
    return getContent(pageId);
  }

  /* ── Form submissions inbox ──────────────────────────────────────── */
  async function listSubmissions(formId) {
    const snap = await submissionsCol().get();
    let rows = snap.docs.map(docToObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (formId && formId !== 'all') rows = rows.filter(r => r.formId === formId);
    return rows;
  }
  async function markSubmissionRead(id, read) {
    await submissionsCol().doc(id).set({ read: read !== false }, { merge: true });
  }
  async function deleteSubmission(id) { await submissionsCol().doc(id).delete(); }

  window.GK = {
    listUsers, getUserRecord, ensureUserRecord, updateUserRecord, deleteUserRecord,
    listPosts, listPublishedPosts, getPost, getPostBySlug, relatedPosts, savePost, deletePost,
    listPayments, addPayment, deletePayment,
    listTickets, addTicket, updateTicket, deleteTicket,
    getAnalytics, slugify, gkLogActivity,
    getSiteConfig, saveSiteConfig,
    listPages, seedPages, savePage, deletePage,
    listRedirects, saveRedirect, deleteRedirect,
    getNavMenu, saveNavMenu,
    bumpAnalytics, getAnalyticsRange,
    listProducts, listActiveProducts, getProduct, saveProduct, deleteProduct,
    listOrders, getOrder, updateOrder, listMyOrders,
    listDiscountCodes, saveDiscountCode, deleteDiscountCode,
    listMedia, addMedia, deleteMedia,
    getContent, saveContent,
    listSubmissions, markSubmissionRead, deleteSubmission
  };
})();
