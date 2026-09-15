/* ============================================================
   membership.js — Glory Kids Membership: waitlist + checkout
   ============================================================
   Two modes, controlled by MEMBERSHIP_LIVE below:

   • Waitlist mode (pre-launch, default): every plan button opens a
     modal that captures an email into the MailerLite "Membership
     Waitlist" group (via the same /api/mailerlite the rest of the
     site uses).

   • Checkout mode: plan buttons start a real PayPal Subscriptions
     billing plan, rendered as a PayPal button INSIDE the modal (not
     a redirect — PayPal Subscriptions are created client-side via
     their JS SDK). Signed-out visitors are sent to sign up first,
     then bounced back here to finish.

   TO GO LIVE:
     1. set  MEMBERSHIP_LIVE = true   (below)
     2. set Netlify env  MEMBERSHIP_LIVE = true, PAYPAL_CLIENT_ID,
        PAYPAL_CLIENT_SECRET, PAYPAL_PLAN_MONTHLY, PAYPAL_PLAN_ANNUAL
   Test the real flow anytime before launch with  ?checkout=1
   (admins can always run checkout regardless of the flag).
   ============================================================ */
(function () {
  'use strict';

  var MEMBERSHIP_LIVE = true;
  var forceCheckout = /[?&]checkout=1\b/.test(location.search);
  var LIVE = MEMBERSHIP_LIVE || forceCheckout;

  var PLAN_LABEL = {
    monthly: 'Monthly', annual: 'Annual', church: 'Church Monthly', 'church-annual': 'Church Annual'
  };
  var isChurchPlan = function (p) { return p === 'church' || p === 'church-annual'; };

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

  // PayPal's JS SDK needs to be loaded once, with the client-id in the
  // script URL itself — can't be requested per-checkout like a normal API
  // call. Cached on window so repeat checkouts in one page view don't
  // re-inject it.
  var PAYPAL_CLIENT_ID = 'BAApvD_Zb9FcjZo44jT5oUS-v8iSA788-nrLqh8GmwVJpBcs2O3TtLGVCTbKi_Oc9Zg_a3G6YQWKD2R308';
  var paypalSdkPromise = null;
  function loadPaypalSdk() {
    if (window.paypal) return Promise.resolve(window.paypal);
    if (paypalSdkPromise) return paypalSdkPromise;
    paypalSdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + PAYPAL_CLIENT_ID + '&vault=true&intent=subscription';
      s.onload = function () { resolve(window.paypal); };
      s.onerror = function () { reject(new Error('Could not load PayPal.')); };
      document.head.appendChild(s);
    });
    return paypalSdkPromise;
  }

  // Shared by individual + church checkout once we know exactly which plan
  // key, org name (church only) and location count (church only) to send.
  function runPaypalCheckout(user, planKey, extra) {
    body().innerHTML = '<h3>Starting your membership…</h3><p>One moment…</p>';

    user.getIdToken().then(function (idToken) {
      return Promise.all([
        idToken,
        fetch('/api/paypal-subscription-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify(Object.assign({ plan: planKey }, extra || {}))
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }),
        loadPaypalSdk()
      ]);
    }).then(function (results) {
      var idToken = results[0], res = results[1], paypal = results[2];
      if (!res.ok) {
        body().innerHTML = '<h3>Hold on</h3><p>' + ((res.d && res.d.error) || 'We couldn’t start checkout just now.') + '</p>' +
          (res.d && res.d.already ? '<a class="gk-mem-btn" style="display:block;text-align:center;text-decoration:none" href="dashboard.html">Go to my dashboard →</a>' : '');
        return;
      }
      var subId = res.d.subId, ppPlanId = res.d.ppPlanId, quantity = res.d.quantity || 1;

      body().innerHTML =
        '<h3>' + PLAN_LABEL[planKey] + ' Membership</h3>' +
        '<p>Complete your subscription with PayPal below.</p>' +
        '<div class="gk-mem-err" id="gk-mem-err"></div>' +
        '<div id="gk-paypal-btn"></div>';

      paypal.Buttons({
        style: { shape: 'pill', color: 'blue', layout: 'vertical', label: 'subscribe' },
        createSubscription: function (data, actions) {
          return actions.subscription.create({ plan_id: ppPlanId, quantity: quantity, custom_id: subId });
        },
        onApprove: function (data) {
          body().innerHTML = '<h3>Confirming your payment…</h3><p>One moment — almost done.</p>';
          fetch('/api/paypal-subscription-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
            body: JSON.stringify({ subId: subId, ppSubscriptionId: data.subscriptionID })
          }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res2) {
              if (res2.ok && res2.d.ok) {
                location.href = 'dashboard.html?welcome=member';
              } else {
                body().innerHTML = '<h3>Almost there</h3><p>Your payment is processing — this can take a minute. Check your <a href="dashboard.html">dashboard</a> shortly; if it hasn’t unlocked in a few minutes, contact us and we’ll sort it out.</p>';
              }
            }).catch(function () {
              body().innerHTML = '<h3>Almost there</h3><p>Your payment is processing — check your <a href="dashboard.html">dashboard</a> shortly.</p>';
            });
        },
        onError: function (err) {
          console.error('PayPal button error', err);
          var e = body().querySelector('#gk-mem-err');
          if (e) { e.textContent = 'Something went wrong with PayPal — please try again.'; e.style.display = 'block'; }
        }
      }).render('#gk-paypal-btn');
    }).catch(function () {
      body().innerHTML = '<h3>Something went wrong</h3><p>Please try again in a moment, or email us and we’ll sort it out.</p>';
    });
  }

  function showChurchLocationStep(user, orgName, frequency) {
    var planKey = frequency === 'annual' ? 'church-annual' : 'church';
    body().innerHTML =
      '<h3>Church plan</h3>' +
      '<p>' + (frequency === 'annual' ? '$799/year' : '$79/month') + ' includes one church location with full team access. Extra locations are +$49/mo each.</p>' +
      '<div class="gk-mem-err" id="gk-mem-err"></div>' +
      '<label for="gk-locations">Number of church locations</label>' +
      '<input id="gk-locations" type="number" min="1" step="1" value="1">' +
      '<button class="gk-mem-btn" id="gk-loc-go">Continue to payment →</button>';
    body().querySelector('#gk-loc-go').addEventListener('click', function () {
      var n = parseInt(body().querySelector('#gk-locations').value, 10);
      var err = body().querySelector('#gk-mem-err');
      if (!n || n < 1) { err.textContent = 'Please enter at least 1 location.'; err.style.display = 'block'; return; }
      runPaypalCheckout(user, planKey, { orgName: orgName, locations: n });
    });
  }

  function showChurchFrequencyStep(user, orgName) {
    body().innerHTML =
      '<h3>Church plan</h3>' +
      '<p>Choose how you’d like to be billed.</p>' +
      '<button class="gk-mem-btn" id="gk-freq-monthly" style="margin-bottom:0.6rem;">$79/month</button>' +
      '<button class="gk-mem-btn" id="gk-freq-annual" style="background:linear-gradient(135deg,#FFB000,#FF8A00);">$799/year — Save $149</button>';
    body().querySelector('#gk-freq-monthly').addEventListener('click', function () { showChurchLocationStep(user, orgName, 'monthly'); });
    body().querySelector('#gk-freq-annual').addEventListener('click', function () { showChurchLocationStep(user, orgName, 'annual'); });
  }

  function startCheckout(plan, orgName) {
    plan = PLAN_LABEL[plan] ? plan : 'monthly';
    var user = currentUser();
    if (!user) {
      // Send them to sign up, then straight back into checkout for this plan.
      var back = 'glory-kids-curriculum.html?checkout=1&plan=' + plan + '#pricing';
      location.href = 'signup.html?redirect=' + encodeURIComponent(back);
      return;
    }
    open();

    // Church plans need the church/ministry name first, then billing
    // frequency, then how many locations — only then do we know which
    // PayPal plan + quantity to check out with.
    if (isChurchPlan(plan) && !orgName) {
      body().innerHTML =
        '<h3>Church plan</h3>' +
        '<p>What’s the name of your church or ministry? This licenses the curriculum to your whole team.</p>' +
        '<div class="gk-mem-err" id="gk-mem-err"></div>' +
        '<label for="gk-org">Church / ministry name</label>' +
        '<input id="gk-org" type="text" placeholder="Grace Community Church">' +
        '<button class="gk-mem-btn" id="gk-org-go">Continue →</button>';
      body().querySelector('#gk-org-go').addEventListener('click', function () {
        var v = (body().querySelector('#gk-org').value || '').trim();
        var err = body().querySelector('#gk-mem-err');
        if (v.length < 2) { err.textContent = 'Please enter your church or ministry name.'; err.style.display = 'block'; return; }
        showChurchFrequencyStep(user, v);
      });
      body().querySelector('#gk-org').focus();
      return;
    }
    if (isChurchPlan(plan)) {
      showChurchFrequencyStep(user, orgName);
      return;
    }

    runPaypalCheckout(user, plan);
  }

  /* ---------- wire the page ----------------------------------------- */
  function handleCta(e, plan) {
    e.preventDefault();
    if (LIVE) startCheckout(plan || 'monthly');
    else showWaitlist(plan);
  }

  function init() {
    // Delegated so it also catches pricing cards injected later by
    // pricing-data.js / content.js.
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-checkout-plan],[data-membership-cta]');
      if (!el) return;
      if (el.hasAttribute('data-checkout-plan')) handleCta(e, el.getAttribute('data-checkout-plan'));
      else handleCta(e, el.getAttribute('data-membership-cta') || null);
    });

    // Arriving back from signup with ?checkout=1&plan=… → resume automatically.
    if (LIVE) {
      var m = /[?&]plan=([a-z-]+)/.exec(location.search);
      if (m && PLAN_LABEL[m[1]] && forceCheckout) {
        var tries = 0;
        var t = setInterval(function () {
          tries++;
          if (currentUser()) { clearInterval(t); startCheckout(m[1]); }
          else if (tries > 20) clearInterval(t);
        }, 250);
      }
    }

    // Reflect live state in button copy. Runs a few times because some
    // pricing cards are injected after load by pricing-data.js / content.js.
    if (LIVE) {
      var relabel = function () {
        document.querySelectorAll('[data-checkout-plan]').forEach(function (el) {
          if (/waitlist/i.test(el.textContent)) {
            var lbl = PLAN_LABEL[el.getAttribute('data-checkout-plan')] || 'Now';
            el.textContent = 'Subscribe — ' + lbl + ' →';
          }
        });
      };
      relabel();
      var n = 0, ri = setInterval(function () { relabel(); if (++n > 8) clearInterval(ri); }, 500);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.GKMembership = { waitlist: showWaitlist, checkout: startCheckout, live: LIVE };
})();
