/* ============================================================
   config/pricing.js — SINGLE SOURCE OF TRUTH for prices, dates
   and claims shown anywhere on the site (homepage, /church,
   /this-month, FAQ, Refund Policy). Every page that shows a
   price or a date should read it from window.GK_PRICING rather
   than hardcoding it.

   NOTE ON PAYMENTS: this site bills through PayPal (Subscriptions
   for church/individual membership, one-time Orders for single
   packs) — see netlify/functions/paypal-*.js and membership.js.
   There is no Payfast integration; any stray "Payfast" text
   elsewhere in the codebase is a leftover label, not a live path.

   Church ANNUAL billing (incl. the Founding rate) is NEW: as of
   this file's creation there is no annual PayPal Billing Plan for
   church yet — only the existing monthly plan
   (netlify/functions/_lib/paypal-plan-ids.js). The annual/founding
   prices below are real business numbers to display and to request
   at checkout, but the actual PayPal Plan IDs
   (PAYPAL_PLAN_CHURCH_ANNUAL / PAYPAL_PLAN_CHURCH_ANNUAL_FOUNDING)
   must be created in the PayPal dashboard and set as Netlify env
   vars before annual church checkout can go live. Until then,
   paypal-subscription-start.js returns a clear "being set up"
   error for those two plan keys instead of failing silently.
   ============================================================ */
(function () {
  window.GK_PRICING = {
    church: {
      monthlyUsd: 59,
      annualUsd: 499,
      extraCampusMonthlyUsd: 20,
      extraCampusAnnualUsd: 199
    },

    founding: {
      annualUsd: 399,
      lockedYears: 2,
      maxSeats: 25,
      // seatsTaken is intentionally NOT wired to a live count — there is no
      // Supabase/Firestore query backing a real-time seat counter yet, and
      // the business decision was to hide the counter entirely rather than
      // show a fake number. Leave this null; UI code must treat
      // seatsTaken === null as "don't render a seat counter."
      seatsTaken: null,
      endsAt: '2026-12-01T23:59:00+02:00'
    },

    individual: {
      monthlyUsd: 29.99
    },

    singlePack: {
      usd: 59,
      license: 'one teacher/classroom'
    }

    // Refund policy decided: cancel anytime (stops future billing), no
    // refunds for payments already made. There is no money-back guarantee
    // window — a guaranteeDays field used to sit here as an unused,
    // unconfirmed TODO; removed rather than left to contradict that policy
    // if something ever reads it.
  };

  // ---- small helpers pages can reuse instead of re-deriving this math ----
  var P = window.GK_PRICING;

  P.isFoundingActive = function () {
    if (P.founding.seatsTaken !== null && P.founding.seatsTaken >= P.founding.maxSeats) return false;
    return Date.now() < new Date(P.founding.endsAt).getTime();
  };

  // Church annual price to display right now — the founding rate while
  // that offer is active, otherwise the standard annual rate.
  P.churchAnnualDisplayUsd = function () {
    return P.isFoundingActive() ? P.founding.annualUsd : P.church.annualUsd;
  };

  P.churchAnnualPerMonthUsd = function () {
    return Math.round((P.churchAnnualDisplayUsd() / 12) * 100) / 100;
  };
})();
