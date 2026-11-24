/* ============================================================
   config/site.js — sitewide toggles and dates that aren't prices.
   See config/pricing.js for all dollar amounts.
   ============================================================ */
(function () {
  window.GK_SITE = {
    webinarUrl: 'https://hearing-gods-voice.subscribepage.io',
    webinarDate: '2026-11-27T20:00:00+02:00',

    announcement: {
      enabled: true,
      text: 'Free live masterclass Nov 27 · Helping Kids Hear God',
      linkLabel: 'Save my seat'
      // linkUrl intentionally omitted here — the live announcement bar is
      // driven by Firestore settings (admin.html → Site Settings →
      // Announcement bar), not by this file. This object is the source of
      // truth for what to TYPE into that admin field; it does not render
      // anything on its own. See the note in site-settings.js.
    },

    // Shown in the "Join N+ children's ministry leaders..." social-proof
    // line. Spec text was "2,100+" — not independently verified against
    // the live MailerLite subscriber count (no API access from here).
    // Jandré: update this number to match Mailerlite → Subscribers.
    emailListCount: 2100
  };
})();
