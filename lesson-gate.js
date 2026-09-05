/* ═══════════════════════════════════════════════════════════════
   GLORY KIDS — LESSON PAGE ACCESS GATE
   ═══════════════════════════════════════════════════════════════
   Include this on every free-bible-lessons/[slug]/index.html page,
   with <body data-lesson-slug="[slug]">. Requires
   free-lessons-config.js to be loaded first.

   - Slug IS in GK_FREE_LESSON_SLUGS: opt-in forms are left alone
     (paste the real MailerLite embed into .lesson-optin__embed as
     normal — this is one of the 10 free lessons).
   - Slug is NOT in the list: every .lesson-optin block on the page
     is switched to a "Join Glory Kids Membership" prompt. If a
     visitor types an email and submits anyway, they see an inline
     message pointing them to membership instead of a download.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  var slug = document.body.getAttribute("data-lesson-slug");
  var freeSlugs = window.GK_FREE_LESSON_SLUGS || [];
  var isFree = freeSlugs.indexOf(slug) !== -1;

  if (isFree) return;

  var MEMBERSHIP_URL = "../../glory-kids-membership.html";

  document.querySelectorAll(".lesson-optin").forEach(function (box) {
    box.classList.add("lesson-optin--locked");

    var title = box.querySelector(".lesson-optin__title");
    if (title) title.textContent = "This Lesson Is Part of Glory Kids Membership";

    var body = box.querySelector(".lesson-optin__body");
    if (body) {
      body.textContent =
        "This lesson isn't included in our 10 free downloads, but it's ready to go inside Glory Kids Membership — along with hundreds more.";
    }

    var form = box.querySelector(".lesson-optin__fallback");
    if (!form) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var notice = document.createElement("div");
      notice.className = "lesson-optin__locked-msg";
      notice.innerHTML =
        "🔒 This lesson requires a <strong>Glory Kids Membership</strong> to download. " +
        '<a href="' + MEMBERSHIP_URL + '" class="gk-btn gk-btn--cta">Join Glory Kids Membership →</a>';

      form.replaceWith(notice);
    });
  });

  var heroCta = document.querySelector(".lesson-hero a.gk-btn--cta");
  if (heroCta && heroCta.textContent.indexOf("Get the Free PDF") !== -1) {
    heroCta.textContent = "🔒 Membership Lesson";
  }
})();
