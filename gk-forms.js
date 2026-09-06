/* ============================================================
   gk-forms.js — generic form handler
   ============================================================
   Any <form data-gk-form="NAME"> on the page is POSTed to
   /api/form-submit as { formId:NAME, data:{...named fields} }.
   - a hidden <input name="_hp"> field acts as a honeypot
   - data-gk-form="newsletter" (or a checked field named
     "newsletter") also subscribes the email in MailerLite
   - data-gk-form="free-lessons" → MailerLite "Free 10 Lessons"
     group (fires the 10-lesson automation). First time shows
     "check your inbox"; if the email is already in the group it
     shows "we already sent it". A local flag also flips every
     other free-lessons form on the site to the "already" state.
   - data-gk-form="waitlist" → MailerLite "Membership Waitlist".
   - on success the form is replaced with a thank-you message
     (or, if present, #success-msg is shown and the form hidden)
   Optional: define window.gkFormExtra() → object merged into data.
   ============================================================ */
(function () {
  var FREE_FLAG = 'gk_free_lessons_optin';
  var WAIT_FLAG = 'gk_waitlist_optin';

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  var MESSAGES = {
    'free-lessons': {
      'new': '✅ Check your inbox — your 10 free lessons are on the way! (Peek in spam if you don’t see them in a minute.)',
      'already': '✅ You’re already on the list — check your inbox (and your spam folder) for your 10 free lessons.'
    },
    'waitlist': {
      'new': '✅ You’re on the waitlist! We’ll email you the moment Glory Kids Membership opens.',
      'already': '✅ You’re already on the waitlist — hang tight, we’ll be in touch soon.'
    },
    'newsletter': { 'new': 'You’re subscribed — check your inbox!' }
  };

  function serialize(form) {
    var data = {};
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(function (el) {
      if (!el.name || el.name === '_hp') return;
      if (el.type === 'checkbox') { if (el.checked) data[el.name] = el.value || 'yes'; return; }
      if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; return; }
      if (el.value) data[el.name] = el.value;
    });
    if (typeof window.gkFormExtra === 'function') {
      try { Object.assign(data, window.gkFormExtra(form) || {}); } catch (e) {}
    }
    return data;
  }

  function showNote(form, msg) {
    var success = document.getElementById('success-msg');
    if (success) { form.style.display = 'none'; success.style.display = 'block'; return; }
    var note = document.createElement('div');
    note.className = 'gk-form-success';
    note.style.cssText = 'padding:1.25rem 1.5rem;border-radius:12px;background:#e7f6ec;color:#1b7a3d;font:600 0.95rem Inter,system-ui,sans-serif;line-height:1.5;';
    note.textContent = msg;
    form.replaceWith(note);
  }

  function done(form, formId, res) {
    var set = MESSAGES[formId];
    if (set) {
      var key = (res && res.already) ? 'already' : 'new';
      var msg = set[key] || set['new'];
      if (formId === 'free-lessons') lsSet(FREE_FLAG, '1');
      if (formId === 'waitlist') lsSet(WAIT_FLAG, '1');
      showNote(form, msg);
      return;
    }
    showNote(form, 'Thanks — we’ve got your message and will be in touch soon.');
  }

  function wire(form) {
    if (form.__gkWired) return;
    form.__gkWired = true;

    var formId = form.getAttribute('data-gk-form') || 'generic';

    // If this visitor has already opted in elsewhere, don't make them
    // re-submit — show the "already sent" state right away.
    if (formId === 'free-lessons' && lsGet(FREE_FLAG)) {
      showNote(form, MESSAGES['free-lessons']['already']);
      return;
    }
    if (formId === 'waitlist' && lsGet(WAIT_FLAG)) {
      showNote(form, MESSAGES['waitlist']['already']);
      return;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hp = form.querySelector('input[name="_hp"]');
      var payload = {
        formId: formId,
        data: serialize(form),
        pageUrl: location.href,
        _hp: hp ? hp.value : '',
        newsletter: formId === 'newsletter' || !!form.querySelector('input[name="newsletter"]:checked')
      };
      var btn = form.querySelector('button[type="submit"], button:not([type])');
      var label = btn && btn.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      fetch('/api/form-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          if (res && res.ok) {
            done(form, formId, res);
          } else {
            throw new Error((res && res.error) || 'Submit failed');
          }
        })
        .catch(function (err) {
          alert('Sorry — ' + err.message + '. Please try again or email us directly.');
          if (btn) { btn.disabled = false; btn.textContent = label; }
        });
    });
  }

  function init() { document.querySelectorAll('form[data-gk-form]').forEach(wire); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Re-scan for forms injected after load (e.g. blog-post.html renders its
  // opt-in box from JS once the post data arrives).
  window.gkFormsRescan = init;
})();
