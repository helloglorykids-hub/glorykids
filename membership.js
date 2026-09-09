/* ============================================================
   membership.js — Glory Kids Membership: waitlist + checkout
   ============================================================
   Two modes, controlled by MEMBERSHIP_LIVE below:

   • Waitlist mode (pre-launch, default): every plan button opens a
     modal that captures an email into the MailerLite "Membership
     Waitlist" group (via the same /api/mailerlite the rest of the
     site uses).

   • Checkout mode: plan buttons start a real PayFast recurring-
     billing subscription. Signed-out visitors are sent to sign up
     first, then bounced back here to finish.

   TO GO LIVE:
     1. set  MEMBERSHIP_LIVE = true   (below)
     2. set Netlify env  MEMBERSHIP_LIVE = true
   Test the real flow anytime before launch with  ?checkout=1
   (admins can always run checkout regardless of the flag).
   ============================================================ */
(function () {
  'use strict';

  var MEMBERSHIP_LIVE = false;
  var forceCheckout = /[?&]checkout=1\b/.test(location.search);
  var LIVE = MEMBERSHIP_LIVE || forceCheckout;

  var PLAN_LABEL = { monthly: 'Monthly', annual: 'Annual' };

  /* ---------- tiny modal ---------------------------------------------- */
  function injectStyles() {
    if (document.getElementById('gk-mem-styles')) return;
    var s = document.createElement('style');
    s.id = 'gk-mem-styles';
    s.textContent = [
      '.gk-mem-ov{position:fixed;inset:0;background:rgba(10,12,16,.72);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:1.25rem;z-index:9999;opacity:0;visibility:hidden;transition:opacity .2s}',
      '.gk-mem-ov.open{opacity:1;visibility:visible}',
      '.gk-mem-modal{background:#fff;color:#1f2430;border-radius:18px;max-width:420px;width:100%;padding:1.75rem;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(12px);transition:transform .2s}',
      '.gk-mem-ov.open .gk-mem-modal{transform:none}',
      '.gk-mem-modal h3{font:800 1.25rem/1.3 Poppins,system-ui,sans-serif;margin:0 0 .4rem;color:#1f2430;-webkit-text-fill-color:#1f2430;background:none}',
      '.gk-mem-modal p{font:400 .9rem/1.55 Poppins,system-ui,sans-serif;color:#5b6472;margin:0 0 1.1rem}',
      '.gk-mem-modal p strong{color:#1f2430}',
      '.gk-mem-modal label{display:block;font:700 .78rem Poppins,system-ui,sans-serif;margin:0 0 .35rem;color:#1f2430}',
      '.gk-mem-modal input{width:100%;padding:.7rem .85rem;border:1px solid #d5d9e0;border-radius:10px;font:400 .95rem Poppins,system-ui,sans-serif;margin-bottom:.85rem;color:#1f2430;background:#fff}',
      '.gk-mem-modal input:focus{outline:none;border-color:#66249A;box-shadow:0 0 0 3px rgba(102,36,154,.12)}',
      '.gk-mem-btn{width:100%;border:0;border-radius:10px;padding:.85rem 1rem;font:700 .95rem Poppins,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#FF4B32,#FF6B4A);cursor:pointer}',
      '.gk-mem-btn:disabled{opacity:.6;cursor:not-allowed}',
      '.gk-mem-x{position:absolute;top:.6rem;right:.9rem;background:none;border:0;font-size:1.4rem;color:#9aa2af;cursor:pointer;line-height:1}',
      '.gk-mem-note{font:600 .9rem/1.5 Poppins,system-ui,sans-serif;padding:1rem;border-radius:12px;background:#e7f6ec;color:#1b7a3d}',
      '.gk-mem-err{color:#c0392b;font:600 .82rem Poppins,system-ui,sans-serif;margin:-.4rem 0 .7rem;display:none}'
    ].join('');
    document.head.appendChild(s);
  }

  var ov;
  function buildModal() {
    injectStyles();
    ov = document.createElement('div');
    ov.className = 'gk-mem-ov';
    ov.innerHTML =
      '<div class="gk-mem-modal" style="position:relative">' +
      '<button class="gk-mem-x" aria-label="Close">&times;</button>' +
      '<div class="gk-mem-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.gk-mem-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  function open() { if (!ov) buildModal(); ov.classList.add('open'); }
  function close() { if (ov) ov.classList.remove('open'); }
  function body() { return ov.querySelector('.gk-mem-body'); }

  /* ---------- waitlist ----------------------------------------------- */
  var WAIT_FLAG = 'gk_waitlist_optin';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function showWaitlist(plan) {
    open();
    if (lsGet(WAIT_FLAG)) {
      body().innerHTML = '<div class="gk-mem-note">✅ You’re already on the waitlist — we’ll email you the moment Glory Kids Membership opens.</div>';
      return;
    }
    var planNote = plan && PLAN_LABEL[plan] ? ' (' + PLAN_LABEL[plan] + ' plan)' : '';
    body().innerHTML =
      '<h3>Join the waitlist</h3>' +
      '<p>Glory Kids Membership opens <strong>September 15, 2026</strong>' + planNote + '. Add your email and we’ll let you know the moment it’s live.</p>' +
      '<div class="gk-mem-err" id="gk-mem-err"></div>' +
      '<label for="gk-mem-name">Your name <span style="font-weight:400;color:#9aa2af">(optional)</span></label>' +
      '<input id="gk-mem-name" type="text" autocomplete="name" placeholder="First name">' +
      '<label for="gk-mem-email">Email</label>' +
      '<input id="gk-mem-email" type="email" required autocomplete="email" placeholder="you@example.com">' +
      '<button class="gk-mem-btn" id="gk-mem-go">Notify me at launch →</button>';

    var go = body().querySelector('#gk-mem-go');
    go.addEventListener('click', function () {
      var email = (body().querySelector('#gk-mem-email').value || '').trim();
      var name = (body().querySelector('#gk-mem-name').value || '').trim();
      var err = body().querySelector('#gk-mem-err');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        err.textContent = 'Please enter a valid email address.'; err.style.display = 'block'; return;
      }
      err.style.display = 'none';
      go.disabled = true; go.textContent = 'Adding you…';
      // Goes through form-submit so there's a durable record in the admin
      // inbox even if MailerLite is momentarily unavailable; it also fires
      // the MailerLite "Membership Waitlist" group + automation.
      fetch('/api/form-submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: 'waitlist', data: { email: email, name: name }, pageUrl: location.href })
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          if (res && (res.ok || res.already || res.id)) {
            lsSet(WAIT_FLAG, '1');
            body().innerHTML = '<div class="gk-mem-note">' +
              (res.already
                ? '✅ You’re already on the waitlist — hang tight, we’ll be in touch soon.'
                : '✅ You’re on the list! We’ll email <strong>' + email.replace(/[<>&]/g, '') + '</strong> the moment Glory Kids Membership opens.') +
              '</div>';
          } else { throw new Error((res && res.error) || 'Something went wrong'); }
        })
        .catch(function (e) {
          err.textContent = e.message + ' — please try again.'; err.style.display = 'block';
          go.disabled = false; go.textContent = 'Notify me at launch →';
        });
    });
    body().querySelector('#gk-mem-email').focus();
  }

  /* ---------- checkout ---------------------------------------------- */
  function currentUser() {
    return (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null;
  }

  function startCheckout(plan) {
    plan = PLAN_LABEL[plan] ? plan : 'monthly';
    var user = currentUser();
    if (!user) {
      // Send them to sign up, then straight back into checkout for this plan.
      var back = 'glory-kids-membership.html?checkout=1&plan=' + plan + '#pricing';
      location.href = 'signup.html?redirect=' + encodeURIComponent(back);
      return;
    }
    open();
    body().innerHTML = '<h3>Starting your membership…</h3><p>One moment — taking you to our secure payment page.</p>';

    user.getIdToken().then(function (idToken) {
      return fetch('/api/membership-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ plan: plan })
      });
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) {
        body().innerHTML = '<h3>Hold on</h3><p>' + ((res.d && res.d.error) || 'We couldn’t start the subscription just now.') + '</p>' +
          (res.d && res.d.already ? '<a class="gk-mem-btn" style="display:block;text-align:center;text-decoration:none" href="dashboard.html">Go to my dashboard →</a>' : '');
        return;
      }
      var f = document.createElement('form');
      f.method = 'POST';
      f.action = res.d.processUrl;
      Object.keys(res.d.fields).forEach(function (k) {
        var i = document.createElement('input');
        i.type = 'hidden'; i.name = k; i.value = res.d.fields[k];
        f.appendChild(i);
      });
      document.body.appendChild(f);
      f.submit();
    }).catch(function () {
      body().innerHTML = '<h3>Something went wrong</h3><p>Please try again in a moment, or email us and we’ll sort it out.</p>';
    });
  }

  /* ---------- wire the page ----------------------------------------- */
  function handleCta(e, plan) {
    e.preventDefault();
    if (LIVE) startCheckout(plan || 'monthly');
    else showWaitlist(plan);
  }

  function init() {
    // Plan buttons: <... data-plan="monthly|annual"> anywhere on the page.
    document.querySelectorAll('[data-plan]').forEach(function (el) {
      el.addEventListener('click', function (e) { handleCta(e, el.getAttribute('data-plan')); });
    });
    // Generic "join / waitlist" buttons opted in with data-membership-cta.
    document.querySelectorAll('[data-membership-cta]').forEach(function (el) {
      el.addEventListener('click', function (e) { handleCta(e, el.getAttribute('data-membership-cta') || null); });
    });

    // Arriving back from signup with ?checkout=1&plan=… → resume automatically.
    if (LIVE) {
      var m = /[?&]plan=(monthly|annual)/.exec(location.search);
      if (m && forceCheckout && currentUser() !== undefined) {
        // wait a tick for firebase auth to resolve
        var tries = 0;
        var t = setInterval(function () {
          tries++;
          if (currentUser()) { clearInterval(t); startCheckout(m[1]); }
          else if (tries > 20) clearInterval(t);
        }, 250);
      }
    }

    // Reflect live/waitlist state in button copy where it helps.
    if (LIVE) {
      document.querySelectorAll('[data-plan]').forEach(function (el) {
        if (/waitlist/i.test(el.textContent)) {
          el.textContent = el.getAttribute('data-plan') === 'annual' ? 'Subscribe — Annual →' : 'Subscribe — Monthly →';
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.GKMembership = { waitlist: showWaitlist, checkout: startCheckout, live: LIVE };
})();
