/* PayPal Billing Plan IDs — not secret (they're already public in every
   checkout button's page source), so hardcoded here rather than stored as
   env vars, which count toward AWS Lambda's 4KB-per-function limit.
   Used by both paypal-subscription-start.js (renders the button) and
   paypal-subscription-confirm.js (verifies the approved subscription
   actually belongs to the plan the user started checkout for). */
'use strict';

// Individual Annual plan removed 2026-09-29 — the business wants monthly
// income, not an annual lump sum (also, the original annual plan was
// separately found to be misconfigured with a fixed 1 billing cycle,
// silently EXPIRING after each member's first payment instead of
// recurring — that would have needed its own new plan either way).
module.exports = {
  monthly: 'P-5HJ38241B3561884DNKUWMCA',
  church: 'P-0PK840601V2046942NKUWQKQ',
  'church-annual': 'P-74Y03914SL211573ENKUZCJQ'
};
