/* ============================================================
   GLORY KIDS — AUTH MODULE
   Handles: auth state, nav injection, page guards, logout
   ============================================================ */

/* ─── Wait for Firebase to be ready ─────────────────────────── */
function onFirebaseReady(cb) {
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
    cb();
  } else {
    document.addEventListener('DOMContentLoaded', cb);
  }
}

onFirebaseReady(() => {
  /* ─── AUTH STATE OBSERVER — runs on every page ─────────────── */
  auth.onAuthStateChanged(user => {
    updateNav(user);

    // Protect dashboard — redirect to login if not signed in
    const isProtected = document.body.dataset.protected === 'true';
    if (isProtected && !user) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname);
    }

    // Redirect away from login/signup if already signed in
    const isAuthPage = document.body.dataset.authPage === 'true';
    if (isAuthPage && user) {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('redirect') || 'dashboard.html';
    }
  });
});

/* ─── UPDATE NAV BASED ON AUTH STATE ───────────────────────── */
function updateNav(user) {
  const actions = document.querySelector('.nav__actions');
  if (!actions) return;

  if (user) {
    const initials = getInitials(user.displayName || user.email);
    const photoURL  = user.photoURL;
    actions.innerHTML = `
      <a href="dashboard.html" class="nav__link" style="font-weight:600;">My Library</a>
      <div class="nav__user" id="nav-user-menu">
        <button class="nav__user-btn" onclick="toggleUserMenu()">
          ${photoURL
            ? `<img src="${photoURL}" class="nav__user-photo" alt="Profile" />`
            : `<div class="nav__user-initials">${initials}</div>`}
          <span class="nav__user-name">${(user.displayName || user.email).split(' ')[0]}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="opacity:.6"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
        <div class="nav__user-dropdown" id="user-dropdown">
          <div class="nav__user-info">
            <div class="nav__user-info-name">${user.displayName || 'Member'}</div>
            <div class="nav__user-info-email">${user.email}</div>
          </div>
          <div class="nav__user-dropdown-divider"></div>
          <a href="dashboard.html" class="nav__user-dropdown-item">📚 My Dashboard</a>
          <a href="glory-kids-membership.html" class="nav__user-dropdown-item">✨ Upgrade to Glory Kids</a>
          <a href="free-lessons.html" class="nav__user-dropdown-item">📖 Free Lessons</a>
          <div class="nav__user-dropdown-divider"></div>
          <button class="nav__user-dropdown-item nav__user-dropdown-signout" onclick="signOut()">
            Sign Out
          </button>
        </div>
      </div>
    `;
    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
      if (!document.getElementById('nav-user-menu')?.contains(e.target)) {
        closeUserMenu();
      }
    });
  } else {
    actions.innerHTML = `
      <a href="shop.html" class="btn btn--outline" style="padding:0.55rem 1.25rem;font-size:0.875rem;border-radius:var(--radius-full);border-color:var(--coral);color:var(--coral);">🛒 Shop</a>
      <a href="login.html" class="btn" style="padding:0.55rem 1.25rem;font-size:0.875rem;border-radius:var(--radius-full);background:var(--coral);color:white;font-weight:700;">Login</a>
    `;
  }

  // Also update scrolled state colour for .nav__link
  const nav = document.getElementById('nav');
  if (nav && !nav.classList.contains('scrolled')) {
    actions.querySelectorAll('.nav__link').forEach(l => {
      l.style.color = 'rgba(255,255,255,0.9)';
    });
  }
}

/* ─── USER MENU TOGGLE ──────────────────────────────────────── */
function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.classList.toggle('open');
}
function closeUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.classList.remove('open');
}

/* ─── SIGN OUT ──────────────────────────────────────────────── */
async function signOut() {
  await auth.signOut();
  window.location.href = 'index.html';
}

/* ─── HELPERS ────────────────────────────────────────────────── */
function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '?';
  const parts = nameOrEmail.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return nameOrEmail[0].toUpperCase();
}

function showAuthError(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'flex';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearAuthError(elId) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found':        'No account found with that email address.',
    'auth/wrong-password':        'Incorrect password. Please try again.',
    'auth/email-already-in-use':  'An account with this email already exists.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/popup-closed-by-user':  'Google sign-in was cancelled.',
    'auth/network-request-failed':'Network error. Please check your connection.',
    'auth/too-many-requests':     'Too many attempts. Please try again later.',
    'auth/invalid-credential':    'Invalid email or password. Please try again.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function setLoading(btnId, loading, text) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="auth-spinner"></span> ${text || 'Please wait...'}`
    : btn.dataset.original;
}

/* ─── LOGIN FORM ─────────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  clearAuthError('login-error');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('remember-me')?.checked;

  const btn = document.getElementById('login-btn');
  btn.dataset.original = btn.innerHTML;
  setLoading('login-btn', true, 'Signing in...');

  try {
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will redirect
  } catch (err) {
    setLoading('login-btn', false);
    showAuthError('login-error', friendlyError(err.code));
  }
}

/* ─── SIGNUP FORM ────────────────────────────────────────────── */
async function handleSignup(e) {
  e.preventDefault();
  clearAuthError('signup-error');
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm').value;

  if (password !== confirm) {
    return showAuthError('signup-error', 'Passwords do not match.');
  }
  if (password.length < 6) {
    return showAuthError('signup-error', 'Password must be at least 6 characters.');
  }

  const btn = document.getElementById('signup-btn');
  btn.dataset.original = btn.innerHTML;
  setLoading('signup-btn', true, 'Creating account...');

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // Trigger state change manually since profile update doesn't fire it
    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get('redirect') || 'dashboard.html';
  } catch (err) {
    setLoading('signup-btn', false);
    showAuthError('signup-error', friendlyError(err.code));
  }
}

/* ─── GOOGLE SIGN IN ─────────────────────────────────────────── */
async function signInWithGoogle(redirectAfter) {
  clearAuthError('login-error');
  clearAuthError('signup-error');
  try {
    await auth.signInWithPopup(googleProvider);
    const params = new URLSearchParams(window.location.search);
    window.location.href = redirectAfter || params.get('redirect') || 'dashboard.html';
  } catch (err) {
    showAuthError('login-error', friendlyError(err.code));
    showAuthError('signup-error', friendlyError(err.code));
  }
}

/* ─── PASSWORD RESET ─────────────────────────────────────────── */
async function handlePasswordReset(e) {
  e.preventDefault();
  clearAuthError('reset-error');
  const email = document.getElementById('reset-email').value.trim();
  const btn = document.getElementById('reset-btn');
  btn.dataset.original = btn.innerHTML;
  setLoading('reset-btn', true, 'Sending...');
  try {
    await auth.sendPasswordResetEmail(email);
    document.getElementById('reset-form').style.display  = 'none';
    document.getElementById('reset-success').style.display = 'block';
  } catch (err) {
    setLoading('reset-btn', false);
    showAuthError('reset-error', friendlyError(err.code));
  }
}

/* ─── PASSWORD TOGGLE ────────────────────────────────────────── */
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁️' : '🙈';
}

/* ─── PASSWORD STRENGTH ──────────────────────────────────────── */
function checkPasswordStrength(val) {
  const bar = document.getElementById('strength-bar');
  const txt = document.getElementById('strength-text');
  if (!bar || !txt) return;
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const levels = [
    { label: '', color: 'var(--gray-200)', width: '0%' },
    { label: 'Weak',   color: 'var(--rose)',    width: '25%' },
    { label: 'Fair',   color: 'var(--coral)',   width: '50%' },
    { label: 'Good',   color: 'var(--gold)',    width: '75%' },
    { label: 'Strong', color: 'var(--green)',   width: '100%' },
  ];
  const lvl = levels[score];
  bar.style.width = lvl.width;
  bar.style.background = lvl.color;
  txt.textContent = lvl.label;
  txt.style.color = lvl.color;
}
