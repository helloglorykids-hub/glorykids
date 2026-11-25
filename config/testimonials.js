/* ============================================================
   config/testimonials.js — SINGLE SOURCE OF TRUTH for
   testimonials. Only entries with verified:true should ever be
   rendered anywhere on the site. If this list has no verified
   entries, every testimonials section should hide itself
   entirely (see index.html's hidden testimonials section) rather
   than show fabricated quotes or stock avatars.

   None of the testimonial text that used to live directly in
   index.html's markup (fake names, pravatar.cc stock avatars, an
   unverifiable "10 salvations last month" claim) was real —
   it is NOT reproduced here. Add real, verified testimonials below
   as Jandré collects them.
   ============================================================ */
(function () {
  window.GK_TESTIMONIALS = [
    // { name: 'Jane D.', role: 'Children\'s Director', church: 'Grace Community Church', quote: '...', verified: true }
  ];

  window.GK_TESTIMONIALS.verified = function () {
    return window.GK_TESTIMONIALS.filter(function (t) { return t.verified === true; });
  };
})();
