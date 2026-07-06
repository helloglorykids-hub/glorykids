/* ============================================================
   ADMIN DATA LAYER (local demo backend)
   ============================================================
   Shared read/write helpers for the admin panel: users/members,
   blog posts, and payments. Backed by localStorage — mirrors
   what would live in Firestore/a real DB in a production build.
   Exposed as a single window.GK namespace.
   ============================================================ */

(function () {
  const USERS_KEY    = 'gk_users';
  const POSTS_KEY     = 'gk_blog_posts';
  const PAYMENTS_KEY  = 'gk_payments';
  const TICKETS_KEY   = 'gk_support_tickets';

  function read(key, fallback) { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function genId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ── Users / Members ─────────────────────────────────────── */
  function listUsers() {
    return read(USERS_KEY, []).map(u => {
      const { passwordHash, ...safe } = u;
      return safe;
    });
  }

  function getUserRecord(uid) {
    const u = read(USERS_KEY, []).find(u => u.uid === uid);
    if (!u) return null;
    const { passwordHash, ...safe } = u;
    return safe;
  }

  function updateUserRecord(uid, patch) {
    const users = read(USERS_KEY, []);
    const rec = users.find(u => u.uid === uid);
    if (!rec) return null;
    Object.assign(rec, patch);
    write(USERS_KEY, users);
    return rec;
  }

  function deleteUserRecord(uid) {
    write(USERS_KEY, read(USERS_KEY, []).filter(u => u.uid !== uid));
    localStorage.removeItem('gk_saved_' + uid);
    localStorage.removeItem('gk_activity_' + uid);
  }

  /* ── Blog posts ───────────────────────────────────────────── */
  function listPosts() {
    return read(POSTS_KEY, []).sort((a, b) => b.createdAt - a.createdAt);
  }

  function getPost(id) {
    return read(POSTS_KEY, []).find(p => p.id === id) || null;
  }

  function savePost(post) {
    const posts = read(POSTS_KEY, []);
    if (post.id) {
      const idx = posts.findIndex(p => p.id === post.id);
      if (idx > -1) { posts[idx] = { ...posts[idx], ...post, updatedAt: Date.now() }; write(POSTS_KEY, posts); return posts[idx]; }
    }
    const rec = { ...post, id: genId('post'), createdAt: Date.now(), updatedAt: Date.now() };
    posts.push(rec);
    write(POSTS_KEY, posts);
    return rec;
  }

  function deletePost(id) {
    write(POSTS_KEY, read(POSTS_KEY, []).filter(p => p.id !== id));
  }

  /* ── Payments ─────────────────────────────────────────────── */
  function listPayments() {
    return read(PAYMENTS_KEY, []).sort((a, b) => b.date - a.date);
  }

  function addPayment({ uid, email, amount, note }) {
    const payments = read(PAYMENTS_KEY, []);
    const rec = { id: genId('pay'), uid, email, amount, note: note || '', status: 'paid', date: Date.now() };
    payments.push(rec);
    write(PAYMENTS_KEY, payments);
    return rec;
  }

  function deletePayment(id) {
    write(PAYMENTS_KEY, read(PAYMENTS_KEY, []).filter(p => p.id !== id));
  }

  /* ── Analytics ────────────────────────────────────────────── */
  function getAnalytics() {
    const users = read(USERS_KEY, []);
    const payments = read(PAYMENTS_KEY, []);
    const posts = read(POSTS_KEY, []);

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
      const count = users.filter(u => {
        const diffDays = Math.floor((now - u.createdAt) / 86400000);
        return diffDays === i;
      }).length;
      days.push({ label, count });
    }

    let savedTotal = 0;
    users.forEach(u => {
      savedTotal += read('gk_saved_' + u.uid, []).length;
    });

    const tickets = read(TICKETS_KEY, []);

    return {
      totalUsers, activeMembers, pausedMembers, revenue, mrr,
      postsCount: posts.length, publishedCount: posts.filter(p => p.published).length,
      savedTotal, signupsByDay: days,
      openTickets: tickets.filter(t => t.status === 'open').length
    };
  }

  /* ── Support tickets (from chatbot escalations / contact form) ─ */
  function listTickets() {
    return read(TICKETS_KEY, []).sort((a, b) => b.createdAt - a.createdAt);
  }

  function addTicket({ name, email, message, transcript }) {
    const tickets = read(TICKETS_KEY, []);
    const rec = {
      id: genId('ticket'), name, email, message,
      transcript: transcript || [], status: 'open', createdAt: Date.now()
    };
    tickets.push(rec);
    write(TICKETS_KEY, tickets);
    return rec;
  }

  function updateTicket(id, patch) {
    const tickets = read(TICKETS_KEY, []);
    const rec = tickets.find(t => t.id === id);
    if (!rec) return null;
    Object.assign(rec, patch);
    write(TICKETS_KEY, tickets);
    return rec;
  }

  function deleteTicket(id) {
    write(TICKETS_KEY, read(TICKETS_KEY, []).filter(t => t.id !== id));
  }

  window.GK = {
    listUsers, getUserRecord, updateUserRecord, deleteUserRecord,
    listPosts, getPost, savePost, deletePost,
    listPayments, addPayment, deletePayment,
    listTickets, addTicket, updateTicket, deleteTicket,
    getAnalytics
  };
})();
