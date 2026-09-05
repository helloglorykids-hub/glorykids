/* ============================================================
   gk-forms.js — generic form handler
   ============================================================
   Any <form data-gk-form="NAME"> on the page is POSTed to
   /api/form-submit as { formId:NAME, data:{...named fields} }.
   - a hidden <input name="_hp"> field acts as a honeypot
   - data-gk-form="newsletter" (or a checked field named
     "newsletter") also subscribes the email in MailerLite
   - on success the form is replaced with a thank-you message
     (or, if present, #success-msg is shown and the form hidden)
   Optional: define window.gkFormExtra() → object merged into data.
   ============================================================ */
(function () {
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

  function done(form, msg) {
    var success = document.getElementById('success-msg');
    if (success) { form.style.display = 'none'; success.style.display = 'block'; return; }
    var note = document.createElement('div');
    note.className = 'gk-form-success';
    note.style.cssText = 'padding:1.25rem 1.5rem;border-radius:12px;background:#e7f6ec;color:#1b7a3d;font:600 0.95rem Inter,system-ui,sans-serif;';
    note.textContent = msg || 'Thanks — we\'ve got your message and will be in touch soon.';
    form.replaceWith(note);
  }

  function wire(form) {
    if (form.__gkWired) return;
    form.__gkWired = true;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var formId = form.getAttribute('data-gk-form') || 'generic';
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
            done(form, formId === 'newsletter' ? 'You\'re subscribed — check your inbox!' : null);
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
})();
