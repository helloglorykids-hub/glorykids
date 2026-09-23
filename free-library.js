/* ============================================================
   free-library.js — the no-account "35 free Bible lessons" unlock
   ============================================================
   Replaces the old "create a free account" gate for the free lesson
   library with a single Name + Email capture, remembered per-browser
   via localStorage. Reuses the existing /api/mailerlite "signup-nudge"
   action/group (already wired, already working) — this file just
   changes what happens client-side on success: instant unlock instead
   of "check your inbox."

   Usage: GKFreeLibrary.requireAccess(function () { ...do the thing... })
   Calls the callback immediately if already unlocked this browser;
   otherwise shows the modal, unlocks on successful submit, then calls it.
   ============================================================ */
window.GKFreeLibrary = (function () {
  var EMAIL_KEY = 'gk_free_library_email';

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function isUnlocked() { return !!lsGet(EMAIL_KEY); }
  function unlockedEmail() { return lsGet(EMAIL_KEY) || ''; }

  function track(name, params) {
    if (typeof window.gtag === 'function') { try { window.gtag('event', name, params || {}); } catch (e) {} }
  }

  var modalEl = null;
  var pendingCallback = null;

  function buildModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'gkflModal';
    modalEl.innerHTML =
      '<div class="gkfl-backdrop"></div>' +
      '<div class="gkfl-box" role="dialog" aria-modal="true" aria-labelledby="gkflTitle">' +
        '<button type="button" class="gkfl-close" aria-label="Close">&times;</button>' +
        '<div class="gkfl-icon">📖</div>' +
        '<h3 id="gkflTitle">Get Instant Access to 35+ Free Bible Lessons</h3>' +
        '<p class="gkfl-sub">Enter your details below to unlock our complete library of free Spirit-filled children’s ministry lessons.</p>' +
        '<form class="gkfl-form">' +
          '<div class="gkfl-error" style="display:none;"></div>' +
          '<input type="text" name="firstName" placeholder="First name" autocomplete="given-name" required />' +
          '<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required />' +
          '<button type="submit">GET FREE ACCESS →</button>' +
        '</form>' +
        '<p class="gkfl-fine">Free access. No credit card required.</p>' +
      '</div>';
    document.body.appendChild(modalEl);

    var style = document.createElement('style');
    style.textContent =
      '#gkflModal{position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;padding:20px;}' +
      '#gkflModal.open{display:flex;}' +
      '#gkflModal .gkfl-backdrop{position:absolute;inset:0;background:rgba(10,10,12,0.72);}' +
      '#gkflModal .gkfl-box{position:relative;background:var(--color-card,#1f2125);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:2.25rem 2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,0.5);}' +
      '#gkflModal .gkfl-close{position:absolute;top:14px;right:16px;background:none;border:0;color:#9ca3af;font-size:1.5rem;line-height:1;cursor:pointer;}' +
      '#gkflModal .gkfl-icon{font-size:2.2rem;margin-bottom:0.5rem;}' +
      '#gkflModal h3{color:#fff;font:800 1.3rem/1.3 Poppins,system-ui,sans-serif;margin:0 0 10px;}' +
      '#gkflModal .gkfl-sub{color:#a8b0c3;font-size:0.95rem;line-height:1.5;margin:0 0 20px;}' +
      '#gkflModal .gkfl-form{display:flex;flex-direction:column;gap:12px;}' +
      '#gkflModal .gkfl-form input{width:100%;box-sizing:border-box;padding:13px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#fff;font-size:0.95rem;}' +
      '#gkflModal .gkfl-form input::placeholder{color:#6b7280;}' +
      '#gkflModal .gkfl-form button{margin-top:4px;padding:13px 16px;border:0;border-radius:10px;background:#FF4B32;color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;transition:background 0.15s ease;}' +
      '#gkflModal .gkfl-form button:hover{background:#e6421f;}' +
      '#gkflModal .gkfl-form button:disabled{opacity:0.6;cursor:default;}' +
      '#gkflModal .gkfl-error{color:#fca5a5;font-size:0.85rem;text-align:left;}' +
      '#gkflModal .gkfl-fine{color:#6b7280;font-size:0.8rem;margin:16px 0 0;}';
    document.head.appendChild(style);

    modalEl.querySelector('.gkfl-close').addEventListener('click', closeModal);
    modalEl.querySelector('.gkfl-backdrop').addEventListener('click', closeModal);
    modalEl.querySelector('.gkfl-form').addEventListener('submit', handleSubmit);

    return modalEl;
  }

  function openModal(onReady) {
    pendingCallback = onReady;
    buildModal().classList.add('open');
    track('free_library_signup_started', {});
  }

  function closeModal() {
    if (modalEl) modalEl.classList.remove('open');
    pendingCallback = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var name = form.firstName.value.trim();
    var email = form.email.value.trim();
    var errEl = form.querySelector('.gkfl-error');
    if (errEl) { errEl.style.display = 'none'; }
    if (!name || !email) return;

    var btn = form.querySelector('button[type="submit"]');
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Please wait…';

    fetch('/api/mailerlite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signup-nudge', email: email, name: name, source: location.href })
    }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { httpOk: r.ok, data: data }; });
      })
      .then(function (result) {
        var res = result.data;
        if (!result.httpOk || !res || res.ok !== true) throw new Error((res && res.error) || 'Something went wrong — please try again.');
        lsSet(EMAIL_KEY, email);
        track('free_library_signup_completed', { email_domain: (email.split('@')[1] || '') });
        btn.disabled = false;
        btn.textContent = original;
        var cb = pendingCallback;
        pendingCallback = null;
        closeModal();
        if (cb) cb();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = original;
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      });
  }

  function requireAccess(onReady) {
    track('free_lesson_cta_clicked', {});
    if (isUnlocked()) { if (onReady) onReady(); return; }
    openModal(onReady);
  }

  return { requireAccess: requireAccess, isUnlocked: isUnlocked, unlockedEmail: unlockedEmail, track: track };
})();
