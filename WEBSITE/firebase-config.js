/* ============================================================
   LOCAL AUTH BACKEND (no external services required)
   ============================================================
   Simulates the subset of the Firebase Auth JS SDK used across
   this site (auth.js, login/signup/forgot-password/dashboard),
   backed by localStorage so accounts persist across reloads.
   Swap this file for the real Firebase SDK + config later
   without touching any other file — the public API matches.
   ============================================================ */

(function () {
  const USERS_KEY   = 'gk_users';
  const SESSION_KEY = 'gk_session';

  function loadUsers() { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
  function saveUsers(list) { localStorage.setItem(USERS_KEY, JSON.stringify(list)); }

  async function hashPassword(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function authError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function genUid() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  class MockUser {
    constructor(record) {
      this.uid = record.uid;
      this.email = record.email;
      this.displayName = record.displayName || '';
      this.photoURL = record.photoURL || null;
      this.isAdmin = !!record.isAdmin;
    }
    async updateProfile({ displayName, photoURL } = {}) {
      const users = loadUsers();
      const rec = users.find(u => u.uid === this.uid);
      if (!rec) throw authError('auth/user-not-found', 'User not found.');
      if (displayName !== undefined) { rec.displayName = displayName; this.displayName = displayName; }
      if (photoURL !== undefined) { rec.photoURL = photoURL; this.photoURL = photoURL; }
      saveUsers(users);
    }
    async delete() {
      saveUsers(loadUsers().filter(u => u.uid !== this.uid));
      localStorage.removeItem('gk_saved_' + this.uid);
      localStorage.removeItem('gk_activity_' + this.uid);
      _setSession(null);
      _currentUser = null;
      _notify();
    }
  }

  let _currentUser = null;
  let _persistence = 'LOCAL';
  const _listeners = [];

  function _notify() { _listeners.slice().forEach(cb => cb(_currentUser)); }

  function _setSession(uid) {
    if (uid) {
      const payload = JSON.stringify({ uid });
      if (_persistence === 'SESSION') {
        sessionStorage.setItem(SESSION_KEY, payload);
        localStorage.removeItem(SESSION_KEY);
      } else {
        localStorage.setItem(SESSION_KEY, payload);
        sessionStorage.removeItem(SESSION_KEY);
      }
    } else {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function _restoreSession() {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const { uid } = JSON.parse(raw);
      const rec = loadUsers().find(u => u.uid === uid);
      if (rec) _currentUser = new MockUser(rec);
    } catch (e) { /* ignore corrupt session */ }
  }
  _restoreSession();

  function logActivity(uid, icon, title) {
    const key = 'gk_activity_' + uid;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift({ icon, title, time: Date.now() });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
  }
  window.gkLogActivity = logActivity;

  const auth = {
    get currentUser() { return _currentUser; },

    onAuthStateChanged(cb) {
      _listeners.push(cb);
      setTimeout(() => cb(_currentUser), 0);
      return () => {
        const i = _listeners.indexOf(cb);
        if (i > -1) _listeners.splice(i, 1);
      };
    },

    async setPersistence(p) {
      _persistence = (p === firebase.auth.Auth.Persistence.SESSION) ? 'SESSION' : 'LOCAL';
    },

    async signInWithEmailAndPassword(email, password) {
      email = String(email).trim().toLowerCase();
      const rec = loadUsers().find(u => u.email === email);
      if (!rec) throw authError('auth/user-not-found', 'No account found with that email address.');
      const h = await hashPassword(password);
      if (h !== rec.passwordHash) throw authError('auth/wrong-password', 'Incorrect password.');
      _currentUser = new MockUser(rec);
      _setSession(rec.uid);
      logActivity(rec.uid, '🔑', 'Signed in');
      _notify();
      return { user: _currentUser };
    },

    async createUserWithEmailAndPassword(email, password) {
      email = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authError('auth/invalid-email', 'Please enter a valid email address.');
      if (password.length < 6) throw authError('auth/weak-password', 'Password must be at least 6 characters.');
      const users = loadUsers();
      if (users.find(u => u.email === email)) throw authError('auth/email-already-in-use', 'An account with this email already exists.');
      const rec = {
        uid: genUid(), email, passwordHash: await hashPassword(password),
        displayName: '', photoURL: null, createdAt: Date.now(),
        isAdmin: false, plan: 'free', planStatus: 'active'
      };
      users.push(rec);
      saveUsers(users);
      _currentUser = new MockUser(rec);
      _setSession(rec.uid);
      logActivity(rec.uid, '🌟', 'Account created');
      _notify();
      return { user: _currentUser };
    },

    async signOut() {
      _currentUser = null;
      _setSession(null);
      _notify();
    },

    async sendPasswordResetEmail(email) {
      // Always resolves (no email transport in this local demo backend).
      return Promise.resolve();
    },

    async signInWithPopup(provider) {
      // No real OAuth provider is configured, so we simulate a signed-in
      // Google account locally. Swap in the real Firebase SDK to go live.
      const demoEmail = 'demo.google.user@gmail.com';
      const users = loadUsers();
      let rec = users.find(u => u.email === demoEmail);
      let isNew = false;
      if (!rec) {
        rec = {
          uid: genUid(), email: demoEmail, passwordHash: null,
          displayName: 'Demo Google User', photoURL: null, createdAt: Date.now(),
          isAdmin: false, plan: 'free', planStatus: 'active'
        };
        users.push(rec);
        saveUsers(users);
        isNew = true;
      }
      _currentUser = new MockUser(rec);
      _setSession(rec.uid);
      logActivity(rec.uid, isNew ? '🌟' : '🔑', isNew ? 'Account created via Google' : 'Signed in via Google');
      _notify();
      return { user: _currentUser };
    }
  };

  function GoogleAuthProvider() { this.setCustomParameters = function () {}; }

  window.firebase = {
    apps: [{}],
    initializeApp() {},
    auth: Object.assign(function () { return auth; }, {
      Auth: { Persistence: { LOCAL: 'LOCAL', SESSION: 'SESSION' } },
      GoogleAuthProvider
    })
  };

  window.auth = auth;
  window.googleProvider = new GoogleAuthProvider();
})();
